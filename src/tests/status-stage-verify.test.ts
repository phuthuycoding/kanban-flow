import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import type { Stage } from "../workflow/schema.js";
import { computeStatus, renderStatusText, statusToJson } from "../workflow/status.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (options: Record<string, unknown>): ParsedArgs => ({ command: "status", positionals: [], options });
const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const STAGE_CMD = [["npm", "test"]];
const OTHER_SHA = "a".repeat(40);

interface Fixture {
  root: string;
  head: string;
  /** Create item `name` at `stage`; its directory has no worktree, so the project root's HEAD is the item's HEAD. */
  addItem: (name: string, stage: Stage, meta?: Record<string, unknown>) => Promise<string>;
  /** Append one record line to the item's loop/stage-verify.jsonl. */
  record: (itemDir: string, overrides?: Record<string, unknown>) => Promise<void>;
  status: (name: string, json: boolean) => Promise<string>;
}

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function makeFixture(stageConfig: string[][] | null = STAGE_CMD): Promise<Fixture> {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-status-sv-")));
  const r = root;
  gitIn(r, "init", "-q");
  gitIn(r, "config", "user.email", "t@t");
  gitIn(r, "config", "user.name", "t");
  await writeFile(join(r, ".gitignore"), ".works/\n");
  gitIn(r, "add", "-A");
  gitIn(r, "commit", "-qm", "init");
  ensureWorksStructure(r);
  await mkdir(join(r, ".kf"), { recursive: true });
  await writeFile(join(r, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      ...(stageConfig ? { verify: { stage: stageConfig } } : {}),
    },
  }));
  const head = gitIn(r, "rev-parse", "HEAD");

  return {
    root: r,
    head,
    addItem: async (name, stage, meta = {}) => {
      const dir = join(r, ".works", stage, `${name}_20260919_1200`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, ".kfw.json"), JSON.stringify({
        schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200", ...meta,
      }));
      return dir;
    },
    record: async (itemDir, overrides = {}) => {
      await mkdir(join(itemDir, "loop"), { recursive: true });
      const rec = {
        at: new Date(Date.now() - 5 * 60_000).toISOString(),
        sha: head,
        clean: true,
        commands: [{ argv: ["npm", "test"], outcome: "exit", code: 0 }],
        outputSha256: "0".repeat(64),
        exit: 0,
        ...overrides,
      };
      const { appendFile } = await import("node:fs/promises");
      await appendFile(join(itemDir, "loop", "stage-verify.jsonl"), `${JSON.stringify(rec)}\n`);
    },
    status: async (name, json) => {
      const res = await cmdStatus(args({ change: name, ...(json ? { json: true } : {}) }), r);
      return res.stdout;
    },
  };
}

describe("kf status stage verify", () => {
  it("prints a PASS line with the short sha and the record age when the record matches HEAD", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", "testing");
    await fx.record(dir);

    const out = await fx.status("f", false);

    expect(out).toMatch(new RegExp(`^Stage verify: PASS ${fx.head.slice(0, 7)} at HEAD, \\d+[mhd] ago$`, "m"));
  });

  it("reports stageVerify state pass with matchesHead true in JSON", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", "testing");
    await fx.record(dir);

    const json = JSON.parse(await fx.status("f", true));

    expect(json.stageVerify.state).toBe("pass");
    expect(json.stageVerify.matchesHead).toBe(true);
    expect(json.stageVerify.sha).toBe(fx.head);
    expect(json.stageVerify.head).toBe(fx.head);
    expect(json.stageVerify.exit).toBe(0);
    expect(json.stageVerify.reason).toBeNull();
    expect(json.stageVerify.by).toBeNull();
  });

  it("prints a FAIL line with the exit code when the record at HEAD failed", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", "testing");
    await fx.record(dir, { exit: 1, commands: [{ argv: ["npm", "test"], outcome: "exit", code: 1 }] });

    const out = await fx.status("f", false);
    const json = JSON.parse(await fx.status("f", true));

    expect(out).toContain(`Stage verify: FAIL ${fx.head.slice(0, 7)} at HEAD (exit 1)`);
    expect(json.stageVerify.state).toBe("fail");
    expect(json.stageVerify.matchesHead).toBe(true);
    expect(json.stageVerify.exit).toBe(1);
  });

  it("prints a stale line naming both short shas when the record is for another commit", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", "testing");
    await fx.record(dir, { sha: OTHER_SHA });

    const out = await fx.status("f", false);
    const json = JSON.parse(await fx.status("f", true));

    expect(out).toContain(`Stage verify: stale (record ${OTHER_SHA.slice(0, 7)}, HEAD ${fx.head.slice(0, 7)})`);
    expect(json.stageVerify.state).toBe("stale");
    expect(json.stageVerify.matchesHead).toBe(false);
    expect(json.stageVerify.sha).toBe(OTHER_SHA);
    expect(json.stageVerify.head).toBe(fx.head);
  });

  it("prints a waived line with reason, author and date when the item carries a waiver and no stage is pinned", async () => {
    const fx = await makeFixture(null);
    await fx.addItem("f", "testing", {
      verifyWaiver: { reason: "docs only change", at: "2026-11-03T10:00:00.000Z", by: "alice" },
    });

    const out = await fx.status("f", false);
    const json = JSON.parse(await fx.status("f", true));

    expect(out).toContain("Stage verify: waived — docs only change (alice, 2026-11-03)");
    expect(json.stageVerify.state).toBe("waived");
    expect(json.stageVerify.reason).toBe("docs only change");
    expect(json.stageVerify.by).toBe("alice");
    expect(json.stageVerify.sha).toBeNull();
    expect(json.stageVerify.matchesHead).toBeNull();
  });

  it("prints a none line pointing at kf verify --stage when no record exists", async () => {
    const fx = await makeFixture();
    await fx.addItem("f", "testing");

    const out = await fx.status("f", false);
    const json = JSON.parse(await fx.status("f", true));

    expect(out).toContain("Stage verify: none — run kf verify f --stage");
    expect(json.stageVerify.state).toBe("none");
    expect(json.stageVerify.sha).toBeNull();
    expect(json.stageVerify.at).toBeNull();
    expect(json.stageVerify.exit).toBeNull();
    expect(json.stageVerify.matchesHead).toBeNull();
  });

  it("places the stage verify line after the Bypasses line", async () => {
    const fx = await makeFixture();
    await fx.addItem("f", "testing", {
      bypasses: [{ at: "2026-11-03T10:00:00.000Z", from: "implementation", to: "testing", flag: "force", codes: ["x"] }],
    });

    const lines = (await fx.status("f", false)).split("\n");
    const bypass = lines.findIndex((l) => l.startsWith("Bypasses:"));
    const verify = lines.findIndex((l) => l.startsWith("Stage verify:"));

    expect(bypass).toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(bypass);
  });

  it.each(["implementation", "review"] as const)("prints the line while the item is in %s", async (stage) => {
    const fx = await makeFixture();
    await fx.addItem("f", stage);

    expect(await fx.status("f", false)).toContain("Stage verify: none — run kf verify f --stage");
    expect(JSON.parse(await fx.status("f", true)).stageVerify.state).toBe("none");
  });

  it.each(["planning", "done"] as const)("prints no line and a null stageVerify for an item in %s", async (stage) => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", stage);
    await fx.record(dir);

    const out = await fx.status("f", false);
    const json = JSON.parse(await fx.status("f", true));

    expect(out).not.toContain("Stage verify:");
    expect(json.stageVerify).toBeNull();
  });

  it("reports stageVerify for each item in the --all listing", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("in-test", "testing");
    await fx.record(dir);
    await fx.addItem("in-plan", "planning");

    const res = await cmdStatus(args({ all: true, json: true }), fx.root);
    const features = JSON.parse(res.stdout).features as Array<{ feature: string; stageVerify: { state: string } | null }>;

    expect(features.find((f) => f.feature === "in-test")?.stageVerify?.state).toBe("pass");
    expect(features.find((f) => f.feature === "in-plan")?.stageVerify).toBeNull();
  });

  it("yields a null stageVerify when computeStatus is not given the project root", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", "testing");
    await fx.record(dir);
    const feature = findFeature(fx.root, "f")!;

    const status = computeStatus(feature);

    expect(status.stageVerify).toBeNull();
    expect(renderStatusText(status)).not.toContain("Stage verify:");
    expect(statusToJson(status).stageVerify).toBeNull();
  });

  it("computes the stage verify evidence when computeStatus is given the project root", async () => {
    const fx = await makeFixture();
    const dir = await fx.addItem("f", "testing");
    await fx.record(dir);
    const feature = findFeature(fx.root, "f")!;

    const status = computeStatus(feature, fx.root);

    expect(status.stageVerify?.state).toBe("pass");
  });
});

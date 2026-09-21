import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../project/doctor.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { writeFeatureMeta } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;

/** A project as `kf init --minimal` really leaves it, so the checks meet the shape they will meet. */
async function project(): Promise<void> {
  expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
}

/** Every file under a directory, path → contents, for proving nothing was written. */
async function snapshot(dir: string, base = dir): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await snapshot(full, base));
    else out[full.slice(base.length)] = await readFile(full, "utf8");
  }
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf doctor on a healthy project", () => {
  it("finds nothing and exits 0", async () => {
    await project();
    const report = runDoctor(root);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Healthy");
  });

  it("does not call an invalid work item a broken project", async () => {
    // A pipeline in motion is full of items that are not valid yet. Failing on those would make
    // the verdict useless — it would be red almost always.
    await project();
    const dir = join(root, ".works", "brainstorm", "wip_20260101_0000");
    await mkdir(dir, { recursive: true });
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "wip", context: "app", created: "20260101_0000" });

    const report = runDoctor(root);
    expect(report.invalidItems, "the item really is invalid").toBeGreaterThan(0);
    expect(report.findings, "but that is not a finding").toEqual([]);
    expect(report.ok).toBe(true);
    expect((await cmdDoctor(args("doctor"), root)).code).toBe(0);
  });

  it("runs from a subdirectory and refuses politely outside a project", async () => {
    await project();
    const sub = join(root, "src", "deep");
    await mkdir(sub, { recursive: true });
    expect((await cmdDoctor(args("doctor"), sub)).code).toBe(0);

    const outside = await mkdtemp(join(tmpdir(), "kf-nowhere-"));
    try {
      const res = await cmdDoctor(args("doctor"), outside);
      expect(res.code).toBe(1);
      expect(res.stdout).not.toContain("Error:");
      expect(res.stdout.length).toBeGreaterThan(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("kf doctor on a broken project", () => {
  it("survives a config it cannot parse, which is the case it exists for", async () => {
    await project();
    await writeFile(join(root, ".kf", "config.json"), "{ this is not json");
    const report = runDoctor(root);
    const config = report.findings.find((f) => f.area === ".kf/config.json");
    expect(config?.level).toBe("ERROR");
    expect(config?.message).toContain("Cannot read the project config");
    expect(report.ok).toBe(false);
    expect((await cmdDoctor(args("doctor"), root)).code).toBe(1);
  });

  it("keeps checking after the first problem instead of stopping", async () => {
    // One diagnosis per run would mean fixing four things in four runs.
    await project();
    await writeFile(join(root, ".kf", "config.json"), "{ broken");
    await rm(join(root, ".works", "testing"), { recursive: true });
    await rm(join(root, ".claude", "skills", "kanban-plan"), { recursive: true });
    const areas = runDoctor(root).findings.map((f) => f.area);
    expect(areas).toContain(".kf/config.json");
    expect(areas).toContain(".works/");
    expect(areas.some((a) => a.includes("skills"))).toBe(true);
  });

  it("names the stage directory that is missing", async () => {
    await project();
    await rm(join(root, ".works", "review"), { recursive: true });
    const f = runDoctor(root).findings.find((x) => x.area === ".works/");
    expect(f?.level).toBe("ERROR");
    expect(f?.message).toContain("review");
  });

  it("treats a file sitting where a stage directory belongs as missing", async () => {
    await project();
    await rm(join(root, ".works", "backlog"), { recursive: true });
    await writeFile(join(root, ".works", "backlog"), "not a directory");
    expect(runDoctor(root).findings.find((x) => x.area === ".works/")?.message).toContain("backlog");
  });

  it("names the work item whose metadata cannot be read", async () => {
    await project();
    const dir = join(root, ".works", "brainstorm", "junk_20260101_0000");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), "not json either");
    const f = runDoctor(root).findings.find((x) => x.area.includes("junk_20260101_0000"));
    expect(f?.level).toBe("ERROR");
    expect(f?.message).toContain("Unreadable metadata");
    expect(f?.action).toContain(".kfw.json");
  });

  it("reports skills that were installed and then deleted", async () => {
    await project();
    await rm(join(root, ".claude", "skills", "kanban-review"), { recursive: true });
    const f = runDoctor(root).findings.find((x) => x.area.includes("skills"));
    expect(f?.level).toBe("ERROR");
    expect(f?.message).toContain("kanban-review");
    expect(f?.action).toBe("kf install --agent claude");
  });
});

describe("kf doctor on config that parses but misleads", () => {
  it("warns that defaultContext is ignored, without failing the verdict", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.contexts = ["billing", "auth"];
    cfg.defaultContext = "auth";
    await writeFile(path, JSON.stringify(cfg, null, 2));

    const report = runDoctor(root);
    const f = report.findings.find((x) => x.message.includes("defaultContext"));
    expect(f?.level).toBe("WARNING");
    expect(f?.message).toContain("billing");
    expect(report.ok, "a warning must not fail the verdict").toBe(true);
    expect((await cmdDoctor(args("doctor"), root)).code).toBe(0);
  });

  it("warns when the legacy singular stack sits beside stacks", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.stack = "node";
    cfg.stacks = ["node"];
    await writeFile(path, JSON.stringify(cfg, null, 2));
    const f = runDoctor(root).findings.find((x) => x.message.includes("legacy"));
    expect(f?.level).toBe("WARNING");
    expect(runDoctor(root).ok).toBe(true);
  });

  it("says nothing about defaultContext when no list is declared", async () => {
    // Without `contexts`, defaultContext is the field that decides — warning would be wrong.
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete cfg.contexts;
    cfg.defaultContext = "auth";
    await writeFile(path, JSON.stringify(cfg, null, 2));
    expect(runDoctor(root).findings.some((x) => x.message.includes("defaultContext"))).toBe(false);
  });
});

describe("what kf doctor promises about itself", () => {
  it("changes nothing on disk", async () => {
    await project();
    await rm(join(root, ".works", "testing"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), "{ broken");
    const before = await snapshot(root);
    await cmdDoctor(args("doctor"), root);
    expect(await snapshot(root)).toEqual(before);
  });

  it("gives --json the same findings and the same verdict as the text", async () => {
    await project();
    await rm(join(root, ".works", "dones"), { recursive: true });
    const text = await cmdDoctor(args("doctor"), root);
    const json = await cmdDoctor(args("doctor", [], { json: true }), root);
    const parsed = JSON.parse(json.stdout) as { ok: boolean; findings: Array<{ message: string }> };
    expect(json.code).toBe(text.code);
    expect(parsed.ok).toBe(false);
    for (const f of parsed.findings) expect(text.stdout).toContain(f.message);
  });
});

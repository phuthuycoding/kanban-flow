import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdVerify } from "../cli/commands/verify.js";
import { waveVerifyLogPath } from "../workflow/verify.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

interface Item {
  scratch: string;
  root: string;
  /** Where the item's commits live: the item worktree, or the project root when the item has none. */
  dir: string;
  /** Appended to by the stage script, one line per run: the directory it ran in. */
  calls: string;
  /** A node script recording its cwd to `calls`; exits 1 when `bad.test.ts` exists in its cwd. */
  seesBadFileScript: string;
  /** A node script recording its cwd to `calls` and exiting 1. */
  failScript: string;
  configure: (stage?: string[][]) => Promise<void>;
  head: () => string;
  verify: (options: Record<string, unknown>) => Promise<{ code: number; out: string }>;
  itemDir: () => string;
  recordFile: () => string;
  records: () => Record<string, unknown>[];
  callLines: () => string[];
}

async function baseRepo(): Promise<{ scratch: string; root: string }> {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-wave-")));
  const root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
  return { scratch, root };
}

/** A real item `f` approved through the real commands (a feature with waves 1 and 2), or a bug `f` with a tasks.md. */
async function makeItem(opts: { kind: "feature" | "bug"; worktree: boolean }): Promise<Item> {
  const { scratch, root } = await baseRepo();
  const feature = () => findFeature(root, "f")!;
  const configPaths = (): string[] => {
    const wt = feature()?.meta?.worktree?.path;
    return [join(root, ".kf", "config.json"), ...(wt ? [join(wt, ".kf", "config.json")] : [])];
  };
  const configure: Item["configure"] = async (stage) => {
    for (const path of configPaths()) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, JSON.stringify({
        schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
        worktree: { enabled: opts.worktree, baseDir: join(scratch, "wt"), routesFile: join(scratch, "routes.json") },
        harness: {
          main: "lead",
          roles: { lead: { runner: "claude" } },
          runners: { claude: { start: ["claude", "{prompt}"] } },
          verify: stage ? { stage } : {},
        },
      }));
    }
  };
  const must = (res: { code: number; stdout: string; stderr?: string }, what: string): void => {
    if (res.code !== 0) throw new Error(`${what} failed: ${res.stdout}${res.stderr ?? ""}`);
  };
  await mkdir(join(root, ".kf"), { recursive: true });
  await configure();
  if (opts.kind === "feature") {
    const write = (id: keyof typeof ARTIFACTS, body: string) => writeFile(join(feature().dir, ARTIFACTS[id].file), body);
    must(await cmdNew(args("new", ["f"], { context: "app" }), root), "kf new");
    await write("spec-requirement", spec);
    must(await cmdStage(args("stage", ["f", "planning"]), root), "kf stage planning");
    await write("implementation-plan", `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n| TASK-001 | Do it | Core | - | Change merged | FR-001 / UC-001 | - | src/a.ts |\n| TASK-002 | Then this | Core | TASK-001 | Change merged | FR-001 / UC-001 | - | src/b.ts |\n`);
    for (const id of ["use-case-specification", "use-case-diagram"] as const) await write(id, "# Contract\nUC-001: Create a task");
    await mkdir(join(feature().dir, "use-cases"), { recursive: true });
    await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
    await write("test-cases", "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
    must(await cmdApprove(args("approve", ["f"], {}), root), "kf approve");
  } else {
    must(await cmdNew(args("new", ["f"], { context: "app", type: "bug" }), root), "kf new bug");
    await writeFile(join(feature().dir, "tasks.md"), "# Tasks\n\n- [ ] 1. TASK-001: fix the crash\n");
  }
  const dir = feature().meta?.worktree?.path ?? root;
  if (opts.worktree && opts.kind === "feature" && dir === root) throw new Error("fixture: approve did not create an item worktree");
  if (!opts.worktree && dir !== root) throw new Error("fixture: an item worktree exists although worktree.enabled is false");
  await configure();

  const calls = join(scratch, "calls.log");
  const record = `require("fs").appendFileSync(${JSON.stringify(calls)}, process.cwd() + "\\n");\n`;
  const seesBadFileScript = join(scratch, "sees-bad.js");
  await writeFile(seesBadFileScript, `${record}process.exit(require("fs").existsSync("bad.test.ts") ? 1 : 0);\n`);
  const failScript = join(scratch, "fail.js");
  await writeFile(failScript, `${record}process.exit(1);\n`);
  const recordFile = () => join(feature().dir, "loop", "stage-verify.jsonl");
  return {
    scratch, root, dir, calls, seesBadFileScript, failScript, configure,
    head: () => gitIn(dir, "rev-parse", "HEAD"),
    verify: async (options) => {
      const res = await cmdVerify(args("verify", ["f"], options), root);
      return { code: res.code, out: `${res.stdout}\n${res.stderr ?? ""}` };
    },
    itemDir: () => feature().dir,
    recordFile,
    records: () => (existsSync(recordFile()) ? readFileSync(recordFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    callLines: () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : []),
  };
}

let item: Item;
afterEach(async () => {
  if (item) await rm(item.scratch, { recursive: true, force: true });
});

const waveLog = (): string => join(item.itemDir(), "loop", "wave-1-verify.log");
const leftoverTempWorktrees = (): string[] =>
  gitIn(item.dir, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ") && l.includes("kf-verify-"));

describe("waveVerifyLogPath", () => {
  it("is loop/wave-<w>-verify.log inside the item directory", async () => {
    item = await makeItem({ kind: "feature", worktree: true });
    expect(waveVerifyLogPath(item.itemDir(), 2)).toBe(join(item.itemDir(), "loop", "wave-2-verify.log"));
  });
});

describe("kf verify --wave", () => {
  it("passes on the committed tree only, records the run and logs it, and removes the temporary worktree", async () => {
    item = await makeItem({ kind: "feature", worktree: true });
    await item.configure([["node", item.seesBadFileScript]]);
    // Uncommitted in the item worktree: a detached run at HEAD must not see it.
    await writeFile(join(item.dir, "bad.test.ts"), "failing\n");

    const res = await item.verify({ wave: "1" });

    expect(res.code).toBe(0);
    const head = item.head();
    expect(res.out).toContain(`Running wave 1 verify in a detached worktree at ${head.slice(0, 7)}`);
    const records = item.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ wave: 1, clean: true, sha: head, exit: 0 });
    expect(readFileSync(waveLog(), "utf8")).toMatch(/^## kf verify \d{4}-\d{2}-\d{2}T[\d:.]+Z exit=0$/m);
    const ran = item.callLines();
    expect(ran).toHaveLength(1);
    expect(ran[0]).not.toBe(item.dir);
    expect(existsSync(ran[0])).toBe(false);
    expect(leftoverTempWorktrees()).toEqual([]);
  });

  it("exits 1 with a record and a log of exit 1 when a stage command fails, and still removes the temporary worktree", async () => {
    item = await makeItem({ kind: "feature", worktree: true });
    await item.configure([["node", item.failScript]]);

    const res = await item.verify({ wave: "1" });

    expect(res.code).toBe(1);
    expect(item.records()).toHaveLength(1);
    expect(item.records()[0]).toMatchObject({ wave: 1, clean: true, sha: item.head(), exit: 1 });
    expect(readFileSync(waveLog(), "utf8")).toMatch(/^## kf verify \d{4}-\d{2}-\d{2}T[\d:.]+Z exit=1$/m);
    const ran = item.callLines();
    expect(ran).toHaveLength(1);
    expect(existsSync(ran[0])).toBe(false);
    expect(leftoverTempWorktrees()).toEqual([]);
  });

  describe("exits 3 and runs and writes nothing", () => {
    const cases: [string, () => Record<string, unknown>, (() => Promise<void>)?][] = [
      ["for a wave no task is in", () => ({ wave: "9" })],
      ["for a wave that is not a number", () => ({ wave: "x" })],
      ["together with --task", () => ({ wave: "1", task: "TASK-001" })],
      ["together with --stage", () => ({ wave: "1", stage: true })],
      ["together with --base", () => ({ wave: "1", base: "HEAD" })],
      ["together with --commits", () => ({ wave: "1", commits: "HEAD" })],
      ["when the item worktree path is gone", () => ({ wave: "1" }), async () => { await rm(item.dir, { recursive: true, force: true }); }],
    ];
    for (const [name, options, before] of cases) {
      it(name, async () => {
        item = await makeItem({ kind: "feature", worktree: true });
        await item.configure([["node", item.failScript]]);
        if (before) await before();

        const res = await item.verify(options());

        expect(res.code).toBe(3);
        expect(item.callLines()).toEqual([]);
        expect(existsSync(item.recordFile())).toBe(false);
        expect(existsSync(waveLog())).toBe(false);
      });
    }
  });

  it("says no stage verify is configured, exits 0 and writes nothing when harness.verify.stage is not set", async () => {
    item = await makeItem({ kind: "feature", worktree: true });
    await item.configure();

    const res = await item.verify({ wave: "1" });

    expect(res.code).toBe(0);
    expect(res.out).toContain("No stage verify configured");
    expect(existsSync(item.recordFile())).toBe(false);
    expect(existsSync(waveLog())).toBe(false);
  });

  it("treats every task of a bug as wave 1", async () => {
    item = await makeItem({ kind: "bug", worktree: false });
    await item.configure([["node", item.seesBadFileScript]]);

    const one = await item.verify({ wave: "1" });
    expect(one.code).toBe(0);
    expect(item.records()).toHaveLength(1);
    expect(item.records()[0]).toMatchObject({ wave: 1, exit: 0 });

    const two = await item.verify({ wave: "2" });
    expect(two.code).toBe(3);
    expect(item.records()).toHaveLength(1);
    expect(item.callLines()).toHaveLength(1);
  });

  it("records the project root HEAD for an item without a worktree", async () => {
    item = await makeItem({ kind: "feature", worktree: false });
    await item.configure([["node", item.seesBadFileScript]]);

    const res = await item.verify({ wave: "1" });

    expect(res.code).toBe(0);
    expect(item.dir).toBe(item.root);
    expect(item.records()).toHaveLength(1);
    expect(item.records()[0]).toMatchObject({ wave: 1, clean: true, sha: gitIn(item.root, "rev-parse", "HEAD"), exit: 0 });
    expect(leftoverTempWorktrees()).toEqual([]);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { ensureWorksStructure, executionContractHash } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import { PKG_ROOT } from "../shared/paths.js";

const KF = join(PKG_ROOT, "dist", "index.js");
const SRC = join(PKG_ROOT, "src");

/** A removed command named anywhere in printed text: `kf drive`, `kf run`, `kf runs` or `kf harness`. */
const REMOVED_COMMAND = /\bkf (drive|run|runs|harness)\b/;

const scratches: string[] = [];
async function scratchDir(prefix: string): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), prefix)));
  scratches.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of scratches.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Run the real built CLI. */
function kf(cwd: string, ...argv: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [KF, ...argv], { cwd, encoding: "utf8", env: process.env });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

describe("removed harness commands", () => {
  it.each([
    ["drive", ["drive", "x"]],
    ["run", ["run", "x"]],
    ["runs", ["runs", "x"]],
    ["harness", ["harness"]],
  ])("kf %s exits 1 with the unknown-command message", async (name, argv) => {
    const cwd = await scratchDir("kf-retired-cmd-");
    const res = kf(cwd, ...argv);
    expect(res.code).toBe(1);
    expect(res.out).toContain(`unknown command: ${name}`);
  });

  it("kf -h lists none of them and lists verify", async () => {
    const cwd = await scratchDir("kf-retired-help-");
    const res = kf(cwd, "-h");
    expect(res.code).toBe(0);
    for (const name of ["drive", "run", "runs", "harness"]) {
      expect(res.out).not.toMatch(new RegExp(`^\\s+${name}\\s+Usage:`, "m"));
    }
    expect(res.out).not.toMatch(REMOVED_COMMAND);
    expect(res.out).toMatch(/^\s+verify\s+Usage: kf verify/m);
  });
});

const TS = "20260916_1800";
const DEAD_PID = 2 ** 22 + 12345;

/**
 * What an item driven by an earlier release still carries: a drive whose supervisor is dead, a
 * worker run recorded as running (its pid is this test process, so it answers as alive), worker
 * sessions and per-task state. Nothing reads these keys any more; they must load and survive writes.
 */
function leftoverKeys(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    drive: {
      id: "drv-1", status: "running", step: "review", loops: 0, runs: 1, configHash: "h",
      supervisorPid: DEAD_PID, startedAt: now, updatedAt: now,
    },
    runs: [{
      id: "run-a", role: "reviewer", runner: "codex", stage: "review", mode: "start", at: now,
      log: "runs/run-a.log", status: "running", pid: process.pid, supervisorPid: process.pid,
    }],
    sessions: { reviewer: "session-1" },
    tasks: { "TASK-001": { state: "done", attempts: 1, updatedAt: now } },
  };
}

function readMeta(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, METADATA_FILE), "utf8")) as Record<string, unknown>;
}

/** The one folder of `name` under `.works/<stage>`, or null. */
function itemDir(root: string, stage: string, name: string): string | null {
  const dir = join(root, ".works", stage);
  if (!existsSync(dir)) return null;
  const folder = readdirSync(dir).find((f) => f.startsWith(`${name}_`));
  return folder ? join(dir, folder) : null;
}

/** The leftover keys are in the item's `.kfw.json` exactly as they were written. */
function expectLeftoversKept(dir: string | null, leftovers: Record<string, unknown>): void {
  expect(dir, "item folder").not.toBeNull();
  const meta = readMeta(dir!);
  for (const [key, value] of Object.entries(leftovers)) expect(meta[key], key).toEqual(value);
}

/** A project (not a git repo) with a repository link, so kf sync runs, and worktrees off. */
async function leftoverProject(): Promise<string> {
  const root = await scratchDir("kf-retired-meta-");
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false },
  }));
  for (const stage of ["brainstorm", "planning", "backlog", "implementation", "testing", "review", "done", "cancelled"]) {
    await mkdir(join(root, ".works", stage), { recursive: true });
  }
  return root;
}

/** A review item with current PASS reports and `landing: none`, carrying the leftover keys. */
async function passedReviewItem(root: string, name: string, leftovers: Record<string, unknown>): Promise<string> {
  const dir = join(root, ".works", "review", `${name}_${TS}`);
  await mkdir(join(dir, "use-cases"), { recursive: true });
  await writeFile(join(dir, ARTIFACTS["spec-requirement"].file), "---\nstatus: confirmed\n---\n# Spec\nreal content\nFR-001");
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram", "test-cases"] as const) {
    await writeFile(join(dir, ARTIFACTS[id].file), `# ${id}\nreal content\n## TC-001\nFR-001 UC-001`);
  }
  await writeFile(join(dir, "use-cases", "UC-001.md"), "# UC-001\nreal content");
  await writeFile(join(dir, ARTIFACTS["testing-result"].file), "---\nstatus: PASS\nexecution: run-1\n---\n# Test\nreal content\nOverall: 85%\n## Commands and Evidence\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | ok |");
  await writeFile(join(dir, ARTIFACTS["review-report"].file), "---\nstatus: PASS\nexecution: run-1\nci: none\nlanding: none\n---\n# Review\nreal content");
  await writeFile(join(dir, ARTIFACTS["feature-report"].file), "# Feature Report\nreal content");
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({
    schema: "kanban-flow", feature: name, context: "app", created: TS,
    approval: { status: "approved", by: "human", at: TS, contractHash: executionContractHash(dir) },
    executionId: "run-1",
    ...leftovers,
  }, null, 2));
  return dir;
}

describe("an item with leftover drive, runs, sessions and tasks keys", () => {
  it("kf status --change closes it and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "demo", leftovers);

    const res = kf(root, "status", "--change", "demo");
    expect(res.out).toContain("✓ done demo (nothing to land)");
    expect(itemDir(root, "review", "demo")).toBeNull();
    expectLeftoversKept(itemDir(root, "done", "demo"), leftovers);
  });

  it("the kf status --all sweep closes it and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "demo", leftovers);

    const res = kf(root, "status", "--all");
    expect(res.out).toContain("✓ done demo (nothing to land)");
    expectLeftoversKept(itemDir(root, "done", "demo"), leftovers);
  });

  it("kf sync closes it instead of skipping it and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "demo", leftovers);

    const res = kf(root, "sync");
    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toContain("skipped");
    expect(res.out).toContain("✓ demo: archived (nothing to land)");
    expectLeftoversKept(itemDir(root, "done", "demo"), leftovers);
  });

  it("kf archive closes it without a run-in-progress refusal and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "demo", leftovers);

    const res = kf(root, "archive", "demo");
    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toContain("run in progress");
    expectLeftoversKept(itemDir(root, "done", "demo"), leftovers);
  });

  it("kf stage <item> done closes it without a run-in-progress refusal and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "demo", leftovers);

    const res = kf(root, "stage", "demo", "done");
    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toContain("run in progress");
    expectLeftoversKept(itemDir(root, "done", "demo"), leftovers);
  });

  it("kf stage moving it back to implementation keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "demo", leftovers);

    const res = kf(root, "stage", "demo", "implementation");
    expect(res.code, res.out).toBe(0);
    expectLeftoversKept(itemDir(root, "implementation", "demo"), leftovers);
  });

  it("kf cancel cancels it without a run-in-progress refusal or --force and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    await passedReviewItem(root, "other", leftovers);

    const res = kf(root, "cancel", "other", "--reason", "dropped by the team");
    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toContain("run in progress");
    const dir = itemDir(root, "cancelled", "other");
    expectLeftoversKept(dir, leftovers);
    expect(readMeta(dir!).bypasses ?? []).toEqual([]);
  });

  it("the legacy-stage migration moves it instead of leaving it in place and keeps the keys", async () => {
    const root = await leftoverProject();
    const leftovers = leftoverKeys();
    const legacy = join(root, ".works", "dones", `old_${TS}`);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, METADATA_FILE), JSON.stringify({
      schema: "kanban-flow", feature: "old", context: "app", created: TS, kind: "bug", ...leftovers,
    }, null, 2));

    const res = kf(root, "status", "--all");
    expect(res.out).not.toContain("left in .works/dones");
    expect(res.out).toContain(`migrated old_${TS}: .works/dones → .works/done`);
    expect(existsSync(legacy)).toBe(false);
    expectLeftoversKept(itemDir(root, "done", "old"), leftovers);
  });
});

const PLAN = "# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n"
  + "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|\n"
  + "| TASK-001 | Do it | Core | - | Change merged | FR-001 / UC-001 | - | src/a.ts |\n";

/**
 * A git project with `harness.verify` set and an item `f` in planning with a complete contract:
 * the configuration under which earlier releases sent the human to `kf drive` after approval.
 * The runner and role sit next to `verify` because the current harness validation still demands them.
 */
async function plannedProject(worktrees: boolean): Promise<string> {
  const scratch = await scratchDir("kf-retired-next-");
  const root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    worktree: worktrees
      ? { enabled: true, baseDir: join(scratch, "wt"), routesFile: join(scratch, "routes.json") }
      : { enabled: false },
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      verify: { task: [["true"]], stage: [["true"]] },
    },
  }));

  const must = (res: { code: number; out: string }, what: string): void => {
    if (res.code !== 0) throw new Error(`fixture: ${what} failed: ${res.out}`);
  };
  must(kf(root, "new", "f", "--context", "app"), "kf new");
  const dir = (): string => itemDir(root, "brainstorm", "f") ?? itemDir(root, "planning", "f")!;
  await writeFile(join(dir(), ARTIFACTS["spec-requirement"].file),
    "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A");
  must(kf(root, "stage", "f", "planning"), "kf stage planning");
  await writeFile(join(dir(), ARTIFACTS["implementation-plan"].file), PLAN);
  for (const id of ["use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(dir(), ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(dir(), "use-cases"), { recursive: true });
  await writeFile(join(dir(), "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(dir(), ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  return root;
}

describe("the step after approval names the implement skill", () => {
  it("kf approve prints a Next line with the implement skill and no kf drive", async () => {
    const root = await plannedProject(true);

    const res = kf(root, "approve", "f");
    expect(res.code, res.out).toBe(0);
    const next = res.out.split("\n").find((l) => l.startsWith("Next:"));
    expect(next, res.out).toBeDefined();
    expect(next).toContain("kanban-implement");
    expect(next).not.toContain("kf drive");
    expect(res.out).not.toMatch(REMOVED_COMMAND);
  });

  it("kf status and kf validate on the approved item name no removed command", async () => {
    const root = await plannedProject(true);
    expect(kf(root, "approve", "f").code).toBe(0);

    const status = kf(root, "status", "--change", "f");
    expect(status.code, status.out).toBe(0);
    expect(status.out).toContain("kanban-implement");
    expect(status.out).not.toMatch(REMOVED_COMMAND);

    for (const argv of [["status"], ["status", "--all"], ["validate", "--change", "f"]]) {
      const res = kf(root, ...argv);
      expect(res.out, argv.join(" ")).not.toMatch(REMOVED_COMMAND);
    }
  });

  it("with worktrees off, kf validate and kf approve --backlog raise no warning about the task harness", async () => {
    const root = await plannedProject(false);

    const validate = kf(root, "validate", "--change", "f");
    expect(validate.out).not.toContain("task_harness_needs_worktree");
    expect(validate.out).not.toMatch(REMOVED_COMMAND);

    const approve = kf(root, "approve", "f", "--backlog");
    expect(approve.code, approve.out).toBe(0);
    expect(approve.out).not.toContain("task_harness_needs_worktree");
    expect(approve.out).not.toMatch(REMOVED_COMMAND);
  });

  it("kf autoconfig names no removed command", async () => {
    const root = await plannedProject(true);

    const res = kf(root, "autoconfig");
    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toMatch(REMOVED_COMMAND);
    expect(res.out).not.toContain("(kf harness)");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

/** Module specifiers a file imports or re-exports, static or dynamic. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) found.push(m[1]);
  return found;
}

describe("the drive runtime is gone from the source tree", () => {
  it("src/harness holds only config.ts", () => {
    // config.ts stays until the config schema is rewritten; every other harness module goes.
    expect(readdirSync(join(SRC, "harness"))).toEqual(["config.ts"]);
  });

  it("the per-task worktree module is gone", () => {
    expect(existsSync(join(SRC, "worktree", "tasks.ts"))).toBe(false);
  });

  it("no source file imports a harness module other than its config, or the per-task worktree module", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (!spec.startsWith(".")) continue;
        const target = relative(SRC, resolve(dirname(file), spec));
        const harnessModule = target.startsWith("harness/") && target !== "harness/config.js";
        if (harnessModule || target === "worktree/tasks.js") hits.push(`${relative(SRC, file)}: ${spec}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

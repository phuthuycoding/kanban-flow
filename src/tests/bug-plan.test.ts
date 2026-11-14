import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executionContractHash, type Feature } from "../workflow/features.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import type { InputsRead, LoopInputs } from "../workflow/next/types.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { checkTaskGraph, taskView } from "../workflow/tasks.js";
import { checkApproval } from "../workflow/validate-approval.js";
import { verifyTask, verifyWave } from "../workflow/verify.js";

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

interface PlanTask {
  id: string;
  description?: string;
  deps?: string[];
  files?: string[];
}

function plan(tasks: PlanTask[], extra = ""): string {
  const list = (v: string[] | undefined) => (v && v.length ? v.join(", ") : "-");
  const rows = tasks.map((t) => `| ${t.id} | ${t.description ?? `Do ${t.id}`} | Core | ${list(t.deps)} | Change merged | - | coder | ${list(t.files)} |`);
  return `# Implementation Plan\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${rows.join("\n")}\n\n${extra}\n`;
}

// Three tasks in two waves: TASK-002 waits on TASK-001 and shares src/a.ts with it; TASK-003 stands alone.
const LANES: PlanTask[] = [
  { id: "TASK-001", description: "Fix the parser", files: ["src/a.ts"] },
  { id: "TASK-002", description: "Fix the printer", deps: ["TASK-001"], files: ["src/a.ts", "src/b.ts"] },
  { id: "TASK-003", description: "Regression test for the crash", files: ["src/c.ts"] },
];

// The checkbox list a bug carries today; with a plan present it must no longer decide the tasks.
const TASKS_MD = "# Tasks\n\n- [ ] 1. TASK-001: fix the parser\n- [ ] 2. TASK-002: fix the printer\n- [ ] 3. TASK-003: regression test for the crash\n";

const BUG_REPORT = "---\nkind: bug\nstatus: confirmed\n---\n# Bug Report\n\n## Regression Test Strategy\n- Test Level: unit\n";
// The report-only fingerprint of BUG_REPORT that already-approved bugs carry; it must not move.
const REPORT_ONLY_HASH = "ef4996aa313e2bef431c2a2a0978aecf3234c9bd5dfa1d4ac3453ce3f8f95bf4";

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;
let root: string;
let itemDir: string;

async function putItemFile(rel: string, body: string): Promise<void> {
  const path = join(itemDir, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body);
}

function itemOf(kind: "bug" | "feature", contractHash?: string): Feature {
  return {
    name: "demo",
    context: "app",
    stage: "implementation",
    dir: itemDir,
    folder: "demo_20261113_1200",
    meta: {
      schema: "kanban-flow", feature: "demo", context: "app", created: "20261113_1200",
      ...(kind === "bug" ? { kind: "bug" as const } : {}),
      ...(contractHash !== undefined ? { approval: { status: "approved", contractHash } } : {}),
    } as Feature["meta"],
  };
}

function ok(res: InputsRead): LoopInputs {
  if (!res.ok) throw new Error(`expected inputs, got refusal: ${res.reason}`);
  return res.inputs;
}

async function commit(files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), body);
  }
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "change");
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-bug-plan-")));
  root = join(scratch, "repo");
  itemDir = join(root, ".works", "implementation", "demo_20261113_1200");
  await mkdir(itemDir, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261113_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" }, coder: { runner: "claude" } },
      stages: { implementation: ["coder"] },
      runners: { claude: { start: ["claude", "{prompt}"] } },
    },
  }));
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  await putItemFile(ARTIFACTS["spec-requirement"].file, BUG_REPORT);
  await putItemFile("tasks.md", TASKS_MD);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("kf tasks on a bug with a Task Breakdown", () => {
  it("lists the plan's tasks with dependencies, files, waves and overlaps", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const rows = taskView(itemOf("bug"));
    expect(rows.map((r) => [r.id, r.dependencies, r.files, r.wave, r.overlaps.map((o) => o.task)])).toEqual([
      ["TASK-001", [], ["src/a.ts"], 1, ["TASK-002"]],
      ["TASK-002", ["TASK-001"], ["src/a.ts", "src/b.ts"], 2, ["TASK-001"]],
      ["TASK-003", [], ["src/c.ts"], 1, []],
    ]);
  });

  it("returns the same rows as a feature with the identical plan", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const feature = taskView(itemOf("feature"));
    expect(feature.length).toBe(3);
    expect(taskView(itemOf("bug"))).toEqual(feature);
  });

  it("reports duplicate, missing and cyclic dependencies as for a feature", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([
      { id: "TASK-001", deps: ["TASK-002"] },
      { id: "TASK-002", deps: ["TASK-001", "TASK-009"] },
      { id: "TASK-002" },
    ]));
    const codes = checkTaskGraph(itemOf("bug")).map((f) => f.code).sort();
    expect(codes).toEqual(expect.arrayContaining(["task_dep_cycle", "task_dep_missing", "task_duplicate"]));
    expect(checkTaskGraph(itemOf("bug"))).toEqual(checkTaskGraph(itemOf("feature")));
  });
});

describe("kf next inputs on a bug with a Task Breakdown", () => {
  it("schedules the plan's tasks with their files, waves and overlaps instead of one all-overlapping wave", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const inputs = ok(readLoopInputs(root, itemOf("bug")));
    expect(inputs.kind).toBe("bug");
    expect(inputs.tasks.map((t) => [t.id, t.dependencies, t.files, t.wave, t.overlaps])).toEqual([
      ["TASK-001", [], ["src/a.ts"], 1, ["TASK-002"]],
      ["TASK-002", ["TASK-001"], ["src/a.ts", "src/b.ts"], 2, ["TASK-001"]],
      ["TASK-003", [], ["src/c.ts"], 1, []],
    ]);
  });

  it("marks only the tasks of a wave the plan declares inline", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES, "Execution: wave 2 inline"));
    const inputs = ok(readLoopInputs(root, itemOf("bug")));
    expect(inputs.tasks.map((t) => [t.id, t.inline])).toEqual([
      ["TASK-001", false],
      ["TASK-002", true],
      ["TASK-003", false],
    ]);
  });

  it("gives a Unit test type only to a task whose plan description names a regression", async () => {
    // The checkbox lines name no regression, so only the plan's description can give the Unit type.
    await putItemFile("tasks.md", "# Tasks\n\n- [ ] 1. TASK-001: parser\n- [ ] 2. TASK-002: printer\n- [ ] 3. TASK-003: crash test\n");
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const inputs = ok(readLoopInputs(root, itemOf("bug")));
    expect(inputs.tasks.map((t) => [t.id, t.testTypes])).toEqual([
      ["TASK-001", []],
      ["TASK-002", []],
      ["TASK-003", ["Unit"]],
    ]);
  });

  it("keeps today's checkbox tasks when the plan's Task Breakdown has no task", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, "# Implementation Plan\n\n## Task Breakdown\n\nNone yet.\n");
    const inputs = ok(readLoopInputs(root, itemOf("bug")));
    expect(inputs.tasks.map((t) => [t.id, t.files, t.wave, t.overlaps, t.inline])).toEqual([
      ["TASK-001", null, 1, ["TASK-002", "TASK-003"], false],
      ["TASK-002", null, 1, ["TASK-001", "TASK-003"], false],
      ["TASK-003", null, 1, ["TASK-001", "TASK-002"], false],
    ]);
  });
});

describe("kf verify on a bug with a Task Breakdown", () => {
  it("exits 2 naming a changed file outside the task's Files", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const base = gitIn(root, "rev-parse", "HEAD");
    await commit({ "src/a.ts": "a", "src/c.ts": "c" });

    const res = verifyTask(root, itemOf("bug"), "TASK-001", base);

    expect(res.code).toBe(2);
    expect(res.lines.join("\n")).toContain("1 file(s) outside TASK-001's Files:");
    expect(res.lines).toContain("  src/c.ts");
  });

  it("passes the allowlist check when every changed file is inside the task's Files", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const base = gitIn(root, "rev-parse", "HEAD");
    await commit({ "src/b.ts": "b" });

    const res = verifyTask(root, itemOf("bug"), "TASK-002", base);

    expect(res.code).toBe(0);
    expect(res.lines).toContain("Every changed file is inside TASK-002's Files.");
  });

  it("accepts a wave the plan has beyond wave 1", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const res = verifyWave(root, itemOf("bug"), 2);
    expect(res.lines.join("\n")).not.toContain("has no task in the plan");
    expect(res.code).toBe(0);
  });

  it("refuses a wave the plan does not have", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const res = verifyWave(root, itemOf("bug"), 3);
    expect(res.code).toBe(3);
    expect(res.lines.join("\n")).toContain("Wave 3 has no task in the plan of 'demo'.");
  });
});

describe("approval fingerprint of a bug", () => {
  it("keeps the report-only fingerprint when the bug has no plan", () => {
    expect(executionContractHash(itemDir, "bug")).toBe(REPORT_ONLY_HASH);
  });

  it("changes when the plan is edited after approval", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const approved = executionContractHash(itemDir, "bug");
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([...LANES, { id: "TASK-004", files: ["src/d.ts"] }]));
    expect(executionContractHash(itemDir, "bug")).not.toBe(approved);
  });

  it("reports approval_changed for an approved bug whose plan was edited", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(LANES));
    const approved = executionContractHash(itemDir, "bug");
    expect(approved).not.toBeNull();
    expect(checkApproval(itemOf("bug", approved!), true)).toEqual([]);

    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([...LANES, { id: "TASK-004", files: ["src/d.ts"] }]));
    expect(checkApproval(itemOf("bug", approved!), true).map((f) => f.code)).toEqual(["approval_changed"]);
  });
});

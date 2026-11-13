import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { parseMarkdownTable } from "../shared/frontmatter.js";
import * as taskModule from "../workflow/tasks.js";
import { parseTaskGraph, checkTaskGraph, taskView, taskWaves } from "../workflow/tasks.js";
import { validateFeature } from "../workflow/validate.js";
import type { Stage } from "../workflow/schema.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-taskgraph-"));
  ensureWorksStructure(root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const table = (rows: string[], header = "| Task | Description | Dependencies | Files |\n|---|---|---|---|") =>
  `# Plan\n\n## Task Breakdown\n\n${header}\n${rows.join("\n")}\n\n## Complexity\n`;

async function makeFeature(plan: string, stage: Stage = "planning", kind?: "bug"): Promise<ReturnType<typeof findFeature>> {
  const dir = join(root, ".works", stage, "tg_20260101_0000");
  await mkdir(dir, { recursive: true });
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "tg", context: "app", created: "20260101_0000", ...(kind ? { kind } : {}) });
  await writeFile(join(dir, "phase-2-implementation-plan.md"), plan);
  return findFeature(root, "tg");
}

const ROLE_HEADER = "| Task | Description | Dependencies | Role | Files |\n|---|---|---|---|---|";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("parseMarkdownTable", () => {
  it("parses the first table, trims cells and handles escaped pipes", () => {
    const t = parseMarkdownTable("text\n\n| A | B |\n|:--|--:|\n| 1 | a \\| b |\n|  2 |  |\n\nafter\n| X |\n|---|\n| no |");
    expect(t).toEqual({ headers: ["A", "B"], rows: [["1", "a | b"], ["2", ""]] });
  });
  it("returns null without a header and separator", () => {
    expect(parseMarkdownTable("- a\n- b")).toBeNull();
    expect(parseMarkdownTable("| only | header |")).toBeNull();
  });
});

describe("task graph validation", () => {
  it("reports duplicate, missing dependency and cycle, then is clean once fixed", async () => {
    const bad = table([
      "| TASK-001 | a | - | a.ts |",
      "| TASK-001 | dup | - | b.ts |",
      "| TASK-002 | b | TASK-003, TASK-009 | - |",
      "| TASK-003 | c | TASK-002 | - |",
      "| TASK-004 | d | TASK-004 | - |",
    ]);
    const f = (await makeFeature(bad))!;
    const issues = checkTaskGraph(f);
    expect(codes(issues).sort()).toEqual(["task_dep_cycle", "task_dep_cycle", "task_dep_missing", "task_duplicate"]);
    expect(issues.every((i) => i.severity === "ERROR" && i.file === "phase-2-implementation-plan.md")).toBe(true);
    const messages = issues.filter((i) => i.code === "task_dep_cycle").map((i) => i.message);
    expect(messages.some((m) => m.includes("TASK-002 → TASK-003 → TASK-002"))).toBe(true);
    expect(messages.some((m) => m.includes("TASK-004 → TASK-004"))).toBe(true);
    expect(codes(validateFeature(f, false, true).issues)).toContain("task_dep_cycle");

    const good = table([
      "| TASK-001 | a | - | a.ts |",
      "| TASK-002 | b | TASK-001 | - |",
      "| TASK-003 | c | TASK-002 | - |",
    ]);
    await writeFile(join(f.dir, "phase-2-implementation-plan.md"), good);
    expect(checkTaskGraph(f)).toEqual([]);
  });

  it("skips brainstorm items and checks a bug's plan as a feature's", async () => {
    const f = (await makeFeature(table(["| TASK-001 | a | TASK-009 | - |"])))!;
    expect(codes(checkTaskGraph(f))).toEqual(["task_dep_missing"]);
    expect(checkTaskGraph({ ...f, stage: "brainstorm" })).toEqual([]);
    expect(codes(checkTaskGraph({ ...f, meta: { ...f.meta!, kind: "bug" } }))).toEqual(["task_dep_missing"]);
  });

  it("parses a plan with a Role column to the same tasks and raises no unknown-role issue", async () => {
    const withRole = table([
      "| TASK-001 | a | - | coder | a.ts |",
      "| TASK-002 | b | TASK-001 | ghost | b.ts, c.ts |",
    ], ROLE_HEADER);
    const withoutRole = table([
      "| TASK-001 | a | - | a.ts |",
      "| TASK-002 | b | TASK-001 | b.ts, c.ts |",
    ]);
    expect(parseTaskGraph(withRole).tasks).toEqual(parseTaskGraph(withoutRole).tasks);
    const f = (await makeFeature(withRole))!;
    expect(checkTaskGraph(f)).toEqual([]);
    expect(codes(validateFeature(f, false, true).issues)).not.toContain("task_role_unknown");
  });

  it("exposes no role resolution", () => {
    expect(taskModule).not.toHaveProperty("resolveTaskRole");
    expect(taskModule).not.toHaveProperty("resolveStageRoles");
  });

  it("reports a cycle once however it is entered", async () => {
    const f = (await makeFeature(table([
      "| TASK-001 | a | TASK-002 | - |",
      "| TASK-002 | b | TASK-003 | - |",
      "| TASK-003 | c | TASK-001 | - |",
      "| TASK-004 | d | TASK-001 | - |",
    ])))!;
    const cycles = checkTaskGraph(f).filter((i) => i.code === "task_dep_cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toContain("TASK-001 → TASK-002 → TASK-003 → TASK-001");
  });
});

describe("tolerant parsing", () => {
  it("defaults files to null without a Files column", () => {
    const { tasks } = parseTaskGraph(table(["| TASK-001 | a | - |"], "| Task | Description | Dependencies |\n|---|---|---|"));
    expect(tasks).toEqual([{ id: "TASK-001", description: "a", dependencies: [], files: null }]);
  });

  it("finds no tasks for bullets or a missing section", () => {
    expect(parseTaskGraph("## Task Breakdown\n\n- TASK-001 do it\n- TASK-002 more\n").tasks).toEqual([]);
    expect(parseTaskGraph("# nothing").tasks).toEqual([]);
  });

  it("upper-cases ids and dependencies, and parses files", () => {
    const { tasks } = parseTaskGraph(table([
      "| task-001 | a | - | `a.ts`, b.ts, |",
      "| task-002 | b | task-001 |  |",
    ]));
    expect(tasks[0]).toMatchObject({ id: "TASK-001", files: ["a.ts", "b.ts"] });
    expect(tasks[1]).toMatchObject({ id: "TASK-002", dependencies: ["TASK-001"], files: null });
  });

  it.each([["-"], ["—"], ["None"], ["n/a"], [""]])("reads Dependencies %j as none", (cell) => {
    expect(parseTaskGraph(table([`| TASK-001 | a | ${cell} | - |`])).tasks[0].dependencies).toEqual([]);
  });

  it("extracts TASK tokens from free text", () => {
    const t = parseTaskGraph(table(["| TASK-002 | a | TASK-001 (schema), task-003 and notes | - |"])).tasks[0];
    expect(t.dependencies).toEqual(["TASK-001", "TASK-003"]);
  });

  it("does not error on a plan without a table", async () => {
    const f = (await makeFeature("# Plan\n\n## Task Breakdown\n\n- TASK-001 do it\n"))!;
    expect(checkTaskGraph(f)).toEqual([]);
  });

  it("parses the real Task Breakdown table of the task-harness plan", () => {
    const real = [
      "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |",
      "|---|---|---|---|---|---|---|---|",
      "| TASK-001 | Per-item lock file | Workflow core | - | `src/shared/lock.ts`, unit tests | FR-014 / UC-008 | - | src/shared/lock.ts, src/workflow/features.ts |",
      "| TASK-002 | Run-record upsert | Harness | TASK-001 | Fix + regression tests | FR-014 / UC-008 | - | src/harness/run.ts, src/tests/harness-run.test.ts |",
      "| TASK-004 | Generic markdown table parser; `checkTaskGraph` in `validateFeature` (`-`, `—`, `none`, `n/a`, free text → TASK-### tokens) | Validation | TASK-003 | Parser, validator | FR-001, FR-004 / UC-001 | - | src/shared/frontmatter.ts, src/workflow/tasks.ts |",
      "| TASK-005 | Task state | Workflow + CLI | TASK-001, TASK-004 | Command | FR-002, FR-004 / UC-002 | - | src/workflow/features.ts |",
    ].join("\n");
    const { tasks } = parseTaskGraph(`## Task Breakdown\n\n${real}\n\n## Complexity\n`);
    expect(tasks.map((t) => t.id)).toEqual(["TASK-001", "TASK-002", "TASK-004", "TASK-005"]);
    expect(tasks[0]).toMatchObject({ dependencies: [], files: ["src/shared/lock.ts", "src/workflow/features.ts"], refs: "FR-014 / UC-008" });
    expect(tasks[2]).toMatchObject({ dependencies: ["TASK-003"], expectedOutput: "Parser, validator" });
    expect(tasks[3].dependencies).toEqual(["TASK-001", "TASK-004"]);
    expect(taskWaves(tasks)).toEqual({ "TASK-001": 1, "TASK-002": 2, "TASK-004": 1, "TASK-005": 2 });
  });
});

describe("taskWaves", () => {
  it("uses longest dependency depth and survives cycles and unknown deps", () => {
    const { tasks } = parseTaskGraph(table([
      "| TASK-001 | a | - | - |",
      "| TASK-002 | b | TASK-001 | - |",
      "| TASK-003 | c | TASK-001, TASK-002 | - |",
      "| TASK-004 | d | TASK-099 | - |",
      "| TASK-005 | e | TASK-006 | - |",
      "| TASK-006 | f | TASK-005 | - |",
    ]));
    const w = taskWaves(tasks);
    expect([w["TASK-001"], w["TASK-002"], w["TASK-003"], w["TASK-004"]]).toEqual([1, 2, 3, 1]);
    expect(w["TASK-005"]).toBeGreaterThan(0);
  });
});

describe("taskView", () => {
  it("lists id, description, dependencies, files and wave without a role, even when the plan has a Role column", async () => {
    const f = (await makeFeature(table([
      "| TASK-001 | a | - | coder | a.ts |",
      "| TASK-002 | b | TASK-001 | ghost | - |",
    ], ROLE_HEADER)))!;
    expect(taskView(f)).toEqual([
      { id: "TASK-001", description: "a", dependencies: [], files: ["a.ts"], wave: 1, overlaps: [{ task: "TASK-002", entries: null }] },
      { id: "TASK-002", description: "b", dependencies: ["TASK-001"], files: null, wave: 2, overlaps: [{ task: "TASK-001", entries: null }] },
    ]);
  });
});

describe("taskGraphSummary", () => {
  type Row = ReturnType<typeof taskView>[number];
  const row = (id: string, wave: number, dependencies: string[], files: string[] | null, overlaps: string[] = []): Row => ({
    id,
    description: `Do ${id}`,
    dependencies,
    files,
    wave,
    overlaps: overlaps.map((task) => ({ task, entries: null })),
  });

  it("keeps a task with unknown files out of any width set larger than one", () => {
    const rows = [
      row("TASK-001", 1, [], ["src/a.ts"], ["TASK-003"]),
      row("TASK-002", 1, [], ["src/b.ts"], ["TASK-003"]),
      row("TASK-003", 1, [], null, ["TASK-001", "TASK-002"]),
    ];
    const summary = taskModule.taskGraphSummary(rows);
    expect(summary.maxWidth).toBe(2);
    expect(summary.widthSet).toEqual(["TASK-001", "TASK-002"]);
    expect(summary.widthSet).not.toContain("TASK-003");
    expect(summary.maxWidthExact).toBe(true);
  });

  it("never puts a task and its transitive dependency in the same width set", () => {
    const rows = [
      row("TASK-001", 1, [], ["src/a.ts"]),
      row("TASK-002", 2, ["TASK-001"], ["src/b.ts"]),
      row("TASK-003", 3, ["TASK-002"], ["src/c.ts"]),
      row("TASK-004", 1, [], ["src/d.ts"]),
    ];
    const summary = taskModule.taskGraphSummary(rows);
    expect(summary.maxWidth).toBe(2);
    expect(summary.widthSet).toHaveLength(2);
    expect(summary.widthSet.includes("TASK-001") && summary.widthSet.includes("TASK-003")).toBe(false);
    expect(summary.widthSet).toEqual(["TASK-001", "TASK-004"]);
    expect(summary.maxWidthExact).toBe(true);
    expect(summary.criticalPath).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
    expect(summary.length).toBe(3);
    expect(summary.earliestStart).toEqual({ "TASK-001": 1, "TASK-002": 2, "TASK-003": 3, "TASK-004": 1 });
  });

  it("excludes tasks whose files overlap from the same width set", () => {
    const rows = [
      row("TASK-001", 1, [], ["src/"], ["TASK-002"]),
      row("TASK-002", 1, [], ["src/a.ts"], ["TASK-001"]),
      row("TASK-003", 1, [], ["lib/x.ts"]),
    ];
    const summary = taskModule.taskGraphSummary(rows);
    expect(summary.maxWidth).toBe(2);
    expect(summary.widthSet).toEqual(["TASK-001", "TASK-003"]);
    expect(summary.maxWidthExact).toBe(true);
  });

  it("breaks critical path ties toward the lowest task id", () => {
    const rows = [
      row("TASK-001", 1, [], ["src/a.ts"]),
      row("TASK-002", 1, [], ["src/b.ts"]),
      row("TASK-003", 2, ["TASK-001"], ["src/c.ts"]),
      row("TASK-004", 2, ["TASK-002"], ["src/d.ts"]),
    ];
    const summary = taskModule.taskGraphSummary(rows);
    expect(summary.criticalPath).toEqual(["TASK-001", "TASK-003"]);
    expect(summary.length).toBe(2);
  });

  it("ignores a dependency that is not in the plan", () => {
    const summary = taskModule.taskGraphSummary([row("TASK-001", 1, ["TASK-099"], ["src/a.ts"])]);
    expect(summary.criticalPath).toEqual(["TASK-001"]);
    expect(summary.length).toBe(1);
    expect(summary.maxWidth).toBe(1);
    expect(summary.widthSet).toEqual(["TASK-001"]);
    expect(summary.maxWidthExact).toBe(true);
    expect(summary.earliestStart).toEqual({ "TASK-001": 1 });
  });

  it("reports an empty summary for no tasks", () => {
    expect(taskModule.taskGraphSummary([])).toEqual({ criticalPath: [], length: 0, maxWidth: 0, maxWidthExact: true, widthSet: [], earliestStart: {} });
  });

  // Deterministic LCG so the overlap pattern is stable across runs.
  const sparseOverlapRows = (count: number, seed: number): Row[] => {
    let state = seed;
    const next = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
    const ids = Array.from({ length: count }, (_, i) => `TASK-${String(i + 1).padStart(3, "0")}`);
    const overlaps = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (next() < 0.1) { overlaps.get(ids[i])!.push(ids[j]); overlaps.get(ids[j])!.push(ids[i]); }
      }
    }
    return ids.map((id, i) => row(id, 1, [], [`src/f${i}.ts`], overlaps.get(id)));
  };

  it("finishes a 60 task plan with 10 percent overlaps within 2000 ms and returns a conflict-free lower bound", () => {
    const rows = sparseOverlapRows(60, 20261101);
    const started = performance.now();
    const summary = taskModule.taskGraphSummary(rows);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(summary.maxWidthExact).toBe(false);
    expect(summary.maxWidth).toBe(summary.widthSet.length);
    expect(summary.maxWidth).toBeGreaterThan(1);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const a of summary.widthSet) {
      expect(byId.has(a)).toBe(true);
      for (const b of summary.widthSet) {
        if (a === b) continue;
        expect(byId.get(a)!.overlaps.map((o) => o.task)).not.toContain(b);
        expect(byId.get(a)!.dependencies).not.toContain(b);
      }
    }
  });

  it("keeps the greedy lower bound conflict-free across a dependency path", () => {
    const rows = sparseOverlapRows(40, 7).map((r, i, all) => (i === 0 ? r : i % 5 === 0 ? { ...r, wave: 2, dependencies: [all[i - 1].id] } : r));
    const summary = taskModule.taskGraphSummary(rows);
    expect(summary.maxWidthExact).toBe(false);
    expect(summary.maxWidth).toBe(summary.widthSet.length);
    const deps = new Map(rows.map((r) => [r.id, r.dependencies]));
    for (const a of summary.widthSet) for (const b of summary.widthSet) {
      if (a !== b) expect(deps.get(a)).not.toContain(b);
    }
  });

  it("stays exact at exactly 30 tasks", () => {
    const summary = taskModule.taskGraphSummary(sparseOverlapRows(30, 20261101));
    expect(summary.maxWidthExact).toBe(true);
    expect(summary.maxWidth).toBe(summary.widthSet.length);
  });

  it("stops being exact at 31 tasks", () => {
    const summary = taskModule.taskGraphSummary(sparseOverlapRows(31, 20261101));
    expect(summary.maxWidthExact).toBe(false);
  });
});

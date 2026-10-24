import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { parseMarkdownTable } from "../shared/frontmatter.js";
import { parseTaskGraph, checkTaskGraph, resolveTaskRole, resolveStageRoles, taskWaves } from "../workflow/tasks.js";
import { validateFeature } from "../workflow/validate.js";
import type { HarnessConfig } from "../harness/config.js";
import type { Stage } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";
import { cmdValidate } from "../cli/commands/inspect.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-taskgraph-"));
  ensureWorksStructure(root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const harness = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
  main: "lead",
  roles: { lead: { runner: "r" }, coder: { runner: "r" }, reviewer: { runner: "r" } },
  stages: {},
  runners: { r: { argv: ["x"] } } as unknown as HarnessConfig["runners"],
  ...over,
});

const table = (rows: string[], header = "| Task | Description | Dependencies | Role | Files |\n|---|---|---|---|---|") =>
  `# Plan\n\n## Task Breakdown\n\n${header}\n${rows.join("\n")}\n\n## Complexity\n`;

async function makeFeature(plan: string, stage: Stage = "planning", kind?: "bug"): Promise<ReturnType<typeof findFeature>> {
  const dir = join(root, ".works", stage, "tg_20260101_0000");
  await mkdir(dir, { recursive: true });
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "tg", context: "app", created: "20260101_0000", ...(kind ? { kind } : {}) });
  await writeFile(join(dir, "phase-2-implementation-plan.md"), plan);
  return findFeature(root, "tg");
}

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

describe("TC-001 task graph validation", () => {
  it("reports duplicate, missing dependency, cycle and unknown role, then is clean once fixed", async () => {
    const bad = table([
      "| TASK-001 | a | - | coder | a.ts |",
      "| TASK-001 | dup | - | coder | b.ts |",
      "| TASK-002 | b | TASK-003, TASK-009 | ghost | - |",
      "| TASK-003 | c | TASK-002 | - | - |",
      "| TASK-004 | d | TASK-004 | - | - |",
    ]);
    const f = (await makeFeature(bad))!;
    const issues = checkTaskGraph(f, harness());
    expect(codes(issues).sort()).toEqual(["task_dep_cycle", "task_dep_cycle", "task_dep_missing", "task_duplicate", "task_role_unknown"]);
    expect(issues.every((i) => i.severity === "ERROR" && i.file === "phase-2-implementation-plan.md")).toBe(true);
    const messages = issues.filter((i) => i.code === "task_dep_cycle").map((i) => i.message);
    expect(messages.some((m) => m.includes("TASK-002 → TASK-003 → TASK-002"))).toBe(true);
    expect(messages.some((m) => m.includes("TASK-004 → TASK-004"))).toBe(true);
    expect(codes(validateFeature(f, false, true, harness()).issues)).toContain("task_dep_cycle");

    const good = table([
      "| TASK-001 | a | - | coder | a.ts |",
      "| TASK-002 | b | TASK-001 | coder | - |",
      "| TASK-003 | c | TASK-002 | - | - |",
    ]);
    await writeFile(join(f.dir, "phase-2-implementation-plan.md"), good);
    expect(checkTaskGraph(f, harness())).toEqual([]);
  });

  it("skips the role check without a harness, and skips brainstorm and bug items", async () => {
    const plan = table(["| TASK-001 | a | - | ghost | - |"]);
    const f = (await makeFeature(plan))!;
    expect(checkTaskGraph(f)).toEqual([]);
    expect(codes(checkTaskGraph(f, harness()))).toEqual(["task_role_unknown"]);
    expect(checkTaskGraph({ ...f, stage: "brainstorm" }, harness())).toEqual([]);
    expect(checkTaskGraph({ ...f, meta: { ...f.meta!, kind: "bug" } }, harness())).toEqual([]);
  });

  it("reports a cycle once however it is entered", async () => {
    const f = (await makeFeature(table([
      "| TASK-001 | a | TASK-002 | - | - |",
      "| TASK-002 | b | TASK-003 | - | - |",
      "| TASK-003 | c | TASK-001 | - | - |",
      "| TASK-004 | d | TASK-001 | - | - |",
    ])))!;
    const cycles = checkTaskGraph(f).filter((i) => i.code === "task_dep_cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toContain("TASK-001 → TASK-002 → TASK-003 → TASK-001");
  });
});

describe("TC-002 tolerant parsing", () => {
  it("defaults role to '-' and files to null without Role/Files columns", () => {
    const { tasks } = parseTaskGraph(table(["| TASK-001 | a | - |"], "| Task | Description | Dependencies |\n|---|---|---|"));
    expect(tasks).toEqual([{ id: "TASK-001", description: "a", dependencies: [], role: "-", files: null }]);
  });

  it("finds no tasks for bullets or a missing section", () => {
    expect(parseTaskGraph("## Task Breakdown\n\n- TASK-001 do it\n- TASK-002 more\n").tasks).toEqual([]);
    expect(parseTaskGraph("# nothing").tasks).toEqual([]);
  });

  it("upper-cases ids and dependencies, and parses files", () => {
    const { tasks } = parseTaskGraph(table([
      "| task-001 | a | - | coder | `a.ts`, b.ts, |",
      "| task-002 | b | task-001 | - | |",
    ]));
    expect(tasks[0]).toMatchObject({ id: "TASK-001", role: "coder", files: ["a.ts", "b.ts"] });
    expect(tasks[1]).toMatchObject({ id: "TASK-002", dependencies: ["TASK-001"], files: null });
  });

  it.each([["-"], ["—"], ["None"], ["n/a"], [""]])("reads Dependencies %j as none", (cell) => {
    expect(parseTaskGraph(table([`| TASK-001 | a | ${cell} | - | - |`])).tasks[0].dependencies).toEqual([]);
  });

  it("extracts TASK tokens from free text", () => {
    const t = parseTaskGraph(table(["| TASK-002 | a | TASK-001 (schema), task-003 and notes | - | - |"])).tasks[0];
    expect(t.dependencies).toEqual(["TASK-001", "TASK-003"]);
  });

  it("does not error on a plan without a table", async () => {
    const f = (await makeFeature("# Plan\n\n## Task Breakdown\n\n- TASK-001 do it\n"))!;
    expect(checkTaskGraph(f, harness())).toEqual([]);
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
    expect(tasks[0]).toMatchObject({ dependencies: [], role: "-", files: ["src/shared/lock.ts", "src/workflow/features.ts"], refs: "FR-014 / UC-008" });
    expect(tasks[2]).toMatchObject({ dependencies: ["TASK-003"], expectedOutput: "Parser, validator" });
    expect(tasks[3].dependencies).toEqual(["TASK-001", "TASK-004"]);
    expect(taskWaves(tasks)).toEqual({ "TASK-001": 1, "TASK-002": 2, "TASK-004": 1, "TASK-005": 2 });
  });
});

describe("TC-003 role resolution", () => {
  it("uses a declared plan role, and falls back for '-'", () => {
    const withStage = harness({ stages: { implementation: ["coder", "reviewer"] } });
    expect(resolveTaskRole({ role: "reviewer" }, withStage)).toBe("reviewer");
    expect(resolveTaskRole({ role: "-" }, withStage)).toBe("coder");
    expect(resolveTaskRole({ role: "-" }, harness())).toBe("lead");
    expect(resolveTaskRole({ role: "ghost" }, harness())).toBe("lead");
  });

  it("resolves stage roles with fallback to main", () => {
    const h = harness({ stages: { review: ["reviewer"] } });
    expect(resolveStageRoles("review", h)).toEqual(["reviewer"]);
    expect(resolveStageRoles("testing", h)).toEqual(["lead"]);
  });
});

describe("taskWaves", () => {
  it("uses longest dependency depth and survives cycles and unknown deps", () => {
    const { tasks } = parseTaskGraph(table([
      "| TASK-001 | a | - | - | - |",
      "| TASK-002 | b | TASK-001 | - | - |",
      "| TASK-003 | c | TASK-001, TASK-002 | - | - |",
      "| TASK-004 | d | TASK-099 | - | - |",
      "| TASK-005 | e | TASK-006 | - | - |",
      "| TASK-006 | f | TASK-005 | - | - |",
    ]));
    const w = taskWaves(tasks);
    expect([w["TASK-001"], w["TASK-002"], w["TASK-003"], w["TASK-004"]]).toEqual([1, 2, 3, 1]);
    expect(w["TASK-005"]).toBeGreaterThan(0);
  });
});

describe("task_harness_needs_worktree (TC-029 B/C)", () => {
  const validateArgs = (options: Record<string, unknown>): ParsedArgs => ({ command: "validate", positionals: [], options });
  const writeConfig = async (extra: Record<string, unknown>) => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow",
      created: "20260101_0000",
      worktree: { enabled: false },
      harness: {
        main: "lead",
        roles: { lead: { runner: "r" } },
        stages: {},
        runners: { r: { start: ["r", "{prompt}"] } },
        ...extra,
      },
    }));
  };
  const warned = async (stage: Stage) => {
    await makeFeature(table(["| TASK-001 | a | - | - | src/a.ts |"]), stage);
    const res = await cmdValidate(validateArgs({ change: "tg", json: true }), root);
    const [item] = JSON.parse(res.stdout) as { issues: { code: string }[] }[];
    return codes(item.issues).includes("task_harness_needs_worktree");
  };

  it("warns in planning when verify.stage is set and worktrees are off", async () => {
    await writeConfig({ verify: { stage: [["npm", "test"]] } });
    expect(await warned("planning")).toBe(true);
  });

  it("warns in backlog too, but not once the item is in implementation", async () => {
    await writeConfig({ verify: { stage: [["npm", "test"]] } });
    expect(await warned("backlog")).toBe(true);
    await rm(join(root, ".works", "backlog"), { recursive: true, force: true });
    ensureWorksStructure(root);
    expect(await warned("implementation")).toBe(false);
  });

  it("stays silent for a project that never opted into driving", async () => {
    await writeConfig({});
    expect(await warned("planning")).toBe(false);
  });
});

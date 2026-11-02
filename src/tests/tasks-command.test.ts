import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdTasks } from "../cli/commands/tasks.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import type { TaskViewRow } from "../workflow/tasks.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (options: Record<string, unknown> = {}): ParsedArgs => ({ command: "tasks", positionals: ["demo"], options });

interface PlanTask {
  id: string;
  deps?: string[];
  files?: string[];
}

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

function planWithTasks(tasks: PlanTask[]): string {
  const list = (v: string[] | undefined) => (v && v.length ? v.join(", ") : "-");
  const rows = tasks.map((t) => `| ${t.id} | Do ${t.id} | Core | ${list(t.deps)} | Change merged | FR-001 / UC-001 | coder | ${list(t.files)} |`);
  return `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${rows.join("\n")}\n`;
}

let root: string;
let itemDir: string;

async function writePlan(tasks: PlanTask[]): Promise<void> {
  await writeFile(join(itemDir, ARTIFACTS["implementation-plan"].file), planWithTasks(tasks));
}

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-tasks-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" }, coder: { runner: "claude" } },
      stages: { implementation: ["coder"] },
      runners: { claude: { start: ["claude", "{prompt}"] } },
    },
  }));
  itemDir = join(root, ".works", "implementation", "demo_20260919_1200");
  await mkdir(itemDir, { recursive: true });
  await writeFile(join(itemDir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200" }));
  await writePlan([
    { id: "TASK-001", files: ["src/a.ts"] },
    { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.ts", "src/c.ts"] },
    { id: "TASK-003", deps: ["TASK-001", "TASK-002"] },
  ]);
  writeFileSync(join(itemDir, "tasks.md"), "# Tasks\n\n## Tasks\n\n- [x] TASK-001 — Do TASK-001\n- [ ] TASK-002 — later\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf tasks", () => {
  it("reports state from the tasks.md checkboxes, wave, deps and files as JSON, with no role", async () => {
    const res = await cmdTasks(args({ json: true }), root);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as { feature: string; tasks: Array<TaskViewRow & { state: string }> };
    expect(out.feature).toBe("demo");
    expect(out.tasks.map((t) => [t.id, t.state, t.wave])).toEqual([
      ["TASK-001", "done", 1],
      ["TASK-002", "ready", 2],
      ["TASK-003", "pending", 3],
    ]);
    for (const t of out.tasks) expect(t).not.toHaveProperty("role");
    expect(out.tasks[1].files).toEqual(["src/b.ts", "src/c.ts"]);
    expect(out.tasks[1].dependencies).toEqual(["TASK-001"]);
    expect(out.tasks[2].files).toBeNull();
  });

  it("shows the same data in text mode", async () => {
    const res = await cmdTasks(args(), root);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^TASK-001 +wave 1 +done +deps: - +files: src\/a\.ts$/);
    expect(lines[1]).toMatch(/^TASK-002 +wave 2 +ready +deps: TASK-001 +files: src\/b\.ts, src\/c\.ts$/);
    expect(lines[2]).toMatch(/^TASK-003 +wave 3 +pending +deps: TASK-001, TASK-002 +files: files unknown$/);
  });

  it("accepts a plan whose Role column names an unknown role and prints no role", async () => {
    await writeFile(join(itemDir, ARTIFACTS["implementation-plan"].file), `# Implementation Plan\n\n## Task Breakdown\n\n${TABLE_HEADER}\n`
      + "| TASK-001 | Do it | Core | - | Done | FR-001 / UC-001 | ghost-role | src/a.ts |\n");
    const res = await cmdTasks(args(), root);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("ghost-role");
    expect(res.stdout).toMatch(/^TASK-001 +wave 1 +done +deps: - +files: src\/a\.ts$/);
  });

  it("reads tasks.md without writing it", async () => {
    const file = join(itemDir, "tasks.md");
    const before = readFileSync(file, "utf8");
    expect((await cmdTasks(args({ json: true }), root)).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("shows every task pending or ready when there is no tasks.md", async () => {
    await rm(join(itemDir, "tasks.md"));
    const out = JSON.parse((await cmdTasks(args({ json: true }), root)).stdout) as { tasks: Array<{ id: string; state: string }> };
    expect(out.tasks.map((t) => [t.id, t.state])).toEqual([
      ["TASK-001", "ready"],
      ["TASK-002", "pending"],
      ["TASK-003", "pending"],
    ]);
    expect(existsSync(join(itemDir, "tasks.md"))).toBe(false);
  });

  it("ignores leftover per-task state in .kfw.json", async () => {
    await writeFile(join(itemDir, METADATA_FILE), JSON.stringify({
      schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200",
      tasks: { "TASK-001": { state: "blocked", reason: "allowlist violation" } },
    }));
    const out = JSON.parse((await cmdTasks(args({ json: true }), root)).stdout) as { tasks: Array<Record<string, unknown>> };
    expect(out.tasks[0]).toMatchObject({ id: "TASK-001", state: "done" });
    expect(out.tasks[0]).not.toHaveProperty("reason");
    expect(out.tasks[1]).not.toHaveProperty("blockedBy");
  });

  it("exits 1 for an unknown feature", async () => {
    const res = await cmdTasks({ command: "tasks", positionals: ["ghost"], options: {} }, root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Unknown feature 'ghost'");
  });

  it("exits 1 printing task_dep_cycle on a cyclic plan", async () => {
    await writePlan([{ id: "TASK-001", deps: ["TASK-002"] }, { id: "TASK-002", deps: ["TASK-001"] }]);
    const res = await cmdTasks(args(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("task_dep_cycle");
  });

  it("says there are no planned tasks when the plan has no table", async () => {
    await writePlan([]);
    const res = await cmdTasks(args(), root);
    expect(res).toMatchObject({ code: 0, stdout: "No planned tasks." });
  });
});

describe("kf tasks overlaps", () => {
  const overlapPlan: PlanTask[] = [
    { id: "TASK-001", files: ["src/a.ts"] },
    { id: "TASK-002", files: ["src/b.ts"] },
    { id: "TASK-003", files: ["src/"] },
    { id: "TASK-004" },
  ];

  it("lists every other task whose files are not disjoint, with the first overlapping entry pair", async () => {
    await writePlan(overlapPlan);
    const out = JSON.parse((await cmdTasks(args({ json: true }), root)).stdout) as { tasks: Array<{ id: string; overlaps: Array<{ task: string; entries: [string, string] | null }> }> };
    expect(out.tasks.map((t) => [t.id, t.overlaps.map((o) => o.task)])).toEqual([
      ["TASK-001", ["TASK-003", "TASK-004"]],
      ["TASK-002", ["TASK-003", "TASK-004"]],
      ["TASK-003", ["TASK-001", "TASK-002", "TASK-004"]],
      ["TASK-004", ["TASK-001", "TASK-002", "TASK-003"]],
    ]);
    expect(out.tasks[0].overlaps[0].entries).toEqual(["src/a.ts", "src/"]);
    expect(out.tasks[0].overlaps[1].entries).toBeNull();
    expect(out.tasks[1].overlaps[1].entries).toBeNull();
    expect(out.tasks[2].overlaps[0].entries).toEqual(["src/", "src/a.ts"]);
    for (const o of out.tasks[3].overlaps) expect(o.entries).toBeNull();
  });

  it("keeps the text rows free of overlaps", async () => {
    await writePlan(overlapPlan);
    const res = await cmdTasks(args(), root);
    expect(res.stdout).not.toContain("overlap");
    const lines = res.stdout.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^TASK-001 +wave 1 +\w+ +deps: - +files: src\/a\.ts$/);
    expect(lines[3]).toMatch(/^TASK-004 +wave 1 +\w+ +deps: - +files: files unknown$/);
  });
});

describe("kf tasks --graph", () => {
  const graphPlan: PlanTask[] = [
    { id: "TASK-001", files: ["src/a.ts"] },
    { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.ts"] },
    { id: "TASK-003", deps: ["TASK-002"], files: ["src/c.ts"] },
    { id: "TASK-004", files: ["src/d.ts"] },
    { id: "TASK-005", files: ["src/e.ts"] },
    { id: "TASK-006", files: ["src/f.ts"] },
  ];

  it("prints the critical path, the max width and the earliest starts", async () => {
    await writePlan(graphPlan);
    const res = await cmdTasks(args({ graph: true }), root);
    expect(res.code).toBe(0);
    expect(res.stdout.split("\n")).toEqual([
      "critical path: TASK-001 \u2192 TASK-002 \u2192 TASK-003 (length 3)",
      "max width: 4 (TASK-001, TASK-004, TASK-005, TASK-006)",
      "earliest start: TASK-001 1, TASK-002 2, TASK-003 3, TASK-004 1, TASK-005 1, TASK-006 1",
    ]);
  });

  it("prints the graph as JSON with the graph keys and an exact flag", async () => {
    await writePlan(graphPlan);
    const res = await cmdTasks(args({ graph: true, json: true }), root);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["criticalPath", "earliestStart", "feature", "length", "maxWidth", "maxWidthExact", "widthSet"]);
    expect(out).toEqual({
      feature: "demo",
      criticalPath: ["TASK-001", "TASK-002", "TASK-003"],
      length: 3,
      maxWidth: 4,
      maxWidthExact: true,
      widthSet: ["TASK-001", "TASK-004", "TASK-005", "TASK-006"],
      earliestStart: { "TASK-001": 1, "TASK-002": 2, "TASK-003": 3, "TASK-004": 1, "TASK-005": 1, "TASK-006": 1 },
    });
  });

  it("leaves --json without --graph byte-identical to the task listing", async () => {
    await writePlan(graphPlan);
    const task = (id: string, description: string, dependencies: string[], files: string[], wave: number, state: string) =>
      ({ id, description, dependencies, files, wave, overlaps: [], state });
    const expected = JSON.stringify({
      feature: "demo",
      tasks: [
        task("TASK-001", "Do TASK-001", [], ["src/a.ts"], 1, "done"),
        task("TASK-002", "Do TASK-002", ["TASK-001"], ["src/b.ts"], 2, "ready"),
        task("TASK-003", "Do TASK-003", ["TASK-002"], ["src/c.ts"], 3, "pending"),
        task("TASK-004", "Do TASK-004", [], ["src/d.ts"], 1, "ready"),
        task("TASK-005", "Do TASK-005", [], ["src/e.ts"], 1, "ready"),
        task("TASK-006", "Do TASK-006", [], ["src/f.ts"], 1, "ready"),
      ],
    }, null, 2);
    expect((await cmdTasks(args({ json: true }), root)).stdout).toBe(expected);
  });

  it("prints none and zero for a plan without tasks", async () => {
    await writePlan([]);
    const res = await cmdTasks(args({ graph: true }), root);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toContain("critical path: none (length 0)");
    expect(lines).toContain("max width: 0");
  });

  it("exits 1 printing task_dep_cycle on a cyclic plan", async () => {
    await writePlan([{ id: "TASK-001", deps: ["TASK-002"] }, { id: "TASK-002", deps: ["TASK-001"] }]);
    const res = await cmdTasks(args({ graph: true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("task_dep_cycle");
    expect(res.stdout).not.toContain("critical path");
  });

  it("exits 1 for an unknown feature", async () => {
    const res = await cmdTasks({ command: "tasks", positionals: ["ghost"], options: { graph: true } }, root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Unknown feature 'ghost'");
  });

  const disjointPlan = (count: number): PlanTask[] =>
    Array.from({ length: count }, (_, i) => ({ id: `TASK-${String(i + 1).padStart(3, "0")}`, files: [`src/f${i}.ts`] }));

  it("prints an exact max width for a plan of 30 tasks", async () => {
    await writePlan(disjointPlan(30));
    const res = await cmdTasks(args({ graph: true }), root);
    expect(res.code).toBe(0);
    expect(res.stdout.split("\n")[1]).toMatch(/^max width: 30 \(TASK-001, /);
    const json = JSON.parse((await cmdTasks(args({ graph: true, json: true }), root)).stdout) as { maxWidth: number; maxWidthExact: boolean };
    expect(json).toMatchObject({ maxWidth: 30, maxWidthExact: true });
  });

  it("prints a lower bound marker for a plan of more than 30 tasks", async () => {
    await writePlan(disjointPlan(31));
    const res = await cmdTasks(args({ graph: true }), root);
    expect(res.code).toBe(0);
    expect(res.stdout.split("\n")[1]).toMatch(/^max width: \u226531 \(TASK-001, .*TASK-031\)$/);
    const json = JSON.parse((await cmdTasks(args({ graph: true, json: true }), root)).stdout) as { maxWidth: number; maxWidthExact: boolean; widthSet: string[] };
    expect(json.maxWidthExact).toBe(false);
    expect(json.maxWidth).toBe(31);
    expect(json.widthSet).toHaveLength(31);
  });
});

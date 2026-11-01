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

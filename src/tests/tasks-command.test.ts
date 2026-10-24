import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gitDriveProject, type GitDriveProject } from "./helpers/git-fixture.js";
import { cmdTasks } from "../cli/commands/tasks.js";
import { writeFeatureMeta, type TaskState } from "../workflow/features.js";
import { renderTasksMd, writeTasksMd, type TaskViewRow } from "../workflow/tasks.js";
import { countTasks } from "../workflow/status.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (options: Record<string, unknown> = {}): ParsedArgs => ({ command: "tasks", positionals: ["demo"], options });

let p: GitDriveProject;

async function setTasks(tasks: Record<string, TaskState>): Promise<void> {
  await writeFeatureMeta(p.itemDir(), { ...p.readMeta()!, tasks });
}

describe("kf tasks (TC-006)", () => {
  beforeEach(async () => {
    p = await gitDriveProject({
      tasks: [
        { id: "TASK-001", files: ["src/a.ts"] },
        { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.ts", "src/c.ts"] },
        { id: "TASK-003", deps: ["TASK-001", "TASK-002"] },
      ],
    });
    await setTasks({ "TASK-001": { state: "done" } });
  });
  afterEach(async () => {
    await p.cleanup();
  });

  it("reports state, wave, role, deps and files as JSON", async () => {
    const res = await cmdTasks(args({ json: true }), p.root);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as { feature: string; tasks: TaskViewRow[] };
    expect(out.feature).toBe("demo");
    expect(out.tasks.map((t) => [t.id, t.state, t.wave, t.role])).toEqual([
      ["TASK-001", "done", 1, "coder"],
      ["TASK-002", "ready", 2, "coder"],
      ["TASK-003", "pending", 3, "coder"],
    ]);
    expect(out.tasks[1].files).toEqual(["src/b.ts", "src/c.ts"]);
    expect(out.tasks[1].dependencies).toEqual(["TASK-001"]);
    expect(out.tasks[2].files).toBeNull();
  });

  it("shows the same data in text mode", async () => {
    const res = await cmdTasks(args(), p.root);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^TASK-001 +wave 1 +done +coder +deps: - +files: src\/a\.ts$/);
    expect(lines[1]).toMatch(/^TASK-002 +wave 2 +ready +coder +deps: TASK-001 +files: src\/b\.ts, src\/c\.ts$/);
    expect(lines[2]).toMatch(/^TASK-003 +wave 3 +pending +coder +deps: TASK-001, TASK-002 +files: files unknown$/);
  });

  it("names the blocked dependency of a pending task and does not write", async () => {
    await setTasks({ "TASK-001": { state: "blocked", reason: "allowlist violation" } });
    const out = JSON.parse((await cmdTasks(args({ json: true }), p.root)).stdout) as { tasks: TaskViewRow[] };
    expect(out.tasks[0]).toMatchObject({ state: "blocked", reason: "allowlist violation" });
    expect(out.tasks[1]).toMatchObject({ state: "pending", blockedBy: "TASK-001" });
    expect(existsSync(join(p.itemDir(), "tasks.md"))).toBe(false);
  });

  it("exits 1 for an unknown feature", async () => {
    const res = await cmdTasks({ command: "tasks", positionals: ["ghost"], options: {} }, p.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Unknown feature 'ghost'");
  });

  it("exits 1 printing task_dep_cycle on a cyclic plan", async () => {
    await p.writePlan([{ id: "TASK-001", deps: ["TASK-002"] }, { id: "TASK-002", deps: ["TASK-001"] }]);
    const res = await cmdTasks(args(), p.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("task_dep_cycle");
    expect(existsSync(join(p.itemDir(), "tasks.md"))).toBe(false);
  });

  it("says there are no planned tasks when the plan has no table", async () => {
    await p.writePlan([]);
    const res = await cmdTasks(args(), p.root);
    expect(res).toMatchObject({ code: 0, stdout: "No planned tasks." });
  });
});

describe("tasks.md rendering (TC-007)", () => {
  const row = (id: string, state: TaskViewRow["state"], reason?: string): TaskViewRow => ({
    id, description: `Do ${id}`, role: "coder", dependencies: [], files: null, wave: 1, state, ...(reason ? { reason } : {}),
  });
  const view = [row("TASK-001", "done"), row("TASK-002", "blocked", "merge conflict")];
  const baseline = { sha: "abc1234", porcelain: [" M src/x.ts", "?? notes.md"] };

  beforeEach(async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001" }, { id: "TASK-002" }] });
  });
  afterEach(async () => {
    await p.cleanup();
  });

  it("keeps Baseline byte-identical, ticks only done tasks and counts 1/2", async () => {
    const feature = p.feature();
    const file = join(p.itemDir(), "tasks.md");
    await writeTasksMd(feature, view, baseline);
    const first = readFileSync(file, "utf8");
    const section = (md: string) => md.slice(md.indexOf("## Baseline"), md.indexOf("## Tasks"));
    expect(section(first)).toContain("abc1234");
    expect(section(first)).toContain(" M src/x.ts");

    await writeTasksMd(feature, view, { sha: "different", porcelain: [] });
    const second = readFileSync(file, "utf8");
    expect(second).toBe(first);
    expect(section(second)).toBe(section(first));

    expect(first.split("\n").filter((l) => /^\s*- \[[ xX]\]/.test(l))).toEqual([
      "- [x] TASK-001 — Do TASK-001",
      "- [ ] TASK-002 — Do TASK-002 (blocked: merge conflict)",
    ]);
    expect(countTasks(first)).toEqual({ done: 1, total: 2 });
  });

  it("preserves a hand-written Baseline and omits it when none exists", () => {
    const existing = "# Tasks\n\n## Baseline\n\nsha: deadbeef\n M a.ts\n\n## Tasks\n\n- [ ] TASK-001 — old\n";
    const out = renderTasksMd(existing, view);
    expect(out).toContain("## Baseline\n\nsha: deadbeef\n M a.ts\n\n## Tasks");
    expect(renderTasksMd(out, view)).toBe(out);
    expect(renderTasksMd(null, view)).not.toContain("Baseline");
  });

  it("marks failed tasks and never ticks them", () => {
    const out = renderTasksMd(null, [row("TASK-001", "failed", "verify failed\nline two")]);
    expect(out).toContain("- [ ] TASK-001 — Do TASK-001 (failed: verify failed line two)");
  });
});

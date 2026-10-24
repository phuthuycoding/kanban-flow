import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ARTIFACTS } from "../workflow/schema.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import { cmdWorktree } from "../cli/commands/worktree.js";
import { worktreeConfig } from "../worktree/config.js";
import {
  createTaskWorktree,
  isTaskWorktreePath,
  listTaskWorktrees,
  removeTaskWorktree,
  taskBranch,
  taskWorktreePath,
} from "../worktree/tasks.js";
import { listWorktrees } from "../worktree/manager.js";
import { gitDriveProject, type GitDriveProject } from "./helpers/git-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

let p: GitDriveProject;

beforeEach(async () => {
  p = await gitDriveProject({ tasks: [{ id: "TASK-001" }, { id: "TASK-002" }] });
});
afterEach(async () => {
  await p.cleanup();
});

const cfg = () => worktreeConfig(p.root, {
  enabled: true,
  baseDir: join(p.scratch, "wt"),
  routesFile: join(p.scratch, "routes.json"),
});

/** Drive the item to review with a PASS testing/review pair so archive's gates pass. */
async function reviewReady(): Promise<void> {
  expect((await cmdStage(args("stage", ["demo", "testing"]), p.root)).code).toBe(0);
  const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 1 passed |\n";
  const report = (id: "testing-result" | "review-report") =>
    writeFile(join(p.itemDir(), ARTIFACTS[id].file),
      `---\nstatus: PASS\nexecution: ${p.feature().meta?.executionId}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
  await report("testing-result");
  expect((await cmdStage(args("stage", ["demo", "review"]), p.root)).code).toBe(0);
  await report("review-report");
  await writeFile(join(p.itemDir(), ARTIFACTS["feature-report"].file), "# Feature Report\nShipped.");
}

describe("task worktree naming", () => {
  it("lower-cases the id, nests the branch under the item branch and places the path beside the item worktree", () => {
    const wt = p.feature().meta!.worktree!;
    expect(taskBranch(wt.branch, "TASK-001")).toBe(`${wt.branch}--task-001`);
    const path = taskWorktreePath(cfg(), "demo", "TASK-001");
    expect(path).toBe(join(p.scratch, "wt", "demo.tasks", "task-001"));
    expect(path.startsWith(`${wt.path}/`)).toBe(false);
    expect(isTaskWorktreePath(cfg(), path)).toBe(true);
    expect(isTaskWorktreePath(cfg(), wt.path)).toBe(false);
  });

  it("gives TASK-001 and task-001 the same names and refuses invalid ids", () => {
    expect(taskBranch("kf/demo", "task-001")).toBe(taskBranch("kf/demo", "TASK-001"));
    expect(taskWorktreePath(cfg(), "demo", "task-001")).toBe(taskWorktreePath(cfg(), "demo", "TASK-001"));
    for (const bad of ["TASK-", "task_1", "../x", "TASK-001/../..", "T-1", ""]) {
      expect(() => taskBranch("kf/demo", bad)).toThrow(/Invalid task id/);
      expect(() => taskWorktreePath(cfg(), "demo", bad)).toThrow(/Invalid task id/);
    }
  });
});

describe("createTaskWorktree", () => {
  it("cuts from the item HEAD without routes, ports or meta changes", async () => {
    const metaBefore = JSON.stringify(p.readMeta());
    const itemPath = p.worktreePath()!;
    const head = p.git(itemPath, "rev-parse", "HEAD");
    const routesBefore = existsSync(join(p.scratch, "routes.json")) ? readFileSync(join(p.scratch, "routes.json"), "utf8") : null;

    const t = await createTaskWorktree(p.root, p.feature(), "task-001", cfg());

    expect(t.base).toBe(head);
    expect(t.branch).toBe(taskBranch(p.feature().meta!.worktree!.branch, "TASK-001"));
    expect(t.path).toBe(join(p.scratch, "wt", "demo.tasks", "task-001"));
    expect(p.git(t.path, "rev-parse", "HEAD")).toBe(head);
    expect(p.git(t.path, "symbolic-ref", "--short", "HEAD")).toBe(t.branch);
    expect(JSON.stringify(p.readMeta())).toBe(metaBefore);
    const routesAfter = existsSync(join(p.scratch, "routes.json")) ? readFileSync(join(p.scratch, "routes.json"), "utf8") : null;
    expect(routesAfter).toBe(routesBefore);
    expect(routesAfter ?? "").not.toContain("task-001");
    expect(listTaskWorktrees(p.root, "demo", cfg()).map((x) => x.task)).toEqual(["task-001"]);
  });

  it("requires an item worktree", async () => {
    const f = { ...p.feature(), meta: { ...p.feature().meta!, worktree: undefined } };
    await expect(createTaskWorktree(p.root, f, "TASK-001", cfg())).rejects.toThrow(/no item worktree/);
  });

  it("re-creates after the worktree dir vanished while the branch has no extra commits", async () => {
    const first = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    p.git(p.root, "worktree", "remove", "--force", first.path);
    const again = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    expect(again.path).toBe(first.path);
    expect(existsSync(again.path)).toBe(true);
  });

  it("reuses a still-registered worktree and refuses a stale branch that has commits", async () => {
    const first = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    const reused = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    expect(reused).toEqual(first);

    writeFileSync(join(first.path, "work.txt"), "x");
    p.git(first.path, "add", "-A");
    p.git(first.path, "commit", "-qm", "task work");
    removeTaskWorktree(p.root, first.path);
    await expect(createTaskWorktree(p.root, p.feature(), "TASK-001", cfg())).rejects.toThrow(new RegExp(first.branch));
    expect(p.git(p.root, "branch", "--list", first.branch)).toContain(first.branch);
  });
});

describe("task worktrees and kf worktree list / archive / cancel", () => {
  it("shows the task worktree under its item and reports no orphan (TC-016)", async () => {
    const t = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    const { items, orphans } = listWorktrees(p.root, cfg());
    expect(orphans).toEqual([]);
    expect(items[0].tasks).toEqual([{ task: "task-001", path: t.path, branch: t.branch, dirty: false }]);

    const json = JSON.parse((await cmdWorktree(args("worktree", ["list"], { json: true }), p.root)).stdout);
    expect(json.items[0].tasks[0].task).toBe("task-001");
    const text = (await cmdWorktree(args("worktree", ["list"]), p.root)).stdout;
    expect(text).toContain(`tasks:  task-001 (${t.branch})`);
    expect(text).not.toContain("Orphans");
  });

  it("leaves rows without task worktrees unchanged", () => {
    expect(listWorktrees(p.root, cfg()).items[0]).not.toHaveProperty("tasks");
  });

  it("archive removes a clean task worktree and reports the kept branch", async () => {
    const t = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    await reviewReady();
    const res = await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`kept task branch: ${t.branch}`);
    expect(existsSync(t.path)).toBe(false);
    expect(p.git(p.root, "branch", "--list", t.branch)).toContain(t.branch);
  });

  it("archive prints no task line when there are no task worktrees", async () => {
    await reviewReady();
    const res = await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).not.toContain("kept task branch");
  });

  it("cancel refuses with a dirty task worktree and changes nothing (TC-032)", async () => {
    const t = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    writeFileSync(join(t.path, "scratch.txt"), "uncommitted");
    const metaBefore = JSON.stringify(p.readMeta());
    const itemPath = p.worktreePath()!;
    const dirBefore = p.itemDir();

    const res = await cmdCancel(args("cancel", ["demo"], { reason: "drop it" }), p.root);

    expect(res.code).toBe(1);
    expect(res.stdout).toContain(t.path);
    expect(res.stdout).toContain("kf worktree remove demo --force");
    expect(p.itemDir()).toBe(dirBefore);
    expect(JSON.stringify(p.readMeta())).toBe(metaBefore);
    expect(existsSync(itemPath)).toBe(true);
    expect(existsSync(t.path)).toBe(true);
  });

  it("kf worktree remove --force removes a dirty task worktree and keeps its branch", async () => {
    const t = await createTaskWorktree(p.root, p.feature(), "TASK-001", cfg());
    writeFileSync(join(t.path, "scratch.txt"), "uncommitted");
    await expect(cmdWorktree(args("worktree", ["remove", "demo"]), p.root)).rejects.toThrow(/uncommitted changes/);
    expect(existsSync(t.path)).toBe(true);

    const res = await cmdWorktree(args("worktree", ["remove", "demo"], { force: true }), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(t.path)).toBe(false);
    expect(p.git(p.root, "branch", "--list", t.branch)).toContain(t.branch);
  });
});

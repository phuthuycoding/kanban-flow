import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { Feature } from "../workflow/features.js";
import {
  addWorktree,
  deleteBranch,
  pruneWorktrees,
  removeWorktree,
  revParse,
  runGit,
  trackedChanges,
  untrackedFiles,
} from "../shared/git.js";
import { branchExists, taskWorktreeEntries } from "./manager.js";
import { taskWorktreesDir, worktreeDir, type WorktreeConfig } from "./config.js";

export interface TaskWorktree {
  path: string;
  branch: string;
  base: string;
}

export interface TaskWorktreeInfo {
  /** Lower-cased id, e.g. `task-001`. */
  task: string;
  path: string;
  branch: string | null;
}

const TASK_ID = /^TASK-\d+$/i;

function slug(taskId: string): string {
  if (!TASK_ID.test(taskId)) {
    throw new Error(`Invalid task id '${taskId}': expected TASK-<number>, e.g. TASK-001.`);
  }
  return taskId.toLowerCase();
}

const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);

export function taskBranch(itemBranch: string, taskId: string): string {
  return `${itemBranch}--${slug(taskId)}`;
}

export function taskWorktreePath(cfg: WorktreeConfig, feature: string, taskId: string): string {
  return join(taskWorktreesDir(cfg, feature), slug(taskId));
}

/** True when `path` is a `<baseDir>/<feature>.tasks/<task>` directory. */
export function isTaskWorktreePath(cfg: WorktreeConfig, path: string): boolean {
  const base = worktreeDir(cfg, "x");
  const baseDir = real(dirname(base));
  const parent = dirname(path);
  return dirname(real(parent)) === baseDir && basename(parent).endsWith(".tasks");
}

export function listTaskWorktrees(root: string, feature: string, cfg: WorktreeConfig): TaskWorktreeInfo[] {
  return taskWorktreeEntries(root, cfg, feature).map((e) => ({ task: basename(e.path), path: e.path, branch: e.branch }));
}

/**
 * Cut a worktree + branch for one task from the item worktree's current HEAD. Touches no
 * ports, routes or hooks, and does not write meta — the caller records the returned state.
 */
export async function createTaskWorktree(
  root: string,
  feature: Feature,
  taskId: string,
  cfg: WorktreeConfig,
): Promise<TaskWorktree> {
  const item = feature.meta?.worktree;
  if (!item) {
    throw new Error(`Feature '${feature.name}' has no item worktree; task worktrees are cut from it.`);
  }
  const branch = taskBranch(item.branch, taskId);
  const rawPath = taskWorktreePath(cfg, feature.name, taskId);
  const itemHead = revParse(item.path, "HEAD");
  if (!itemHead) throw new Error(`Cannot resolve HEAD of the item worktree ${item.path}.`);

  await mkdir(dirname(rawPath), { recursive: true });
  const path = join(realpathSync(dirname(rawPath)), basename(rawPath));

  // A leftover admin entry for a deleted directory must not read as a live worktree.
  pruneWorktrees(root);

  if (branchExists(root, branch)) {
    if (taskWorktreeEntries(root, cfg, feature.name).some((e) => e.path === path && e.branch === branch)) {
      const mergeBase = runGit(root, ["merge-base", branch, itemHead]);
      return { path, branch, base: mergeBase.code === 0 && mergeBase.stdout.trim() ? mergeBase.stdout.trim() : itemHead };
    }
    const ahead = Number(runGit(root, ["rev-list", "--count", `${itemHead}..${branch}`]).stdout.trim());
    if (ahead > 0) {
      throw new Error(
        `Branch '${branch}' from an earlier attempt has ${ahead} commit(s) beyond ${itemHead.slice(0, 8)} and no worktree — ` +
        `refusing to discard them. Merge or delete it (git branch -D ${branch}) first.`,
      );
    }
    deleteBranch(root, branch);
  }

  addWorktree(root, path, branch, itemHead);
  return { path, branch, base: itemHead };
}

/** Remove one task worktree; the branch is kept. Returns false when it was already gone. */
export function removeTaskWorktree(root: string, path: string, opts: { force?: boolean } = {}): boolean {
  const target = real(path);
  const registered = taskRegistered(root, target);
  if (!registered) {
    pruneWorktrees(root);
    return false;
  }
  removeWorktree(root, target, opts);
  return true;
}

function taskRegistered(root: string, realPath: string): boolean {
  const out = runGit(root, ["worktree", "list", "--porcelain"]).stdout;
  return out.split("\n").some((l) => l === `worktree ${realPath}`);
}

export function taskWorktreeDirty(path: string): boolean {
  return trackedChanges(path).length > 0 || untrackedFiles(path).length > 0;
}

/** Throws, changing nothing, when any task worktree of the item holds uncommitted work. */
export function assertTaskWorktreesClean(root: string, feature: string, cfg: WorktreeConfig): void {
  const dirty = listTaskWorktrees(root, feature, cfg).filter((t) => taskWorktreeDirty(t.path));
  if (dirty.length === 0) return;
  throw new Error(
    `Task worktree ${dirty.map((t) => t.path).join(", ")} of '${feature}' has uncommitted changes. ` +
    `Commit them inside it, or discard deliberately: kf worktree remove ${feature} --force`,
  );
}

/** Remove every task worktree of the item; returns the task branches left behind. */
export function removeTaskWorktrees(root: string, feature: string, cfg: WorktreeConfig, opts: { force?: boolean } = {}): string[] {
  const kept: string[] = [];
  for (const t of listTaskWorktrees(root, feature, cfg)) {
    removeTaskWorktree(root, t.path, opts);
    if (t.branch) kept.push(t.branch);
  }
  return kept;
}

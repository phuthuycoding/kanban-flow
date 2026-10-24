import { spawnSync } from "node:child_process";

import { findFeature, type TaskState } from "../workflow/features.js";
import type { PlannedTask } from "../workflow/tasks.js";
import type { HarnessConfig } from "./config.js";
import { LOCK_TIMEOUT_MS, withLock } from "../shared/lock.js";
import { readProjectConfig } from "../project/config.js";
import {
  changedPathsSince, commitAll, mergeAbort, mergeInProgress, mergeNoFf, resetHard, revParse, runGit, trackedChanges, untrackedFiles,
} from "../shared/git.js";
import { removeTaskWorktree, taskBranch, taskWorktreePath, type TaskWorktree } from "../worktree/tasks.js";
import { worktreeConfig } from "../worktree/config.js";
import { setTaskState, type CompleteTaskInput, type TaskCompletion } from "./task-state.js";

const SUBJECT_MAX = 72;
const OUTPUT_TAIL = 2000;
const VERIFY_MAX_BUFFER = 64 * 1024 * 1024;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * How long a task waits for the item's merge lock. Verify runs while the lock is held, so the generic 30s lock wait
 * would fail a second `kf run --task` (another process) behind any verify slower than that; wait out the holder's
 * run timeout instead. A run without a timeout waits without one.
 */
export function mergeLockWait(runTimeoutMs: number): number {
  return runTimeoutMs > 0 ? runTimeoutMs + LOCK_TIMEOUT_MS : Number.MAX_SAFE_INTEGER;
}

const normalise = (pattern: string): string => {
  let p = pattern.replace(/`/g, "").trim();
  while (p.startsWith("./")) p = p.slice(2);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
};

// A single star or question mark stays inside one path segment; a double star crosses segments, and a double star followed by a slash may match nothing.
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Exact path, directory prefix, or glob; a glob that matches a parent directory also allows what is inside it. */
export function pathAllowed(path: string, patterns: string[]): boolean {
  const segments = path.split("/");
  const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join("/"));
  return patterns.some((raw) => {
    const p = normalise(raw);
    if (p === "" || p === "." || p === "**") return true;
    if (!/[*?]/.test(p)) return path === p || path.startsWith(`${p}/`);
    const re = globToRegExp(p);
    return prefixes.some((x) => re.test(x));
  });
}

const subjectFor = (id: string, description: string): string => `task(${id}): ${description.replace(/\s+/g, " ").trim()}`.slice(0, SUBJECT_MAX).trimEnd();

/** Run the verify argv list in `cwd`; returns a failure reason, or null when all pass. */
export function runVerify(commands: string[][], cwd: string, timeoutMs: number): string | null {
  for (const argv of commands) {
    const res = spawnSync(argv[0], argv.slice(1), {
      cwd, encoding: "utf8", maxBuffer: VERIFY_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"], ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    });
    if (res.error) {
      const code = (res.error as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? `verify command not found: ${argv[0]}` : `verify command ${argv.join(" ")} could not finish: ${res.error.message}`;
    }
    if (res.status !== 0) {
      const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
      return output ? output.slice(-OUTPUT_TAIL) : `verify command failed (exit ${res.status ?? res.signal}): ${argv.join(" ")}`;
    }
  }
  return null;
}

/** Abort a merge left in progress; returns git's message when the abort itself fails. */
function abortIfMerging(dir: string): string | null {
  if (!mergeInProgress(dir)) return null;
  try {
    mergeAbort(dir);
    return null;
  } catch (err) {
    return message(err);
  }
}

type FinishFn = (state: TaskState["state"], reason?: string, extra?: Partial<TaskCompletion>, patch?: Partial<TaskState>) => Promise<TaskCompletion>;

/** What the merge, verify and cleanup steps need; a drive resumes with the same inputs minus the worker run. */
type MergeInput = Pick<CompleteTaskInput, "root" | "feature" | "harness" | "task" | "timeoutMs"> & { worktree: Pick<TaskWorktree, "path" | "branch"> };

function finisher(input: MergeInput): FinishFn {
  const { root, feature: name, harness, task } = input;
  return async (state, reason, extra = {}, patch = {}) => {
    await setTaskState(root, name, harness, task.id, { state, ...(reason !== undefined ? { reason } : {}), ...patch });
    const failed = state === "failed";
    return { state, ...(reason !== undefined ? { reason } : {}), retryable: failed, ...(failed && reason ? { failureForRetry: reason } : {}), ...extra };
  };
}

/**
 * Merge the task branch into the item branch and verify the result, both under the item's merge lock; a failed
 * verify resets the item branch to the pre-merge commit. `merged` skips the merge when the branch already landed
 * (a resumed drive), in which case `preMergeSha` — recorded before that merge — is the reset target.
 */
function mergeAndVerify(input: MergeInput, item: { path: string }, finish: FinishFn, merged?: { preMergeSha?: string }): Promise<TaskCompletion> {
  const { root, feature: name, harness, task, worktree } = input;
  return withLock(root, `${name}.merge`, async (): Promise<TaskCompletion> => {
    const dirty = trackedChanges(item.path);
    if (dirty.length > 0) return finish("blocked", `item worktree has uncommitted changes: ${dirty.join(", ")}`);
    const head = revParse(item.path, "HEAD");
    if (!head) throw new Error(`Cannot resolve HEAD of the item worktree ${item.path}.`);
    let preMergeSha = head;
    let mergeSha = head;
    if (merged) {
      if (!merged.preMergeSha) return finish("blocked", "the merge landed but its pre-merge commit is unknown, so a failed verify cannot be undone", { stop: "git_error" });
      preMergeSha = merged.preMergeSha;
    } else {
      await setTaskState(root, name, harness, task.id, { state: "merging", preMergeSha });
      const merge = mergeNoFf(item.path, worktree.branch, `Merge ${task.id}: ${task.description.replace(/\s+/g, " ").trim()}`.slice(0, SUBJECT_MAX));
      if (!merge.ok) {
        const abortError = abortIfMerging(item.path);
        if (abortError) return finish("blocked", abortError, { stop: "git_error" });
        return finish("blocked", merge.conflicts.length > 0 ? `conflicts: ${merge.conflicts.join(", ")}` : merge.error);
      }
      mergeSha = merge.sha;
    }

    await setTaskState(root, name, harness, task.id, { state: "verifying" });
    const failure = runVerify(harness.verify?.task ?? [], item.path, input.timeoutMs);
    if (failure) {
      try {
        resetHard(item.path, preMergeSha);
      } catch (err) {
        return finish("blocked", `could not reset the item branch to ${preMergeSha}: ${message(err)}`, { stop: "git_error" });
      }
      return finish("failed", failure);
    }
    return finish("done", undefined, {}, { mergeSha });
  }, { timeoutMs: mergeLockWait(input.timeoutMs) });
}

/**
 * After a DONE worker: allowlist -> kf commit on the task branch -> merge into the item branch and
 * verify (both under the item's merge lock) -> done. Every state change is written through setTaskState.
 */
export async function runCompletionPipeline(input: CompleteTaskInput): Promise<TaskCompletion> {
  const { root, feature: name, task, worktree } = input;
  const finish = finisher(input);

  const item = findFeature(root, name)?.meta?.worktree;
  if (!item) throw new Error(`Work item '${name}' lost its item worktree.`);

  if (task.files) {
    const violations = new Set<string>();
    for (const c of changedPathsSince(worktree.path, worktree.base)) {
      for (const p of [c.path, c.oldPath]) if (p && !pathAllowed(p, task.files)) violations.add(p);
    }
    if (violations.size > 0) {
      return finish("blocked", `files outside allowlist: ${[...violations].join(", ")}`, { stop: "plan_change_needed" });
    }
  }

  if (trackedChanges(worktree.path).length > 0 || untrackedFiles(worktree.path).length > 0) {
    const commit = commitAll(worktree.path, subjectFor(task.id, task.description), { timeoutMs: input.timeoutMs || undefined });
    if (!commit.ok) return finish("failed", commit.error || "git commit failed");
  }
  // A retry after a failed verify has its commit on the branch already, so "nothing to commit" is not "nothing to merge".
  const ahead = Number(runGit(item.path, ["rev-list", "--count", `HEAD..${worktree.branch}`]).stdout.trim());
  if (!(ahead > 0)) {
    const done = await finish("done", "no changes");
    return { ...done, ...(await removeWorktree(input)) };
  }

  const merged = await mergeAndVerify(input, item, finish);
  if (merged.state !== "done") return merged;
  return { ...merged, ...(await removeWorktree(input)) };
}

export interface ResumeMergeInput {
  root: string;
  feature: string;
  harness: HarnessConfig;
  task: PlannedTask;
  /** The task's stored state (`merging` or `verifying`). */
  stored: Pick<TaskState, "branch" | "preMergeSha">;
  timeoutMs: number;
}

/**
 * Finish the merge of a task a crashed drive left in `merging`/`verifying` (after recoverItemMerge): when its branch is
 * already an ancestor of the item HEAD only verify runs, otherwise merge and verify. Same outcomes as the pipeline.
 */
export async function resumeTaskMerge(input: ResumeMergeInput): Promise<TaskCompletion> {
  const { root, feature: name, harness, task } = input;
  const found = findFeature(root, name);
  const item = found?.meta?.worktree;
  if (!found?.meta || !item) throw new Error(`Work item '${name}' lost its item worktree.`);
  const branch = input.stored.branch ?? taskBranch(item.branch, task.id);
  const wt = worktreeConfig(root, readProjectConfig(root).worktree);
  const merge: MergeInput = { root, feature: name, harness, task, timeoutMs: input.timeoutMs, worktree: { branch, path: taskWorktreePath(wt, name, task.id) } };
  const finish = finisher(merge);
  const landed = runGit(item.path, ["merge-base", "--is-ancestor", branch, "HEAD"]).code === 0;
  const done = await mergeAndVerify(merge, item, finish, landed ? { preMergeSha: input.stored.preMergeSha } : undefined);
  if (done.state !== "done") return done;
  return { ...done, ...(await removeWorktree(merge)) };
}

/** Non-force removal after success; the state stays `done` and a failure becomes a warning. */
async function removeWorktree(input: MergeInput): Promise<{ warning?: string }> {
  try {
    removeTaskWorktree(input.root, input.worktree.path);
    return {};
  } catch (err) {
    const warning = `task worktree not removed: ${message(err)}`;
    const current = findFeature(input.root, input.feature)?.meta?.tasks?.[input.task.id];
    await setTaskState(input.root, input.feature, input.harness, input.task.id, { state: current?.state ?? "done", reason: warning });
    return { warning };
  }
}

/**
 * Resume recovery for an item's merges (the driver then retries). Rules, exactly:
 * 1. A merge is in progress in the item worktree: `merge --abort`, and every task in `merging` goes back
 *    to `verifying` with a note, so the driver retries that merge once.
 * 2. No merge in progress: a task in `merging`/`verifying` whose recorded preMergeSha differs from the item
 *    HEAD had its merge land; HEAD is left alone and the task becomes `verifying` so the driver re-runs verify.
 * Anything else (HEAD still at preMergeSha, other states) is left untouched. A failed abort throws.
 */
export async function recoverItemMerge(root: string, feature: string): Promise<void> {
  const found = findFeature(root, feature);
  const item = found?.meta?.worktree;
  if (!found?.meta || !item) return;
  const harness = readProjectConfig(root).harness;
  if (!harness) throw new Error("No harness configured in .kf/config.json.");
  const tasks = found.meta.tasks ?? {};
  const inFlight = Object.entries(tasks).filter(([, t]) => t.state === "merging" || t.state === "verifying");

  if (mergeInProgress(item.path)) {
    mergeAbort(item.path);
    for (const [id, t] of inFlight) {
      if (t.state === "merging") await setTaskState(root, feature, harness, id, { state: "verifying", reason: "half-finished merge aborted on resume; retry the merge" });
    }
    return;
  }
  const head = revParse(item.path, "HEAD");
  for (const [id, t] of inFlight) {
    if (t.preMergeSha && head !== t.preMergeSha) {
      await setTaskState(root, feature, harness, id, { state: "verifying", reason: "resumed after an interrupted run; re-run verify" });
    }
  }
}

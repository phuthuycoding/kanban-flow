import { findFeature, updateFeatureMeta, type Feature, type FeatureMeta, type RunRecord, type TaskState, type TaskStateName } from "../workflow/features.js";
import { taskView, writeTasksMd, type PlannedTask, type TasksBaseline } from "../workflow/tasks.js";
import type { TaskWorktree } from "../worktree/tasks.js";
import type { HarnessConfig } from "./config.js";

/**
 * Apply `fn` to the item's meta and re-render tasks.md from the result, both under the item lock,
 * so concurrent task runs cannot write a stale task list over a newer one.
 */
export async function updateTasks(root: string, name: string, harness: HarnessConfig, fn: (meta: FeatureMeta) => FeatureMeta, baseline?: TasksBaseline): Promise<void> {
  await updateFeatureMeta(root, name, async (meta) => {
    const next = fn(meta);
    const feature = findFeature(root, name)!;
    const updated: Feature = { ...feature, meta: next };
    await writeTasksMd(updated, taskView(updated, harness), baseline);
    return next;
  });
}

export const withTask = (meta: FeatureMeta, id: string, patch: Partial<TaskState>): FeatureMeta => {
  const next: TaskState = { ...meta.tasks?.[id], ...patch, state: patch.state ?? meta.tasks?.[id]?.state ?? "pending", updatedAt: new Date().toISOString() };
  if (patch.reason === undefined) delete next.reason;
  return { ...meta, tasks: { ...meta.tasks, [id]: next } };
};

/** Record a task's state (and optional fields) in `.kfw.json` and tasks.md. A state change drops the old reason unless one is given. */
export async function setTaskState(root: string, name: string, harness: HarnessConfig, id: string, patch: Partial<TaskState>): Promise<void> {
  await updateTasks(root, name, harness, (meta) => withTask(meta, id, patch));
}

export interface CompleteTaskInput {
  root: string;
  feature: string;
  harness: HarnessConfig;
  task: PlannedTask;
  worktree: TaskWorktree;
  run: RunRecord;
  /** Per-command limit for kf's own git commit and the verify commands; 0 = no limit. */
  timeoutMs: number;
}

export interface TaskCompletion {
  state: TaskStateName;
  reason?: string;
  /** Set when the driver must stop: the plan's `Files` must change, or git left the item branch in an unknown state. */
  stop?: "plan_change_needed" | "git_error";
  /** True only for `failed`; the driver retries those, a manual run does not. */
  retryable: boolean;
  /** The reason to hand the worker on the next attempt (`previousFailure`); set for `failed`. */
  failureForRetry?: string;
  /** Non-fatal problem, e.g. the task worktree could not be removed. */
  warning?: string;
}

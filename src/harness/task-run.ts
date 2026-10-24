import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS } from "../workflow/schema.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { findFeature, updateFeatureMeta, type Feature, type FeatureMeta, type RunRecord, type TaskState, type TaskStateName } from "../workflow/features.js";
import { approvalState } from "../workflow/status.js";
import { checkTaskGraph, parseTaskGraph, resolveTaskRole, taskView, writeTasksMd, type PlannedTask, type TasksBaseline } from "../workflow/tasks.js";
import { readProjectConfig } from "../project/config.js";
import { worktreeConfig, type WorktreeConfig } from "../worktree/config.js";
import { createTaskWorktree, taskBranch, taskWorktreePath, type TaskWorktree } from "../worktree/tasks.js";
import { revParse, runGit } from "../shared/git.js";
import { assignRole, buildTaskPrompt, type Assignment } from "./prompt.js";
import { applyRunRecord, executeRun, liveRecords, writeRunPlan, type RunOutcome, type RunPlan } from "./run.js";
import type { HarnessConfig } from "./config.js";
import { runCompletionPipeline } from "./task-pipeline.js";

export const taskSessionKey = (taskId: string): string => `task:${taskId}`;

export interface TaskRunContext {
  task: PlannedTask;
  harness: HarnessConfig;
  assignment: Assignment;
  worktree: WorktreeConfig;
  /** Where the task worktree will be, and the branch it will get. */
  path: string;
  branch: string;
  /** Attempts already recorded for this task. */
  attempts: number;
}

export type TaskPrepared = { ok: true; ctx: TaskRunContext } | { ok: false; reason: string };

/** Message for a run that cannot start because another is live; null when the way is clear. `taskId` null means a stage-level run. */
export function runConflict(runs: RunRecord[] | undefined, featureName: string, taskId: string | null): string | null {
  const live = liveRecords(runs);
  const same = taskId ? live.find((r) => r.task === taskId) : undefined;
  if (same) return `Task ${taskId} already has a live run ${same.id} (${same.role}) for '${featureName}'. Wait for it or check: kf runs ${featureName}`;
  const other = taskId ? live.find((r) => !r.task) : live[0];
  if (!other) return null;
  const what = other.task ? `task run ${other.id} (${other.task}, ${other.role})` : `Run ${other.id} (${other.role} @ ${other.stage})`;
  return other.task
    ? `Task ${what} is still running for '${featureName}'. Wait for it or check: kf runs ${featureName}`
    : `${what} is still running for '${featureName}'. Wait for it or check: kf runs ${featureName}`;
}

/** Every refusal of `kf run --task` that must happen before anything is created. */
export function prepareTaskRun(root: string, feature: Feature, rawId: string): TaskPrepared {
  const taskId = rawId.toUpperCase();
  const fail = (reason: string): TaskPrepared => ({ ok: false, reason });
  const cfg = readProjectConfig(root);
  if (!cfg.harness) return fail("No harness configured in .kf/config.json — run: kf init (seeds roles and runner presets).");
  const wt = worktreeConfig(root, cfg.worktree);
  if (!wt.enabled) {
    return fail('The task harness needs worktrees: set "worktree": { "enabled": true } (worktree.enabled) in .kf/config.json, then re-run.');
  }
  if (feature.stage !== "implementation") return fail(`'${feature.name}' is in ${feature.stage}; --task needs the item in implementation.`);
  const approval = approvalState(feature);
  if (approval !== "approved") {
    return fail(`The execution contract of '${feature.name}' is ${approval === "changed" ? "changed since approval" : "not approved"}; return to planning and run: kf approve ${feature.name}`);
  }
  if (!feature.meta?.worktree) return fail(`'${feature.name}' has no item worktree; task worktrees are cut from it.`);

  const errors = checkTaskGraph(feature, cfg.harness).filter((f) => f.severity === "ERROR");
  if (errors.length > 0) return fail([`Task graph of '${feature.name}' is invalid; fix the plan:`, ...errors.map((f) => `ERROR ${f.code}: ${f.message}`)].join("\n"));
  const planFile = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  const tasks = existsSync(planFile) ? parseTaskGraph(splitFrontmatter(readFileSync(planFile, "utf8")).body).tasks : [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return fail(`Unknown task '${rawId}' in '${feature.name}'. Known tasks: ${tasks.map((t) => t.id).join(", ") || "none"}. See: kf tasks ${feature.name}`);
  }
  const stored = feature.meta.tasks ?? {};
  const unfinished = task.dependencies.filter((d) => stored[d]?.state !== "done");
  if (unfinished.length > 0) {
    return fail(`${taskId} depends on ${unfinished.map((d) => `${d} (${stored[d]?.state ?? "pending"})`).join(", ")}, which is not done.`);
  }
  if (stored[taskId]?.state === "done") return fail(`${taskId} is already done.`);
  const conflict = runConflict(feature.meta.runs, feature.name, taskId);
  if (conflict) return fail(conflict);

  const role = resolveTaskRole(task, cfg.harness);
  const assignment = assignRole(cfg.harness, role, "implementation", root);
  if (typeof assignment === "string") return fail(assignment);
  return {
    ok: true,
    ctx: {
      task, harness: cfg.harness, assignment, worktree: wt,
      path: taskWorktreePath(wt, feature.name, taskId), branch: taskBranch(feature.meta.worktree.branch, taskId),
      attempts: stored[taskId]?.attempts ?? 0,
    },
  };
}

class Refused extends Error {}

/**
 * Apply `fn` to the item's meta and re-render tasks.md from the result, both under the item lock,
 * so concurrent task runs cannot write a stale task list over a newer one.
 */
async function updateTasks(root: string, name: string, harness: HarnessConfig, fn: (meta: FeatureMeta) => FeatureMeta, baseline?: TasksBaseline): Promise<void> {
  await updateFeatureMeta(root, name, async (meta) => {
    const next = fn(meta);
    const feature = findFeature(root, name)!;
    const updated: Feature = { ...feature, meta: next };
    await writeTasksMd(updated, taskView(updated, harness), baseline);
    return next;
  });
}

const withTask = (meta: FeatureMeta, id: string, patch: Partial<TaskState>): FeatureMeta => {
  const next: TaskState = { ...meta.tasks?.[id], ...patch, state: patch.state ?? meta.tasks?.[id]?.state ?? "pending", updatedAt: new Date().toISOString() };
  if (patch.reason === undefined) delete next.reason;
  return { ...meta, tasks: { ...meta.tasks, [id]: next } };
};

/** Record a task's state (and optional fields) in `.kfw.json` and tasks.md. A state change drops the old reason unless one is given. */
export async function setTaskState(root: string, name: string, harness: HarnessConfig, id: string, patch: Partial<TaskState>): Promise<void> {
  await updateTasks(root, name, harness, (meta) => withTask(meta, id, patch));
}

function captureBaseline(root: string, feature: Feature): TasksBaseline | undefined {
  const tasksFile = join(feature.dir, "tasks.md");
  if (existsSync(tasksFile) && /^## Baseline[ \t]*$/m.test(readFileSync(tasksFile, "utf8"))) return undefined;
  const itemPath = feature.meta!.worktree!.path;
  const sha = revParse(itemPath, "HEAD");
  if (!sha) throw new Error(`Cannot resolve HEAD of the item worktree ${itemPath}.`);
  const porcelain = runGit(itemPath, ["status", "--porcelain"]).stdout.split("\n").filter(Boolean);
  return { sha, porcelain };
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

/** Called once after a DONE/DONE_WITH_CONCERNS worker exits: commit, merge, verify (see task-pipeline.ts). */
export function completeTask(input: CompleteTaskInput): Promise<TaskCompletion> {
  return runCompletionPipeline(input);
}

export interface TaskRunOptions {
  fresh: boolean;
  timeoutMs: number;
  /** Why the previous attempt failed; the retry pipeline passes it so the worker can fix it. */
  previousFailure?: string;
  env?: NodeJS.ProcessEnv;
}

export type TaskRunResult =
  | { started: false; reason: string }
  | ({ started: true; outcome: RunOutcome | null } & Omit<TaskCompletion, "retryable"> & { retryable?: boolean });

/** Prompt and session plan shared by a real run and `--dry-run`; the run id is a placeholder in a dry run. */
export function taskPrompt(root: string, feature: Feature, ctx: TaskRunContext, runId: string, previousFailure?: string): string {
  return buildTaskPrompt({ runId, feature, root, assignment: ctx.assignment, task: ctx.task, previousFailure });
}

function workerReason(outcome: RunOutcome): string {
  const r = outcome.record;
  if (r.error) return r.error;
  if (r.status === "failed" || (r.exitCode !== undefined && r.exitCode !== 0)) return `worker exited ${r.exitCode ?? "abnormally"}`;
  if (r.statusLine === null || r.statusLine === undefined) return "worker finished without a STATUS line";
  return `worker reported STATUS: ${r.statusLine}`;
}

/**
 * Run one task once: claim it (state + live run record, atomically), cut its worktree, run the worker
 * there, then record the outcome. A failed or blocked worker leaves the task failed/blocked; a manual run never retries.
 */
export async function executeTaskRun(root: string, featureName: string, ctx: TaskRunContext, opts: TaskRunOptions): Promise<TaskRunResult> {
  const { task, harness } = ctx;
  const feature = findFeature(root, featureName);
  if (!feature?.meta?.worktree) throw new Error(`Work item '${featureName}' disappeared or lost its item worktree.`);
  const runId = randomUUID().slice(0, 8);
  const logRel = join("runs", `${runId}.log`);
  const key = taskSessionKey(task.id);
  const baseline = captureBaseline(root, feature);
  // A manual re-run of a failed task tells the worker why the last attempt failed.
  const prior = feature.meta.tasks?.[task.id];
  const previousFailure = opts.previousFailure ?? (prior?.state === "failed" ? prior.reason : undefined);

  // The claim carries this process as supervisor, so the run counts as live before the worker has a pid.
  const claim: RunRecord = {
    id: runId, role: ctx.assignment.role, runner: ctx.assignment.runnerName, stage: "implementation", mode: "start",
    at: new Date().toISOString(), log: logRel, status: "running", supervisorPid: process.pid, task: task.id,
  };
  try {
    await updateTasks(root, featureName, harness, (meta) => {
      const conflict = runConflict(meta.runs, featureName, task.id);
      if (conflict) throw new Refused(conflict);
      const claimed = withTask(meta, task.id, { state: "running", attempts: (meta.tasks?.[task.id]?.attempts ?? 0) + 1, branch: ctx.branch });
      return { ...claimed, runs: applyRunRecord(meta.runs, claim) };
    }, baseline);
  } catch (err) {
    if (err instanceof Refused) return { started: false, reason: err.message };
    throw err;
  }

  const abort = async (reason: string): Promise<TaskRunResult> => {
    const endedAt = new Date().toISOString();
    await updateTasks(root, featureName, harness, (meta) => ({
      ...withTask(meta, task.id, { state: "failed", reason }),
      runs: applyRunRecord(meta.runs, { ...claim, status: "failed", endedAt, error: reason }),
    }));
    return { started: true, outcome: null, state: "failed", reason, retryable: true, failureForRetry: reason };
  };

  let worktree: TaskWorktree;
  try {
    worktree = await createTaskWorktree(root, findFeature(root, featureName)!, task.id, ctx.worktree);
  } catch (err) {
    return abort(`task worktree: ${err instanceof Error ? err.message : String(err)}`);
  }
  await setTaskState(root, featureName, harness, task.id, { state: "running", branch: worktree.branch, base: worktree.base });

  const current = findFeature(root, featureName)!;
  const plan: RunPlan = {
    id: runId, root, feature: featureName, role: ctx.assignment.role, runnerName: ctx.assignment.runnerName, stage: "implementation",
    runner: ctx.assignment.runner, prompt: taskPrompt(root, current, ctx, runId, previousFailure), output: ctx.assignment.output,
    task: task.id, cwd: worktree.path, sessionKey: key,
    // The first attempt of a task never inherits a stale session; later attempts resume the task's own.
    fresh: opts.fresh || ctx.attempts === 0, timeoutMs: opts.timeoutMs,
  };
  writeRunPlan(current, plan);

  let outcome: RunOutcome;
  try {
    outcome = await executeRun(plan, opts.env ?? process.env);
  } catch (err) {
    await abort(`worker run failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  const record = outcome.record;
  const session = findFeature(root, featureName)?.meta?.sessions?.[key];
  const sessionPatch = session ? { session } : {};

  if (outcome.ok) {
    await setTaskState(root, featureName, harness, task.id, { state: "running", ...sessionPatch });
    const done = await completeTask({ root, feature: featureName, harness, task, worktree, run: record, timeoutMs: opts.timeoutMs });
    return { started: true, outcome, ...done };
  }
  const blocked = record.exitCode === 0 && /^(BLOCKED|NEEDS_CONTEXT)\b/.test(record.statusLine ?? "");
  const reason = blocked ? (record.summary ?? record.statusLine ?? "worker blocked") : workerReason(outcome);
  const state = blocked ? "blocked" : "failed";
  await setTaskState(root, featureName, harness, task.id, { state, reason, ...sessionPatch });
  return { started: true, outcome, state, reason, retryable: state === "failed", ...(state === "failed" ? { failureForRetry: reason } : {}) };
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, type Stage } from "../../workflow/schema.js";
import { splitFrontmatter } from "../../shared/frontmatter.js";
import { findFeature, updateFeatureMeta, type DriveState, type Feature } from "../../workflow/features.js";
import { resolveStageRoles, taskView, writeTasksMd, type PlannedTask } from "../../workflow/tasks.js";
import { transitionItem, type Transition } from "../../workflow/transition.js";
import { validateFeature } from "../../workflow/validate.js";
import { readProjectConfig } from "../../project/config.js";
import { harnessLimits, type HarnessConfig } from "../config.js";
import { resolveChain, type Assignment } from "../prompt.js";
import { executeChain } from "../chain.js";
import { DEFAULT_TIMEOUT_MS, type RunOutcome } from "../run.js";
import { captureBaseline, executeTaskRun, prepareTaskRun, setTaskState } from "../task-run.js";
import { recoverItemMerge, resumeTaskMerge, runVerify } from "../task-pipeline.js";
import { blockedBy, nextToStart, progressState } from "../scheduler.js";
import { appendDriveEvent } from "../drive-log.js";
import { READY_REASON, driveBoundary, message, nextCommandFor, oneLine, patchDrive, readPlannedTasks, type DriveDeps, type DriveOutcome, type Step, type Stop } from "./claim.js";
import { failRuns, finishDrive, orphanRuns, terminate, type DriveEnd } from "./control.js";

interface Verdict {
  kind: "pass" | "fail" | "reject" | "requirement_bug" | "blocked" | "missing";
  status: string | null;
  file: string;
}

class Driver {
  private stop: Stop | null = null;
  private readonly transition: Transition;
  private readonly timeoutMs: number;

  constructor(
    private readonly root: string,
    private readonly name: string,
    private readonly id: string,
    deps: DriveDeps,
  ) {
    this.transition = deps.transition ?? transitionItem;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private feature(): Feature {
    const f = findFeature(this.root, this.name);
    if (!f) throw new Error(`Work item '${this.name}' disappeared while its drive was running.`);
    return f;
  }

  private harness(): HarnessConfig {
    const h = readProjectConfig(this.root).harness;
    if (!h) throw new Error("No harness configured in .kf/config.json.");
    return h;
  }

  private log(event: Parameters<typeof appendDriveEvent>[3]): void {
    appendDriveEvent(this.root, this.name, this.id, event);
  }

  requestStop(stop: Stop): void {
    this.stop ??= stop;
  }

  private async setStep(step: Step, extra: Partial<DriveState> = {}): Promise<void> {
    await patchDrive(this.root, this.name, this.id, { step, ...extra });
  }

  /** Called before every worker run: stop conditions first, then reserve one run of the budget. A returned reason means do not start. */
  private async admit(): Promise<string | null> {
    if (this.stop) return this.stop.reason;
    const boundary = driveBoundary(this.root, this.feature(), this.id);
    if (boundary) {
      this.requestStop(boundary);
      return boundary.reason;
    }
    const { maxRuns } = harnessLimits(this.harness());
    let used = 0;
    let granted = false;
    await updateFeatureMeta(this.root, this.name, (meta) => {
      const d = meta.drive;
      if (!d || d.id !== this.id || d.status !== "running") return meta;
      used = d.runs;
      if (d.runs >= maxRuns) return meta;
      granted = true;
      return { ...meta, drive: { ...d, runs: d.runs + 1, updatedAt: new Date().toISOString() } };
    });
    if (granted) return null;
    const stop: Stop = { code: "budget", reason: `run budget exhausted: ${used}/${maxRuns} worker runs used (harness.budget.maxRuns); raise it in .kf/config.json to continue` };
    this.requestStop(stop);
    return stop.reason;
  }

  private logRun(outcome: RunOutcome | null | undefined, task?: string): void {
    if (!outcome) return;
    const r = outcome.record;
    this.log({ event: "run", run: r.id, role: r.role, stage: r.stage, ...(task ? { task } : {}), status: r.status, statusLine: r.statusLine ?? null, exitCode: r.exitCode ?? null });
  }

  async run(): Promise<void> {
    const first = this.feature();
    const drive = first.meta!.drive!;
    // A hand-over from the claiming CLI: from here on this process is the supervisor.
    await patchDrive(this.root, this.name, this.id, { supervisorPid: process.pid });
    this.log({ event: drive.runs > 0 || drive.loops > 0 || drive.step !== "implementation" ? "resume" : "start", stage: first.stage, step: drive.step, loops: drive.loops, runs: drive.runs });

    if (!(await this.recover())) return;

    let step: Step = this.entryStep(first, drive);
    while (!this.stop) {
      const boundary = driveBoundary(this.root, this.feature(), this.id);
      if (boundary) {
        this.requestStop(boundary);
        return;
      }
      const next: Step | "ready" | null = await this.doStep(step);
      if (next === null) return;
      if (next === "ready") return;
      step = next;
    }
  }

  private entryStep(feature: Feature, drive: DriveState): Step {
    if (feature.stage === "testing") return "testing";
    if (feature.stage === "review") return "review";
    if (drive.step === "repair") return "repair";
    if (feature.meta?.kind === "bug" && (drive.step === "verify" || drive.step === "testing")) return "verify";
    return "implementation";
  }

  /** One step; returns the next one, "ready" when the drive is done, or null after requesting a stop. */
  private async doStep(step: Step): Promise<Step | "ready" | null> {
    await this.setStep(step);
    switch (step) {
      case "implementation":
        return (await this.implement()) ? "verify" : null;
      case "repair":
        return (await this.repair()) ? "verify" : null;
      case "verify":
        await patchDrive(this.root, this.name, this.id, { repairReport: undefined });
        return (await this.verifyStage()) ? "testing" : null;
      case "testing":
        return this.testing();
      case "review":
        return this.review();
    }
  }

  // --- start / resume ---------------------------------------------------------------------------------------------

  private async recover(): Promise<boolean> {
    const found = this.feature();
    const orphans = orphanRuns(found);
    for (const o of orphans) await terminate(o.pid, true);
    await failRuns(this.root, this.name, new Set(orphans.map((o) => o.id)), "orphaned by a drive supervisor that died; stopped on resume");

    try {
      await recoverItemMerge(this.root, this.name);
    } catch (err) {
      this.requestStop({ code: "git_error", reason: `could not abort the half-finished merge in the item worktree: ${oneLine(message(err))}` });
      return false;
    }
    if (found.meta?.kind === "bug") return true;

    const harness = this.harness();
    const baseline = captureBaseline(this.root, this.feature());
    if (baseline) {
      await updateFeatureMeta(this.root, this.name, async (meta) => {
        const current = findFeature(this.root, this.name)!;
        const withMeta: Feature = { ...current, meta };
        await writeTasksMd(withMeta, taskView(withMeta, harness), baseline);
        return meta;
      });
    }

    const stored = this.feature().meta?.tasks ?? {};
    for (const [id, t] of Object.entries(stored)) {
      if (t.state === "failed" || t.state === "blocked" || t.state === "running") {
        await setTaskState(this.root, this.name, harness, id, { state: "pending", attempts: 0 });
        this.log({ event: "task", task: id, state: "pending", was: t.state, reason: "reset on resume" });
      }
    }
    const planned = readPlannedTasks(this.feature());
    for (const [id, t] of Object.entries(this.feature().meta?.tasks ?? {})) {
      if (t.state !== "merging" && t.state !== "verifying") continue;
      const task = planned.find((p) => p.id === id);
      if (!task) {
        await setTaskState(this.root, this.name, harness, id, { state: "blocked", reason: "the task is no longer in the plan" });
        continue;
      }
      const done = await resumeTaskMerge({ root: this.root, feature: this.name, harness, task, stored: t, timeoutMs: this.timeoutMs });
      const state = done.state === "failed" ? "blocked" : done.state;
      if (done.state === "failed") await setTaskState(this.root, this.name, harness, id, { state: "blocked", reason: done.reason });
      this.log({ event: "task", task: id, state, ...(done.reason ? { reason: done.reason } : {}), resumed: true });
      this.log({ event: "merge", task: id, merged: done.state === "done", ...(done.reason ? { reason: done.reason } : {}), resumed: true });
      if (done.stop) {
        this.requestStop({ code: done.stop, reason: `${id}: ${oneLine(done.reason ?? done.stop)}` });
        return false;
      }
    }
    return true;
  }

  // --- implementation ---------------------------------------------------------------------------------------------

  private async implement(): Promise<boolean> {
    if (this.feature().meta?.kind === "bug") return this.runStage("implementation", null);
    return this.runDag();
  }

  private async runDag(): Promise<boolean> {
    const tasks = readPlannedTasks(this.feature());
    if (tasks.length === 0) {
      this.requestStop({ code: "tasks_blocked", reason: `the plan of '${this.name}' has no tasks in its Task Breakdown; add them and re-approve, or implement by hand` });
      return false;
    }
    const inflight = new Map<string, Promise<void>>();
    for (;;) {
      if (!this.stop) {
        const meta = this.feature().meta!;
        const picks = nextToStart({ tasks, states: meta.tasks ?? {}, running: [...inflight.keys()], parallel: harnessLimits(this.harness()).parallel });
        for (const id of picks) {
          if (this.stop) break;
          const task = tasks.find((t) => t.id === id)!;
          const work = this.runTask(task).catch((err: unknown) => {
            this.log({ event: "warning", task: id, warning: `internal error: ${message(err)}`, stack: err instanceof Error ? err.stack : undefined });
            this.requestStop({ code: "internal_error", reason: `${id}: ${oneLine(message(err))}` });
          }).finally(() => inflight.delete(id));
          inflight.set(id, work);
        }
      }
      if (inflight.size === 0) break;
      await Promise.race(inflight.values());
    }
    if (this.stop) return false;
    const meta = this.feature().meta!;
    if (progressState({ tasks, states: meta.tasks ?? {}, parallel: 1 }) === "done") return true;
    this.requestStop({ code: "tasks_blocked", reason: this.blockedReason(tasks) });
    return false;
  }

  private blockedReason(tasks: PlannedTask[]): string {
    const states = this.feature().meta?.tasks ?? {};
    const parts: string[] = [];
    for (const t of tasks) {
      const s = states[t.id];
      if (s?.state === "blocked" || s?.state === "failed") parts.push(`${t.id} ${s.state}${s.reason ? ` (${oneLine(s.reason, 200)})` : ""}`);
    }
    for (const [id, culprit] of Object.entries(blockedBy(tasks, states))) parts.push(`${id} is blocked by ${culprit}`);
    return `no task can progress: ${parts.join("; ") || "nothing is ready"}; fix the cause, then resume (blocked tasks go back to pending): kf drive ${this.name}`;
  }

  /** One task through the pipeline, with up to `harness.retries` repair runs that resume its session. */
  private async runTask(task: PlannedTask): Promise<void> {
    const harness = this.harness();
    const { retries } = harnessLimits(harness);
    let previousFailure: string | undefined;
    for (;;) {
      const prepared = prepareTaskRun(this.root, this.feature(), task.id, { driver: true });
      if (!prepared.ok) {
        await setTaskState(this.root, this.name, harness, task.id, { state: "blocked", reason: prepared.reason });
        this.log({ event: "task", task: task.id, state: "blocked", reason: prepared.reason });
        return;
      }
      const refusal = await this.admit();
      if (refusal) return;
      this.log({ event: "task", task: task.id, state: "running", attempt: prepared.ctx.attempts + 1 });
      const result = await executeTaskRun(this.root, this.name, prepared.ctx, { fresh: false, timeoutMs: this.timeoutMs, previousFailure, driver: true });
      if (!result.started) {
        await setTaskState(this.root, this.name, harness, task.id, { state: "blocked", reason: result.reason });
        this.log({ event: "task", task: task.id, state: "blocked", reason: result.reason });
        return;
      }
      this.logRun(result.outcome, task.id);
      const stored = this.feature().meta?.tasks?.[task.id];
      this.log({ event: "task", task: task.id, state: result.state, ...(result.reason ? { reason: result.reason } : {}), attempts: stored?.attempts ?? 0 });
      if (result.outcome?.ok) {
        this.log({ event: "merge", task: task.id, merged: result.state === "done", ...(stored?.mergeSha ? { sha: stored.mergeSha } : {}), ...(result.state === "done" ? {} : { reason: result.reason ?? null }) });
      }
      if (result.warning) this.log({ event: "warning", task: task.id, warning: result.warning });

      if (result.state === "done") return;
      if (result.stop) {
        this.requestStop({ code: result.stop, reason: result.stop === "plan_change_needed"
          ? `${task.id}: ${oneLine(result.reason ?? "")}; the plan's Files must change: edit the plan, re-approve it (kf stage ${this.name} planning, kf approve ${this.name}, kf stage ${this.name} implementation), then kf drive ${this.name}`
          : `${task.id}: ${oneLine(result.reason ?? "")}` });
        return;
      }
      const record = result.outcome?.record;
      if (result.state === "blocked" && record && record.exitCode === 0 && /^(BLOCKED|NEEDS_CONTEXT)\b/.test(record.statusLine ?? "")) {
        this.requestStop({ code: "worker_blocked", reason: `${task.id} worker reported ${record.statusLine}: ${oneLine(result.reason ?? "")}` });
        return;
      }
      if (result.state === "blocked") return;

      const attempts = stored?.attempts ?? 0;
      if (attempts > retries) {
        const reason = `${result.reason ?? "failed"} (after ${attempts} attempt${attempts === 1 ? "" : "s"})`;
        await setTaskState(this.root, this.name, harness, task.id, { state: "blocked", reason });
        this.log({ event: "task", task: task.id, state: "blocked", reason });
        return;
      }
      previousFailure = result.failureForRetry ?? result.reason;
    }
  }

  // --- stage runs, verify and moves -------------------------------------------------------------------------------

  private stageAssignments(stage: Stage): Assignment[] | string {
    const harness = this.harness();
    const chain: Assignment[] = [];
    for (const role of resolveStageRoles(stage, harness)) {
      const resolved = resolveChain(harness, this.feature(), this.root, { stage, role });
      if (!resolved.ok) return resolved.reason;
      chain.push(...resolved.chain);
    }
    return chain;
  }

  /** Run a stage's roles in the item worktree. False after requesting a stop. */
  private async runStage(stage: Stage, failReport: string | null | undefined): Promise<boolean> {
    const chain = this.stageAssignments(stage);
    if (typeof chain === "string") {
      this.requestStop({ code: "worker_blocked", reason: `cannot start the ${stage} role: ${oneLine(chain)}` });
      return false;
    }
    const worktree = this.feature().meta?.worktree;
    if (!worktree) throw new Error(`Work item '${this.name}' lost its item worktree.`);
    const summary = await executeChain(this.root, this.name, chain, {
      fresh: false, timeoutMs: this.timeoutMs, cwd: worktree.path, failReport, beforeRun: () => this.admit(),
    });
    for (const o of summary.outcomes) this.logRun(o);
    if (summary.refused) return false;
    if (!summary.ok) {
      const last = summary.outcomes[summary.outcomes.length - 1]?.record;
      const detail = last ? (last.summary ?? last.error ?? (last.statusLine ? `STATUS: ${last.statusLine}` : `exit ${last.exitCode ?? "?"}`)) : "it did not start";
      this.requestStop({ code: "worker_blocked", reason: `${stage} role ${summary.stoppedAt ?? "?"} did not finish: ${oneLine(detail)}` });
      return false;
    }
    return true;
  }

  private async verifyStage(): Promise<boolean> {
    const commands = this.harness().verify?.stage ?? [];
    const worktree = this.feature().meta?.worktree;
    if (!worktree) throw new Error(`Work item '${this.name}' lost its item worktree.`);
    const failure = runVerify(commands, worktree.path, this.timeoutMs);
    this.log({ event: "verify", scope: "stage", ok: failure === null, ...(failure ? { output: failure } : {}) });
    if (failure === null) return true;
    this.requestStop({ code: "verify_failed", reason: `harness.verify.stage failed: ${oneLine(failure)}` });
    return false;
  }

  private async move(to: Stage): Promise<boolean> {
    const from = this.feature().stage;
    const out = await this.transition(this.root, this.name, to, { cwd: this.root });
    if (out.kind === "moved") {
      this.log({ event: "stage", from, to });
      return true;
    }
    const why = out.kind === "hook-failed"
      ? `hook '${to}' failed (exit ${out.hook.code})${out.hook.output ? `: ${out.hook.output}` : ""}`
      : out.kind === "refused" ? out.stdout : message(out.error);
    this.log({
      event: "stage", from, to, refused: oneLine(why),
      ...(out.kind === "error" && out.error instanceof Error ? { stack: out.error.stack } : {}),
    });
    this.requestStop({ code: "transition_refused", reason: `cannot move '${this.name}' ${from} → ${to}: ${oneLine(why)}` });
    return false;
  }

  // --- testing, review, repair ------------------------------------------------------------------------------------

  private verdict(stage: "testing" | "review"): Verdict {
    const f = this.feature();
    const file = ARTIFACTS[stage === "testing" ? "testing-result" : "review-report"].file;
    const path = join(f.dir, file);
    const miss: Verdict = { kind: "missing", status: null, file };
    if (!existsSync(path)) return miss;
    const { fm } = splitFrontmatter(readFileSync(path, "utf8"));
    // A report of an earlier execution is history, not a result for this pass.
    if (!f.meta?.executionId || fm.execution !== f.meta.executionId) return miss;
    const status = fm.status ?? "";
    switch (status) {
      case "PASS": return { kind: "pass", status, file };
      case "FAIL": return { kind: "fail", status, file };
      case "REJECT": return { kind: "reject", status, file };
      case "REQUIREMENT_BUG": return { kind: "requirement_bug", status, file };
      default: return { kind: "blocked", status, file };
    }
  }

  /** The verdict for this pass, running the stage's roles first unless a current report is already there. */
  private async report(stage: "testing" | "review"): Promise<Verdict | null> {
    let v = this.verdict(stage);
    if (v.kind === "missing") {
      if (!(await this.runStage(stage, undefined))) return null;
      v = this.verdict(stage);
    }
    if (v.kind === "missing") {
      this.requestStop({ code: "worker_blocked", reason: `the ${stage} role finished without writing a current ${v.file} (it must carry the current execution id)` });
      return null;
    }
    if (v.kind === "blocked") {
      this.requestStop({ code: "worker_blocked", reason: `${v.file} says ${v.status || "no status"}; the ${stage} could not be completed` });
      return null;
    }
    if (v.kind === "requirement_bug") {
      this.requestStop({ code: "requirement_bug", reason: `${v.file} says REQUIREMENT_BUG; revise the requirement with the human (kf stage ${this.name} planning) instead of repairing code` });
      return null;
    }
    return v;
  }

  private async testing(): Promise<Step | "ready" | null> {
    if (this.feature().stage === "implementation" && !(await this.move("testing"))) return null;
    const v = await this.report("testing");
    if (!v) return null;
    if (v.kind === "pass") return (await this.move("review")) ? "review" : null;
    return this.toRepair(v);
  }

  private async review(): Promise<Step | "ready" | null> {
    const v = await this.report("review");
    if (!v) return null;
    if (v.kind !== "pass") return this.toRepair(v);
    const f = this.feature();
    const errors = validateFeature(f, false, true, this.harness()).issues.filter((i) => i.severity === "ERROR");
    if (errors.length > 0) {
      this.requestStop({ code: "transition_refused", reason: `the review is PASS but kf validate reports: ${errors.map((e) => `${e.code} (${oneLine(e.message, 160)})`).join("; ")}` });
      return null;
    }
    return "ready";
  }

  /** FAIL/REJECT: move back to implementation (bounded by maxLoops) so the repair run can fix the report. */
  private async toRepair(v: Verdict): Promise<Step | null> {
    const limits = harnessLimits(this.harness());
    const d = this.feature().meta!.drive!;
    if (d.loops >= limits.maxLoops) {
      this.requestStop({ code: "loop_limit", reason: `maxLoops reached (${d.loops}/${limits.maxLoops}); ${v.file} still says ${v.status}; fix it by hand or raise harness.maxLoops in .kf/config.json, then resume` });
      return null;
    }
    if (d.runs >= limits.maxRuns) {
      this.requestStop({ code: "budget", reason: `run budget exhausted: ${d.runs}/${limits.maxRuns} worker runs used (harness.budget.maxRuns); no repair run can start` });
      return null;
    }
    await this.setStep("repair", { repairReport: v.file });
    if (!(await this.move("implementation"))) return null;
    await patchDrive(this.root, this.name, this.id, { loops: d.loops + 1 });
    return "repair";
  }

  private async repair(): Promise<boolean> {
    const f = this.feature();
    const file = f.meta?.drive?.repairReport;
    const report = file ? join(f.dir, file) : undefined;
    return this.runStage("implementation", report && existsSync(report) ? report : undefined);
  }

  // --- outcome ---------------------------------------------------------------------------------------------------

  async conclude(): Promise<DriveOutcome> {
    const stop = this.stop;
    const drive = (): DriveState => this.feature().meta!.drive!;
    if (!stop) {
      const end: DriveEnd = { status: "ready", reason: READY_REASON, nextCommand: `kf status --change ${this.name}` };
      await finishDrive(this.root, this.name, this.id, end);
      return { ...end, loops: drive().loops, runs: drive().runs };
    }
    const end: DriveEnd = { status: "stopped", stopCode: stop.code, reason: stop.reason, nextCommand: nextCommandFor(stop.code, this.name) };
    if (!stop.external) await finishDrive(this.root, this.name, this.id, end);
    return { ...end, loops: drive().loops, runs: drive().runs };
  }
}

/**
 * The supervisor: drive the claimed item to the ship gate or to a stop. Everything happens at step boundaries; runs
 * in progress finish and go through the normal pipeline, and no new run starts once a stop condition is seen.
 */
export async function superviseDrive(root: string, name: string, id: string, deps: DriveDeps = {}): Promise<DriveOutcome> {
  const found = findFeature(root, name);
  if (!found?.meta?.drive || found.meta.drive.id !== id || found.meta.drive.status !== "running") {
    throw new Error(`Drive ${id} of '${name}' is not a running drive; start one with: kf drive ${name}`);
  }
  const driver = new Driver(root, name, id, deps);
  try {
    await driver.run();
  } catch (err) {
    // Boundary of the supervisor process: record the failure with its stack and stop instead of dying with a "running" record.
    try {
      appendDriveEvent(root, name, id, { event: "warning", warning: `internal error: ${message(err)}`, stack: err instanceof Error ? err.stack : undefined });
    } catch (logError) {
      throw new AggregateError([err, logError], `Drive ${id} of '${name}' failed and its log could not be written.`);
    }
    driver.requestStop({ code: "internal_error", reason: `unexpected error: ${oneLine(message(err))}` });
  }
  return driver.conclude();
}

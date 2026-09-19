import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findFeature, writeFeatureMeta, type Feature, type RunRecord } from "../workflow/features.js";
import type { Stage } from "../workflow/schema.js";
import type { RunnerConfig } from "./config.js";
import { buildWorkerPrompt, currentFailReport, runMarker, type Assignment, type PreviousStep } from "./prompt.js";
import { captureSession, isResumeFailure, parseUsage, provisionSession } from "./session.js";

export const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const TAIL_BYTES = 64 * 1024;
const KILL_GRACE_MS = 5_000;

/** Everything a supervisor needs to execute a run without the parent process; stored at runs/<id>.json. */
export interface RunPlan {
  id: string;
  root: string;
  feature: string;
  role: string;
  runnerName: string;
  stage: Stage;
  runner: RunnerConfig;
  prompt: string;
  /** Extra file this role must write, relative to the work item folder. */
  output?: string;
  /** Position in the stage's role chain. */
  chain?: { id: string; index: number; total: number };
  fresh: boolean;
  timeoutMs: number;
}

export interface RunOutcome {
  record: RunRecord;
  ok: boolean;
  /** Extra line for the CLI, e.g. that a dead session was reset. */
  note?: string;
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") return false;
    if (err instanceof Error && "code" in err && err.code === "EPERM") return true;
    throw err;
  }
}

function loadFeature(root: string, name: string): Feature {
  const feature = findFeature(root, name);
  if (!feature || !feature.meta) throw new Error(`Work item '${name}' disappeared or lost its metadata while a run was in progress.`);
  return feature;
}

/** Re-read metadata right before writing so a concurrent `kf stage` or supervisor update is not clobbered. */
async function upsertRun(root: string, name: string, record: RunRecord): Promise<Feature> {
  const feature = loadFeature(root, name);
  const runs = [...(feature.meta!.runs ?? [])];
  const index = runs.findIndex((r) => r.id === record.id);
  if (index === -1) runs.push(record);
  else runs[index] = record;
  await writeFeatureMeta(feature.dir, { ...feature.meta!, runs });
  return feature;
}

/** Sessions are keyed by role, not runner: two roles on the same CLI must not share context. */
async function saveSession(root: string, name: string, role: string, session: string | null): Promise<void> {
  const feature = loadFeature(root, name);
  const sessions = { ...feature.meta!.sessions };
  if (session === null) delete sessions[role];
  else sessions[role] = session;
  await writeFeatureMeta(feature.dir, { ...feature.meta!, sessions: Object.keys(sessions).length > 0 ? sessions : undefined });
}

export function runningRun(feature: Feature): RunRecord | null {
  return (feature.meta?.runs ?? []).find((r) => r.status === "running" && (isPidAlive(r.pid) || isPidAlive(r.supervisorPid))) ?? null;
}

export function planPath(feature: Feature, id: string): string {
  return join(feature.dir, "runs", `${id}.json`);
}

export function createRunPlan(
  root: string,
  feature: Feature,
  assignment: Assignment,
  opts: { fresh: boolean; timeoutMs: number; previous?: PreviousStep | null },
): RunPlan {
  const id = randomUUID().slice(0, 8);
  const failReport = assignment.stage === "implementation" ? currentFailReport(feature) : null;
  const prompt = buildWorkerPrompt({ runId: id, feature, root, assignment, failReport, previous: opts.previous });
  return {
    id, root, feature: feature.name, role: assignment.role, runnerName: assignment.runnerName,
    stage: assignment.stage, runner: assignment.runner, prompt, output: assignment.output,
    fresh: opts.fresh, timeoutMs: opts.timeoutMs,
  };
}

export function writeRunPlan(feature: Feature, plan: RunPlan): string {
  mkdirSync(join(feature.dir, "runs"), { recursive: true });
  const path = planPath(feature, plan.id);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}

export function readRunPlan(feature: Feature, id: string): RunPlan {
  const path = planPath(feature, id);
  if (!existsSync(path)) throw new Error(`Run plan not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as RunPlan;
}

function readTail(path: string): string {
  if (!existsSync(path)) return "";
  const size = statSync(path).size;
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

/** Every string value inside JSON found on the output (whole output or one JSONL line). */
function jsonStrings(output: string): string[] {
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  for (const text of [output.trim(), ...output.split("\n").map((line) => line.trim())]) {
    if (!text.startsWith("{")) continue;
    try {
      visit(JSON.parse(text));
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
    }
  }
  return texts;
}

/**
 * Last STATUS/Summary lines the worker printed. CLIs in JSON mode (claude
 * --output-format json, codex exec --json) wrap the reply in a JSON string, so
 * the lines are also searched inside every string value of any JSON on stdout.
 */
export function extractStatus(output: string): { statusLine: string | null; summary?: string } {
  let statusLine: string | null = null;
  let summary: string | undefined;
  for (const source of [output, ...jsonStrings(output)]) {
    const statuses = [...source.matchAll(/^STATUS:\s*(.+?)\s*$/gm)];
    const summaries = [...source.matchAll(/^Summary:\s*(.+?)\s*$/gm)];
    if (statuses.length > 0) statusLine = statuses[statuses.length - 1][1];
    if (summaries.length > 0) summary = summaries[summaries.length - 1][1];
  }
  return { statusLine, summary };
}

interface SpawnResult {
  pid?: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnError?: Error;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") return;
    throw err;
  }
}

/** Spawn the worker in its own process group with stdout/stderr appended to the log; kill the group on timeout. */
function spawnWorker(argv: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; logPath: string; timeoutMs: number; onSpawn: (pid: number) => Promise<void> }): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const fd = openSync(opts.logPath, "a");
    const child = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["ignore", fd, fd] });
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let killer: NodeJS.Timeout | undefined;
    const finish = (result: SpawnResult): void => {
      if (timer) clearTimeout(timer);
      if (killer) clearTimeout(killer);
      closeSync(fd);
      resolve(result);
    };
    child.once("error", (err) => finish({ pid: child.pid, exitCode: null, signal: null, timedOut, spawnError: err }));
    child.once("spawn", () => {
      // A worker nobody recorded cannot be tracked or killed later: stop it before surfacing the error.
      opts.onSpawn(child.pid!).catch((err: unknown) => {
        killGroup(child.pid!, "SIGKILL");
        reject(err);
      });
      if (opts.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          killGroup(child.pid!, "SIGTERM");
          killer = setTimeout(() => killGroup(child.pid!, "SIGKILL"), KILL_GRACE_MS);
        }, opts.timeoutMs);
      }
    });
    child.once("exit", (code, signal) => finish({ pid: child.pid, exitCode: code, signal, timedOut }));
  });
}

/**
 * Execute one planned run to completion and record it. A resume that the runner
 * reports as a dead session is reset exactly once: the stored session is dropped
 * and a fresh start run follows under a new id.
 */
export async function executeRun(plan: RunPlan, env: NodeJS.ProcessEnv = process.env, allowReset = true): Promise<RunOutcome> {
  const feature = loadFeature(plan.root, plan.feature);
  const stored = feature.meta!.sessions?.[plan.role];
  const provisioned = provisionSession(plan.runner, stored, plan.prompt, plan.fresh);
  const logRel = join("runs", `${plan.id}.log`);
  mkdirSync(join(feature.dir, "runs"), { recursive: true });
  const supervisorPid = feature.meta!.runs?.find((r) => r.id === plan.id)?.supervisorPid;
  let record: RunRecord = {
    id: plan.id, role: plan.role, runner: plan.runnerName, stage: plan.stage, mode: provisioned.mode, session: provisioned.session,
    at: new Date().toISOString(), log: logRel, status: "running", supervisorPid, chain: plan.chain,
  };
  await upsertRun(plan.root, plan.feature, record);

  const result = await spawnWorker(provisioned.argv, {
    cwd: plan.root, env, logPath: join(feature.dir, logRel), timeoutMs: plan.timeoutMs,
    onSpawn: async (pid) => {
      record = { ...record, pid };
      await upsertRun(plan.root, plan.feature, record);
    },
  });
  const endedAt = new Date().toISOString();
  if (result.spawnError) {
    record = { ...record, status: "failed", endedAt, error: `${provisioned.argv[0]}: ${result.spawnError.message}` };
    await upsertRun(plan.root, plan.feature, record);
    return { record, ok: false };
  }
  const output = readTail(join(loadFeature(plan.root, plan.feature).dir, logRel));
  const { statusLine, summary } = extractStatus(output);
  const exitCode = result.exitCode ?? (result.signal ? 128 : 1);
  const usage = plan.runner.usage === "json" ? parseUsage(output) : null;
  record = { ...record, exitCode, endedAt, statusLine, summary, ...(usage ? { usage } : {}) };

  if (result.timedOut) {
    record = { ...record, status: "timeout", error: `Worker exceeded ${plan.timeoutMs / 60_000} min and was killed.` };
    await upsertRun(plan.root, plan.feature, record);
    return { record, ok: false };
  }
  if (provisioned.mode === "resume" && isResumeFailure(plan.runner, exitCode, output)) {
    record = { ...record, status: "reset", error: "Resume failed: session no longer usable; stored session dropped." };
    await upsertRun(plan.root, plan.feature, record);
    await saveSession(plan.root, plan.feature, plan.role, null);
    if (!allowReset) return { record, ok: false };
    const retry = await executeRun({ ...plan, id: randomUUID().slice(0, 8), fresh: true }, env, false);
    return { ...retry, note: `Session for role ${plan.role} was reset (run ${plan.id}); re-ran as ${retry.record.id}.` };
  }
  if (provisioned.mode === "start") {
    const captured = captureSession(plan.runner, provisioned.session, { stdout: output, marker: runMarker(plan.id), cwd: plan.root, env });
    if (captured) await saveSession(plan.root, plan.feature, plan.role, captured);
    else if (plan.runner.session !== undefined) record = { ...record, warning: "Session id not captured from worker output; the next run will start fresh." };
    if (captured) record = { ...record, session: captured };
  }
  const ok = exitCode === 0 && statusLine !== null && statusLine.startsWith("DONE");
  record = { ...record, status: exitCode === 0 ? "done" : "failed" };
  await upsertRun(plan.root, plan.feature, record);
  return { record, ok };
}

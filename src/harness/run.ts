import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isPidAlive } from "../shared/process.js";
import { findFeature, updateFeatureMeta, type Feature, type RunRecord, type RunStatus } from "../workflow/features.js";
import type { Stage } from "../workflow/schema.js";
import type { RunnerConfig } from "./config.js";
import { buildWorkerPrompt, currentFailReport, runMarker, type Assignment, type PreviousStep } from "./prompt.js";
import { captureSession, isResumeFailure, parseUsage, provisionSession } from "./session.js";

export { isPidAlive };
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
  /** Set for a task run: recorded on the run, and the worker runs in `cwd` under session key `sessionKey`. */
  task?: string;
  cwd?: string;
  /** Key of the stored session; defaults to the role. */
  sessionKey?: string;
  fresh: boolean;
  timeoutMs: number;
}

export interface RunOutcome {
  record: RunRecord;
  ok: boolean;
  /** Extra line for the CLI, e.g. that a dead session was reset. */
  note?: string;
}

function loadFeature(root: string, name: string): Feature {
  const feature = findFeature(root, name);
  if (!feature || !feature.meta) throw new Error(`Work item '${name}' disappeared or lost its metadata while a run was in progress.`);
  return feature;
}

const FINISHED: ReadonlySet<RunStatus> = new Set(["done", "failed", "timeout", "reset"]);
const statusRank = (status: RunStatus): number => (FINISHED.has(status) ? 1 : 0);
/** Outcome fields a late, lower-ranked write must never change on a finished record. */
const OUTCOME_KEYS = ["status", "statusLine", "summary", "usage", "exitCode", "endedAt", "error", "warning"] as const;

const definedFields = (record: RunRecord): Partial<RunRecord> =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<RunRecord>;

/**
 * Merge a write into the stored record of the same id. A finished record never goes back to
 * `running`: a late write (e.g. the pid or supervisor pid landing after the final write) only
 * contributes fields the stored record lacks. Equal or higher rank wins; absent fields are kept.
 */
export function mergeRunRecord(stored: RunRecord, incoming: RunRecord): RunRecord {
  const fields = definedFields(incoming);
  if (statusRank(incoming.status) >= statusRank(stored.status)) return { ...stored, ...fields };
  for (const key of OUTCOME_KEYS) delete fields[key];
  return { ...fields, ...definedFields(stored) } as RunRecord;
}

/** Add or merge `record` into a runs list; used inside an already-held item lock. */
export function applyRunRecord(runs: RunRecord[] | undefined, record: RunRecord): RunRecord[] {
  const next = [...(runs ?? [])];
  const index = next.findIndex((r) => r.id === record.id);
  if (index === -1) next.push(record);
  else next[index] = mergeRunRecord(next[index], record);
  return next;
}

/** Re-reads and writes under the per-item lock so a concurrent `kf stage` or supervisor update is not clobbered. */
async function upsertRun(root: string, name: string, record: RunRecord): Promise<Feature> {
  return updateFeatureMeta(root, name, (meta) => ({ ...meta, runs: applyRunRecord(meta.runs, record) }));
}

/** Sessions are keyed by role, not runner: two roles on the same CLI must not share context. */
async function saveSession(root: string, name: string, role: string, session: string | null): Promise<void> {
  await updateFeatureMeta(root, name, (meta) => {
    const sessions = { ...meta.sessions };
    if (session === null) delete sessions[role];
    else sessions[role] = session;
    return { ...meta, sessions: Object.keys(sessions).length > 0 ? sessions : undefined };
  });
}

export const liveRuns = (feature: Feature): RunRecord[] => liveRecords(feature.meta?.runs);

export function runningRun(feature: Feature): RunRecord | null {
  return liveRuns(feature)[0] ?? null;
}

/** Every run of the item whose worker or supervisor is still alive. */
export function liveRecords(runs: RunRecord[] | undefined): RunRecord[] {
  return (runs ?? []).filter((r) => r.status === "running" && (isPidAlive(r.pid) || isPidAlive(r.supervisorPid)));
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
    let pidRecorded: Promise<void> = Promise.resolve();
    const finish = (result: SpawnResult): void => {
      if (timer) clearTimeout(timer);
      if (killer) clearTimeout(killer);
      closeSync(fd);
      resolve(result);
    };
    child.once("error", (err) => finish({ pid: child.pid, exitCode: null, signal: null, timedOut, spawnError: err }));
    child.once("spawn", () => {
      // A worker nobody recorded cannot be tracked or killed later: stop it before surfacing the error.
      pidRecorded = opts.onSpawn(child.pid!).catch((err: unknown) => {
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
    // A fast worker can exit before the pid write lands; resolving first would let that stale
    // "running" record overwrite the caller's final one.
    child.once("exit", (code, signal) => void pidRecorded.then(() => finish({ pid: child.pid, exitCode: code, signal, timedOut })));
  });
}

/**
 * Execute one planned run to completion and record it. A resume that the runner
 * reports as a dead session is reset exactly once: the stored session is dropped
 * and a fresh start run follows under a new id.
 */
export async function executeRun(plan: RunPlan, env: NodeJS.ProcessEnv = process.env, allowReset = true): Promise<RunOutcome> {
  const feature = loadFeature(plan.root, plan.feature);
  const sessionKey = plan.sessionKey ?? plan.role;
  const stored = feature.meta!.sessions?.[sessionKey];
  const provisioned = provisionSession(plan.runner, stored, plan.prompt, plan.fresh);
  const logRel = join("runs", `${plan.id}.log`);
  mkdirSync(join(feature.dir, "runs"), { recursive: true });
  const supervisorPid = feature.meta!.runs?.find((r) => r.id === plan.id)?.supervisorPid;
  let record: RunRecord = {
    id: plan.id, role: plan.role, runner: plan.runnerName, stage: plan.stage, mode: provisioned.mode, session: provisioned.session,
    at: new Date().toISOString(), log: logRel, status: "running", supervisorPid, chain: plan.chain, ...(plan.task ? { task: plan.task } : {}),
  };
  await upsertRun(plan.root, plan.feature, record);

  const result = await spawnWorker(provisioned.argv, {
    cwd: plan.cwd ?? plan.root, env, logPath: join(feature.dir, logRel), timeoutMs: plan.timeoutMs,
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
    await saveSession(plan.root, plan.feature, sessionKey, null);
    if (!allowReset) return { record, ok: false };
    const retry = await executeRun({ ...plan, id: randomUUID().slice(0, 8), fresh: true }, env, false);
    return { ...retry, note: `Session for role ${plan.role} was reset (run ${plan.id}); re-ran as ${retry.record.id}.` };
  }
  if (provisioned.mode === "start") {
    const captured = captureSession(plan.runner, provisioned.session, { stdout: output, marker: runMarker(plan.id), cwd: plan.cwd ?? plan.root, env });
    if (captured) await saveSession(plan.root, plan.feature, sessionKey, captured);
    else if (plan.runner.session !== undefined) record = { ...record, warning: "Session id not captured from worker output; the next run will start fresh." };
    if (captured) record = { ...record, session: captured };
  }
  const ok = exitCode === 0 && statusLine !== null && statusLine.startsWith("DONE");
  record = { ...record, status: exitCode === 0 ? "done" : "failed" };
  await upsertRun(plan.root, plan.feature, record);
  return { record, ok };
}

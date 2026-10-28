import { join } from "node:path";

import {
  driveLive, findFeature, updateFeatureMeta,
  type DriveStopCode, type Feature, type TaskState,
} from "../../workflow/features.js";
import { runHook } from "../../integrations/hooks.js";
import { readProjectConfig } from "../../project/config.js";
import { isPidAlive } from "../../shared/process.js";
import { harnessLimits } from "../config.js";
import { applyRunRecord, killGroup, liveRecords } from "../run.js";
import { appendDriveEvent, lastDriveEvent } from "../drive-log.js";
import { describeEvent, formatElapsed, type DriveLiveRun } from "./progress.js";

export interface DriveEnd {
  status: "ready" | "stopped";
  stopCode?: DriveStopCode;
  reason: string;
  nextCommand: string;
}

function runStopHook(root: string, name: string, end: DriveEnd): string | null {
  const f = findFeature(root, name);
  if (!f) return null;
  const hook = runHook(
    root,
    { feature: f.name, context: f.context, dir: f.dir, root, from: f.stage, to: f.stage, approval: f.meta?.approval?.status ?? "pending" },
    { hookName: "drive-stop", env: { KFW_DRIVE_RESULT: end.status, KFW_DRIVE_REASON: end.reason } },
  );
  return hook.ran && !hook.ok ? `drive-stop hook failed (exit ${hook.code})${hook.output ? `: ${hook.output}` : ""}` : null;
}

/**
 * Record how the drive ended, log it and run the drive-stop hook. Does nothing when the drive is no longer the
 * running one with this id. A failing hook is a warning stored on the drive; the result stays as recorded.
 */
export async function finishDrive(root: string, name: string, id: string, end: DriveEnd): Promise<boolean> {
  let recorded = false;
  await updateFeatureMeta(root, name, (meta) => {
    const d = meta.drive;
    if (!d || d.id !== id || d.status !== "running") return meta;
    recorded = true;
    const { supervisorPid: _gone, ...rest } = d;
    return {
      ...meta,
      drive: {
        ...rest, status: end.status, reason: end.reason, nextCommand: end.nextCommand, updatedAt: new Date().toISOString(),
        ...(end.stopCode ? { stopCode: end.stopCode } : {}),
      },
    };
  });
  if (!recorded) return false;
  appendDriveEvent(root, name, id, { event: "stop", status: end.status, ...(end.stopCode ? { code: end.stopCode } : {}), reason: end.reason, nextCommand: end.nextCommand });
  const warning = runStopHook(root, name, end);
  if (warning) {
    appendDriveEvent(root, name, id, { event: "warning", warning });
    await updateFeatureMeta(root, name, (meta) => (meta.drive?.id === id ? { ...meta, drive: { ...meta.drive, warnings: [...(meta.drive.warnings ?? []), warning] } } : meta));
  }
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitDead(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (isPidAlive(pid)) {
    if (Date.now() >= until) return false;
    await sleep(50);
  }
  return true;
}

/** SIGTERM, then SIGKILL after a grace period; `group` signals the whole process group of a worker. */
export async function terminate(pid: number, group: boolean): Promise<void> {
  const send = (signal: NodeJS.Signals): void => {
    if (group) killGroup(pid, signal);
    else {
      try {
        process.kill(pid, signal);
      } catch (err) {
        if (!(err instanceof Error && "code" in err && err.code === "ESRCH")) throw err;
      }
    }
  };
  send("SIGTERM");
  if (await waitDead(pid, 3_000)) return;
  send("SIGKILL");
  await waitDead(pid, 2_000);
}

/** Live worker runs of the item whose supervisor is gone: nobody will ever record their result. */
export function orphanRuns(feature: Feature): { id: string; pid: number }[] {
  return liveRecords(feature.meta?.runs)
    .filter((r) => !isPidAlive(r.supervisorPid) && isPidAlive(r.pid))
    .map((r) => ({ id: r.id, pid: r.pid! }));
}

export async function failRuns(root: string, name: string, ids: Set<string>, error: string): Promise<void> {
  if (ids.size === 0) return;
  await updateFeatureMeta(root, name, (meta) => {
    let runs = meta.runs;
    for (const r of meta.runs ?? []) {
      if (ids.has(r.id) && r.status === "running") runs = applyRunRecord(runs, { ...r, status: "failed", endedAt: new Date().toISOString(), error });
    }
    return { ...meta, runs };
  });
}

export interface DriveView {
  feature: string;
  id: string;
  /** `crashed` is derived: the drive says running but its supervisor is gone. */
  state: "running" | "crashed" | "stopped" | "ready";
  step: string;
  loops: number;
  maxLoops: number;
  runs: number;
  maxRuns: number;
  runningTasks: string[];
  stopCode?: DriveStopCode;
  reason?: string;
  nextCommand?: string;
  warnings: string[];
  supervisorPid?: number;
  startedAt: string;
  updatedAt: string;
  liveRuns: DriveLiveRun[];
  lastEvent?: { at: string; summary: string };
}

const IN_FLIGHT = new Set<TaskState["state"]>(["running", "verifying", "merging"]);

export function driveView(root: string, feature: Feature, nowMs: number = Date.now()): DriveView | null {
  const d = feature.meta?.drive;
  if (!d) return null;
  const limits = harnessLimits(readProjectConfig(root).harness);
  const crashed = d.status === "running" && !driveLive(d);
  const runningTasks = Object.entries(feature.meta?.tasks ?? {}).filter(([, t]) => IN_FLIGHT.has(t.state)).map(([id]) => id).sort();
  const liveRuns: DriveLiveRun[] = liveRecords(feature.meta?.runs).map((r) => ({
    id: r.id, role: r.role, runner: r.runner, stage: r.stage, ...(r.task ? { task: r.task } : {}),
    at: r.at, elapsed: formatElapsed(r.at, nowMs), log: join(feature.dir, r.log),
  }));
  const last = lastDriveEvent(feature.dir, d.id);
  const lastEvent = last ? { at: typeof last.at === "string" ? last.at : "", summary: describeEvent(last) } : undefined;
  return {
    feature: feature.name, id: d.id, state: crashed ? "crashed" : d.status, step: d.step,
    loops: d.loops, maxLoops: limits.maxLoops, runs: d.runs, maxRuns: limits.maxRuns, runningTasks,
    ...(d.stopCode ? { stopCode: d.stopCode } : {}),
    ...(crashed
      ? { reason: `supervisor pid ${d.supervisorPid ?? "?"} is gone (killed or crashed) during step ${d.step}`, nextCommand: `kf drive ${feature.name}` }
      : { ...(d.reason ? { reason: d.reason } : {}), ...(d.nextCommand ? { nextCommand: d.nextCommand } : {}) }),
    warnings: d.warnings ?? [], ...(d.supervisorPid ? { supervisorPid: d.supervisorPid } : {}),
    startedAt: d.startedAt, updatedAt: d.updatedAt, liveRuns, ...(lastEvent ? { lastEvent } : {}),
  };
}

/**
 * `kf drive --stop`: kill the supervisor first (so it cannot turn a dying worker into a merge), then the worker process
 * groups of the item's live runs; worktrees and branches stay. Records `stopped_by_user`.
 */
export async function stopDrive(root: string, name: string): Promise<{ ok: boolean; message: string }> {
  const found = findFeature(root, name);
  const drive = found?.meta?.drive;
  if (!found || !drive || drive.status !== "running") {
    return { ok: false, message: drive ? `Drive ${drive.id} of '${name}' is not running (${drive.status}); nothing to stop.` : `'${name}' has no drive to stop.` };
  }
  if (drive.supervisorPid && drive.supervisorPid !== process.pid && isPidAlive(drive.supervisorPid)) await terminate(drive.supervisorPid, false);
  const workers = liveRecords(findFeature(root, name)?.meta?.runs).filter((r) => r.pid && r.pid !== process.pid);
  for (const r of workers) await terminate(r.pid!, true);
  await failRuns(root, name, new Set(workers.map((r) => r.id)), "stopped by user (kf drive --stop)");
  await updateFeatureMeta(root, name, (meta) => {
    const tasks = Object.fromEntries(Object.entries(meta.tasks ?? {}).map(([id, t]) => [id, t.state === "running" ? { ...t, state: "failed" as const, reason: "stopped by user (kf drive --stop)", updatedAt: new Date().toISOString() } : t]));
    return meta.tasks ? { ...meta, tasks } : meta;
  });
  const reason = "stopped by the user (kf drive --stop); worktrees and branches are kept";
  await finishDrive(root, name, drive.id, { status: "stopped", stopCode: "stopped_by_user", reason, nextCommand: `kf drive ${name}` });
  return { ok: true, message: `Stopped drive ${drive.id} of '${name}'; worktrees and branches are kept. Resume: kf drive ${name}` };
}

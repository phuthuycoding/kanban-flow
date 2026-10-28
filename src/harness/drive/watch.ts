import { existsSync, openSync, readSync, closeSync, fstatSync } from "node:fs";

import { findFeature } from "../../workflow/features.js";
import { driveLogPath, driveLogSize } from "../drive-log.js";
import { driveView, type DriveView } from "./control.js";
import { describeEvent, liveRunLabel, tailLines } from "./progress.js";

export const DRIVE_HEARTBEAT_MS = 15_000;
const DEFAULT_POLL_MS = 250;
const TAIL_LINES = 5;

export interface FollowDriveOptions {
  root: string;
  name: string;
  json: boolean;
  tail: boolean;
  /** When true, print events already in the log. An attach to a live drive starts at the end. */
  replay: boolean;
  signal: AbortSignal;
  heartbeatMs?: number;
  pollMs?: number;
  now?: () => number;
  write: (line: string) => void;
}

export interface FollowDriveResult {
  code: number;
  detached: boolean;
}

function readAppended(path: string, offset: number): { text: string; offset: number } {
  if (!existsSync(path)) return { text: "", offset: 0 };
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const from = size < offset ? 0 : offset;
    if (size === from) return { text: "", offset: size };
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    return { text: buf.toString("utf8"), offset: size };
  } finally {
    closeSync(fd);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function heartbeat(view: DriveView, tail: boolean, json: boolean, nowMs: number, write: (line: string) => void): void {
  if (json) {
    const runs = view.liveRuns.map((run) => ({
      id: run.id,
      role: run.role,
      runner: run.runner,
      ...(run.task ? { task: run.task } : {}),
      stage: run.stage,
      elapsed: run.elapsed,
      log: run.log,
      ...(tail ? { tail: tailLines(run.log, TAIL_LINES) } : {}),
    }));
    write(JSON.stringify({ event: "heartbeat", at: new Date(nowMs).toISOString(), runs }));
    return;
  }
  if (view.liveRuns.length === 0) {
    write(`♥ ${view.feature}: no live worker (step ${view.step})`);
    return;
  }
  for (const run of view.liveRuns) {
    write(`♥ ${liveRunLabel(run)}`);
    if (tail) {
      for (const line of tailLines(run.log, TAIL_LINES)) write(`    ${line}`);
    }
  }
}

function endLine(view: DriveView, json: boolean): string {
  if (json) {
    return JSON.stringify({
      event: "end",
      state: view.state,
      ...(view.stopCode ? { stopCode: view.stopCode } : {}),
      reason: view.reason ?? null,
      nextCommand: view.nextCommand ?? null,
    });
  }
  if (view.state === "ready") return `✓ Drive ${view.id} of '${view.feature}': ${view.reason ?? "ready"}\n  Next: ${view.nextCommand ?? ""}`;
  const code = view.stopCode ? `${view.stopCode} — ` : "";
  return `✗ Drive ${view.id} of '${view.feature}' stopped: ${code}${view.reason ?? view.state}\n  Next: ${view.nextCommand ?? ""}`;
}

function emitEvents(chunk: string, pending: string, json: boolean, write: (line: string) => void): string {
  const text = pending + chunk;
  const lines = text.split("\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    if (line.length === 0) continue;
    if (json) {
      write(line);
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        write(line);
        continue;
      }
      const event = parsed as Record<string, unknown>;
      const at = typeof event.at === "string" ? event.at : "";
      write(`${at} ${describeEvent(event)}`.trim());
    } catch {
      write(line);
    }
  }
  return rest;
}

/**
 * Follow a drive until it leaves `running`, or until `signal` aborts.
 * Aborting detaches this watcher only; it does not stop the drive.
 */
export async function followDrive(opts: FollowDriveOptions): Promise<FollowDriveResult> {
  const heartbeatMs = opts.heartbeatMs ?? DRIVE_HEARTBEAT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const now = opts.now ?? Date.now;
  let pending = "";
  let offset = -1;
  let nextBeat = now();

  for (;;) {
    if (opts.signal.aborted) return { code: 0, detached: true };
    const feature = findFeature(opts.root, opts.name);
    const view = feature ? driveView(opts.root, feature, now()) : null;
    if (!feature || !view) {
      opts.write(`'${opts.name}' has no drive. Start one: kf drive ${opts.name}`);
      return { code: 1, detached: false };
    }
    const path = driveLogPath(feature.dir, view.id);
    if (offset < 0) offset = opts.replay ? 0 : driveLogSize(feature.dir, view.id);
    const read = readAppended(path, offset);
    offset = read.offset;
    pending = emitEvents(read.text, pending, opts.json, opts.write);
    if (view.state !== "running") {
      if (pending.length > 0) pending = emitEvents("\n", pending, opts.json, opts.write);
      opts.write(endLine(view, opts.json));
      return { code: view.state === "ready" ? 0 : 1, detached: false };
    }
    if (now() >= nextBeat) {
      heartbeat(view, opts.tail, opts.json, now(), opts.write);
      nextBeat = now() + heartbeatMs;
    }
    await sleep(pollMs, opts.signal);
  }
}


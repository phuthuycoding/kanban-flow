import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { findFeature } from "../workflow/features.js";

export interface DriveEvent {
  event: "start" | "resume" | "run_start" | "run" | "task" | "merge" | "verify" | "stage" | "warning" | "stop";
  [field: string]: unknown;
}

/** A worker run that has been claimed. Logged on the drive when one is running. */
export interface DriveRunStart {
  id: string;
  role: string;
  runner: string;
  task?: string;
  log: string;
}

export function driveLogPath(itemDir: string, driveId: string): string {
  return join(itemDir, "runs", `drive-${driveId}.jsonl`);
}

/**
 * Append one JSON line to the drive's event log. The item folder is looked up on every call because a stage
 * move renames it; `runs/` travels with the folder, so the log stays in one place across moves.
 */
export function appendDriveEvent(root: string, feature: string, driveId: string, event: DriveEvent): void {
  const found = findFeature(root, feature);
  if (!found) throw new Error(`Work item '${feature}' disappeared while its drive log was written.`);
  mkdirSync(join(found.dir, "runs"), { recursive: true });
  const path = driveLogPath(found.dir, driveId);
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
  // A supervisor killed mid-append leaves the log without its final newline; start on a fresh line so a resumed
  // drive's events are not glued onto the fragment.
  appendFileSync(path, endsMidLine(path) ? `\n${line}` : line, "utf8");
}

function endsMidLine(path: string): boolean {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size === 0) return false;
  const fd = openSync(path, "r");
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/** Every line appendDriveEvent writes starts with this, so a fragment of one does too. */
const EVENT_START = '{"at":"';

/**
 * One drive log line as an object, or null for the fragment a supervisor killed mid-append left behind. A log
 * written before appends started on a fresh line can have the next event glued onto that fragment; that event is
 * recovered. A line that is not one of ours is corruption and throws.
 */
function parseLogLine(path: string, line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    if (!line.startsWith(EVENT_START)) throw new Error(`Malformed line in drive log ${path}: ${line.slice(0, 200)}`, { cause: err });
    for (let at = line.indexOf(EVENT_START, 1); at > 0; at = line.indexOf(EVENT_START, at + 1)) {
      try {
        return JSON.parse(line.slice(at)) as Record<string, unknown>;
      } catch {
        // Not where the glued event starts (a nested "at" key, or the fragment itself); try the next candidate.
      }
    }
    return null;
  }
}

/** Record that a worker run started, when this item has a running drive. No-op otherwise. */
export function noteDriveRunStart(root: string, feature: string, run: DriveRunStart): void {
  const found = findFeature(root, feature);
  const drive = found?.meta?.drive;
  if (!drive || drive.status !== "running") return;
  appendDriveEvent(root, feature, drive.id, {
    event: "run_start",
    run: run.id,
    role: run.role,
    runner: run.runner,
    ...(run.task ? { task: run.task } : {}),
    log: run.log,
  });
}

export function driveLogSize(itemDir: string, driveId: string): number {
  const path = driveLogPath(itemDir, driveId);
  return existsSync(path) ? statSync(path).size : 0;
}

/** Last JSON object in the drive log, or null when the log is missing or empty. */
export function lastDriveEvent(itemDir: string, driveId: string): Record<string, unknown> | null {
  const path = driveLogPath(itemDir, driveId);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The `config_source` of the drive's latest start or resume event; null when the log has none (a drive started before it was logged). */
export function driveConfigSource(itemDir: string, driveId: string): string | null {
  const path = driveLogPath(itemDir, driveId);
  if (!existsSync(path)) return null;
  let source: string | null = null;
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    if (!line.includes("\"config_source\"")) continue;
    const event = parseLogLine(path, line);
    if (!event) continue;
    if ((event.event === "start" || event.event === "resume") && typeof event.config_source === "string") source = event.config_source;
  }
  return source;
}

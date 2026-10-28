import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
  appendFileSync(driveLogPath(found.dir, driveId), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
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

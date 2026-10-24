import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { findFeature } from "../workflow/features.js";

export interface DriveEvent {
  event: "start" | "resume" | "run" | "task" | "merge" | "verify" | "stage" | "warning" | "stop";
  [field: string]: unknown;
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

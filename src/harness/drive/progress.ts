import { readFileSync } from "node:fs";

/** One live worker, as `--status` and the watch heartbeat print it. */
export interface DriveLiveRun {
  id: string;
  role: string;
  runner: string;
  stage: string;
  task?: string;
  at: string;
  elapsed: string;
  log: string;
}

/** `2m14s`, `1m03s`, `45s`, `1h02m`. */
export function formatElapsed(fromIso: string, nowMs: number): string {
  const start = Date.parse(fromIso);
  const seconds = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((nowMs - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** `TASK-006 coder claude-dev 2m14s`, or `tester @ testing 1m03s` when the run has no task. */
export function liveRunLabel(run: Pick<DriveLiveRun, "task" | "role" | "runner" | "stage" | "elapsed">): string {
  return run.task ? `${run.task} ${run.role} ${run.runner} ${run.elapsed}` : `${run.role} @ ${run.stage} ${run.elapsed}`;
}

/** One readable line of a drive-log object, without its timestamp. */
export function describeEvent(event: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === "at" || key === "event" || value === undefined || value === null) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    parts.push(`${key}=${text.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  const name = typeof event.event === "string" ? event.event : "event";
  return [name, ...parts].join(" ");
}

export function tailLines(path: string, count: number): string[] {
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

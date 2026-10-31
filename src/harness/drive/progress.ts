import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

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
  /** What the worker did last, from its log: `Edit src/a.ts`, `Bash npm test`, or the head of its last text. */
  activity?: string;
  /** Time since the log last grew, as formatElapsed prints it. */
  activityAgo?: string;
}

const LOG_TAIL_BYTES = 64 * 1024;
const HEAD_MAX = 80;

const head = (text: string): string => {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ").trim();
  return line.length > HEAD_MAX ? `${line.slice(0, HEAD_MAX - 1)}…` : line;
};

/** Complete lines of the last 64 KiB of a log: a line cut by the tail window or still being written is left out. */
function completeTailLines(path: string): { lines: string[]; mtimeMs: number } | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, "r");
  try {
    const { size, mtimeMs } = fstatSync(fd);
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    lines.pop();
    if (length < size) lines.shift();
    return { lines: lines.filter((line) => line.trim().length > 0), mtimeMs };
  } finally {
    closeSync(fd);
  }
}

function parseObject(line: string): Record<string, unknown> | null {
  if (!line.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

function describeTool(block: Record<string, unknown>): string {
  const name = typeof block.name === "string" ? block.name : "tool";
  const input = block.input && typeof block.input === "object" ? block.input as Record<string, unknown> : {};
  if (typeof input.file_path === "string") return `${name} ${input.file_path}`;
  if (typeof input.command === "string") return `${name} ${head(input.command)}`;
  return name;
}

/** The readable activity of one streamed claude event: its last tool call, else its last text; null for anything else. */
function eventActivity(event: Record<string, unknown>): string | null {
  if (event.type === "result") {
    const text = typeof event.result === "string" ? head(event.result) : "";
    return `${event.is_error === true ? "error" : "result"}${text ? `: ${text}` : ""}`;
  }
  if (event.type !== "assistant") return null;
  const message = event.message && typeof event.message === "object" ? event.message as Record<string, unknown> : {};
  const content = Array.isArray(message.content) ? message.content as unknown[] : [];
  const blocks = content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
  const tool = blocks.filter((b) => b.type === "tool_use").pop();
  if (tool) return describeTool(tool);
  const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string" && b.text.trim()).pop();
  return text ? head(text.text as string) : null;
}

/**
 * What a worker is doing, from the tail of its streamed log (`--output-format stream-json`): the last tool call
 * (name plus file or command head) or, when the latest assistant event is text, that text. Its time is the log's
 * mtime, as the stream carries no timestamps. Null when the log is missing or holds no such event yet.
 */
export function workerActivity(logPath: string): { activity: string; at: string } | null {
  const tail = completeTailLines(logPath);
  if (!tail) return null;
  for (const line of [...tail.lines].reverse()) {
    const event = parseObject(line);
    if (!event || event.type !== "assistant") continue;
    const activity = eventActivity(event);
    if (activity) return { activity, at: new Date(tail.mtimeMs).toISOString() };
  }
  return null;
}

/** The last `count` lines of a worker log, readable: streamed events as activity lines, other output verbatim. */
export function activityLines(logPath: string, count: number): string[] {
  const tail = completeTailLines(logPath);
  if (!tail) return [];
  const out: string[] = [];
  for (const line of tail.lines) {
    const event = parseObject(line);
    if (!event) {
      out.push(line);
      continue;
    }
    const activity = eventActivity(event);
    if (activity) out.push(activity);
  }
  return out.slice(-count);
}

/** ` — Edit src/a.ts (12s ago)`, or "" when the run has no activity yet. */
export function activitySuffix(run: Pick<DriveLiveRun, "activity" | "activityAgo">): string {
  return run.activity ? ` — ${run.activity}${run.activityAgo ? ` (${run.activityAgo} ago)` : ""}` : "";
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

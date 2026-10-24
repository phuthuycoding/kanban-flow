import type { PlannedTask } from "../workflow/tasks.js";
import type { TaskState, TaskStateName } from "../workflow/features.js";

export interface ScheduleInput {
  tasks: PlannedTask[];
  /** Missing entries count as pending. */
  states: Record<string, Pick<TaskState, "state">>;
  /** Extra ids the caller knows are in flight; merged with tasks whose state is running/verifying/merging. */
  running?: string[];
  parallel: number;
}

export type Progress = "done" | "running" | "stuck";

const IN_FLIGHT: ReadonlySet<TaskStateName> = new Set(["running", "verifying", "merging"]);
const STARTABLE: ReadonlySet<TaskStateName> = new Set(["pending", "ready"]);
const TERMINAL: ReadonlySet<TaskStateName> = new Set(["failed", "blocked"]);
const GLOB_CHARS = /[*?[]/;

function normalise(pattern: string): string {
  let p = pattern.replace(/`/g, "").trim();
  while (p.startsWith("./")) p = p.slice(2);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function matchesAll(p: string): boolean {
  return p === "**" || p === "*" || p === "." || p === "";
}

/** Directory portion that is fixed before the first glob char; a partially-written segment is dropped so the prefix stays segment-aligned. */
function staticPrefix(p: string): string {
  const at = p.search(GLOB_CHARS);
  if (at === -1) return p;
  const head = p.slice(0, at);
  return head.slice(0, head.lastIndexOf("/") + 1).replace(/\/+$/, "");
}

function isPathPrefix(prefix: string, path: string): boolean {
  return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

export function patternsOverlap(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (x === y || matchesAll(x) || matchesAll(y)) return true;
  const px = staticPrefix(x);
  const py = staticPrefix(y);
  return isPathPrefix(px, py) || isPathPrefix(py, px);
}

/** A task whose files are unknown (null) may touch anything, so it overlaps every other task. */
export function filesOverlap(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return true;
  return a.some((x) => b.some((y) => patternsOverlap(x, y)));
}

function stateOf(input: Pick<ScheduleInput, "states">, id: string): TaskStateName {
  return input.states[id]?.state ?? "pending";
}

/** Files unknown or a match-all pattern: the task must run with nothing else in flight. */
function runsAlone(task: PlannedTask): boolean {
  return task.files === null || task.files.some((f) => matchesAll(normalise(f)));
}

function runningIds(input: ScheduleInput): Set<string> {
  const ids = new Set(input.running ?? []);
  for (const t of input.tasks) if (IN_FLIGHT.has(stateOf(input, t.id))) ids.add(t.id);
  return ids;
}

export function nextToStart(input: ScheduleInput): string[] {
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const running = [...runningIds(input)].map((id) => byId.get(id));
  const picked: PlannedTask[] = [];
  const slots = input.parallel - running.length;

  for (const task of input.tasks) {
    if (picked.length >= slots) break;
    if (!STARTABLE.has(stateOf(input, task.id))) continue;
    if (!task.dependencies.every((d) => stateOf(input, d) === "done")) continue;
    if (runsAlone(task)) {
      if (running.length === 0 && picked.length === 0) picked.push(task);
      continue;
    }
    const others = [...running, ...picked];
    // A running id missing from the plan has unknown files, so it blocks like a files-unknown task.
    if (others.some((o) => o === undefined || filesOverlap(task.files, o.files))) continue;
    picked.push(task);
  }
  return picked.map((t) => t.id);
}

/** Task id -> the failed/blocked task upstream that prevents it from ever starting in this drive. */
export function blockedBy(
  tasks: PlannedTask[],
  states: ScheduleInput["states"],
): Record<string, string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result: Record<string, string> = {};
  const culprit = (id: string, seen: Set<string>): string | undefined => {
    if (seen.has(id)) return undefined;
    seen.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (TERMINAL.has(stateOf({ states }, dep))) return dep;
      const upstream = culprit(dep, seen);
      if (upstream !== undefined) return upstream;
    }
    return undefined;
  };
  for (const task of tasks) {
    const own = stateOf({ states }, task.id);
    if (own === "done" || TERMINAL.has(own)) continue;
    const found = culprit(task.id, new Set());
    if (found !== undefined) result[task.id] = found;
  }
  return result;
}

export function progressState(input: ScheduleInput): Progress {
  if (input.tasks.every((t) => stateOf(input, t.id) === "done")) return "done";
  if (runningIds(input).size > 0 || nextToStart(input).length > 0) return "running";
  return "stuck";
}

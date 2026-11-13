import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_INDEX } from "./schema.js";
import { parseMarkdownTable, readMarkdownSection, splitFrontmatter } from "../shared/frontmatter.js";
import { finding, type Finding } from "./findings.js";
import { filesOverlap, firstOverlap } from "./allowlist.js";
import type { Feature } from "./features.js";

export interface PlannedTask {
  id: string;
  description: string;
  dependencies: string[];
  /** Declared file allowlist; null when the plan does not say (files unknown). */
  files: string[] | null;
  refs?: string;
  expectedOutput?: string;
}

const NO_DEPENDENCY = new Set(["", "-", "—", "none", "n/a"]);

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h.trim().toLowerCase() === name);
}

/** Tasks from the `## Task Breakdown` table of an implementation plan. No table or no Task column means no tasks. */
export function parseTaskGraph(planBody: string): { tasks: PlannedTask[] } {
  const section = readMarkdownSection(planBody, "Task Breakdown");
  const table = section === null ? null : parseMarkdownTable(section);
  if (!table) return { tasks: [] };
  const col = {
    id: columnIndex(table.headers, "task"),
    description: columnIndex(table.headers, "description"),
    dependencies: columnIndex(table.headers, "dependencies"),
    expected: columnIndex(table.headers, "expected output"),
    refs: columnIndex(table.headers, "fr / uc references"),
    files: columnIndex(table.headers, "files"),
  };
  if (col.id === -1) return { tasks: [] };
  const cell = (row: string[], i: number): string => (i === -1 ? "" : (row[i] ?? ""));
  const tasks: PlannedTask[] = [];
  for (const row of table.rows) {
    const id = cell(row, col.id).replace(/`/g, "").trim().toUpperCase();
    if (!id) continue;
    const depsRaw = cell(row, col.dependencies).trim();
    const dependencies = NO_DEPENDENCY.has(depsRaw.toLowerCase())
      ? []
      : [...depsRaw.matchAll(/\bTASK-\d+\b/gi)].map((m) => m[0].toUpperCase());
    const files = cell(row, col.files).split(",").map((f) => f.replace(/`/g, "").trim()).filter((f) => !NO_DEPENDENCY.has(f.toLowerCase()));
    const task: PlannedTask = {
      id,
      description: cell(row, col.description),
      dependencies,
      files: files.length > 0 ? files : null,
    };
    const refs = cell(row, col.refs);
    if (refs) task.refs = refs;
    const expectedOutput = cell(row, col.expected);
    if (expectedOutput) task.expectedOutput = expectedOutput;
    tasks.push(task);
  }
  return { tasks };
}

/** 1-based wave per task id: 1 + the deepest dependency. Unknown dependencies are ignored and cycle edges count as no dependency. */
export function taskWaves(tasks: PlannedTask[]): Record<string, number> {
  const byId = new Map<string, PlannedTask>();
  for (const t of tasks) if (!byId.has(t.id)) byId.set(t.id, t);
  const waves: Record<string, number> = {};
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (id in waves) return waves[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let deepest = 0;
    for (const dep of byId.get(id)!.dependencies) if (byId.has(dep)) deepest = Math.max(deepest, depth(dep));
    visiting.delete(id);
    return (waves[id] = deepest + 1);
  };
  for (const id of byId.keys()) depth(id);
  return waves;
}

function findCycles(tasks: PlannedTask[]): string[][] {
  const byId = new Map<string, PlannedTask>();
  for (const t of tasks) if (!byId.has(t.id)) byId.set(t.id, t);
  const done = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();
  const visit = (id: string): void => {
    const at = stack.indexOf(id);
    if (at !== -1) {
      const loop = stack.slice(at);
      const min = loop.reduce((best, cur, i) => (cur < loop[best] ? i : best), 0);
      const rotated = [...loop.slice(min), ...loop.slice(0, min)];
      cycles.set(rotated.join(","), rotated);
      return;
    }
    if (done.has(id)) return;
    stack.push(id);
    for (const dep of byId.get(id)!.dependencies) if (byId.has(dep)) visit(dep);
    stack.pop();
    done.add(id);
  };
  for (const id of byId.keys()) visit(id);
  return [...cycles.values()];
}

/** A bug whose implementation plan's Task Breakdown has a task is planned like a feature; without one it keeps its checkbox tasks. */
export function bugHasPlan(feature: Feature): boolean {
  if (feature.meta?.kind !== "bug") return false;
  const path = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  return existsSync(path) && parseTaskGraph(splitFrontmatter(readFileSync(path, "utf8")).body).tasks.length > 0;
}

/** Structural checks on the plan's task graph, planning on. Plans without a task table are not re-gated. */
export function checkTaskGraph(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  if (STAGE_INDEX[feature.stage] < STAGE_INDEX.planning || (feature.meta?.kind === "bug" && !bugHasPlan(feature))) return issues;
  const file = ARTIFACTS["implementation-plan"].file;
  const path = join(feature.dir, file);
  if (!existsSync(path)) return issues;
  const { tasks } = parseTaskGraph(splitFrontmatter(readFileSync(path, "utf8")).body);
  const error = (code: string, message: string): void => {
    issues.push(finding(feature, "ERROR", file, code, message));
  };
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id) && !reported.has(t.id)) {
      reported.add(t.id);
      error("task_duplicate", `${t.id} is defined more than once in the Task Breakdown.`);
    }
    seen.add(t.id);
  }
  for (const t of tasks) {
    for (const dep of new Set(t.dependencies)) {
      if (!seen.has(dep)) error("task_dep_missing", `${t.id} depends on ${dep}, which is not in the Task Breakdown.`);
    }
  }
  for (const cycle of findCycles(tasks)) {
    error("task_dep_cycle", `Task dependency cycle: ${[...cycle, cycle[0]].join(" → ")}`);
  }
  return issues;
}

export interface TaskViewRow {
  id: string;
  description: string;
  dependencies: string[];
  files: string[] | null;
  /** The plan row's "FR / UC references" cell; absent when the plan has none. */
  refs?: string;
  /** The plan row's "Expected output" cell; absent when the plan has none. */
  expectedOutput?: string;
  wave: number;
  overlaps: { task: string; entries: [string, string] | null }[];
}

/** The planned tasks of an item with their wave. */
export function taskView(feature: Feature): TaskViewRow[] {
  if (feature.meta?.kind === "bug" && !bugHasPlan(feature)) return [];
  const path = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  if (!existsSync(path)) return [];
  const { tasks } = parseTaskGraph(splitFrontmatter(readFileSync(path, "utf8")).body);
  const waves = taskWaves(tasks);
  return tasks.map((t) => ({
    id: t.id,
    description: t.description,
    dependencies: t.dependencies,
    files: t.files,
    ...(t.refs ? { refs: t.refs } : {}),
    ...(t.expectedOutput ? { expectedOutput: t.expectedOutput } : {}),
    wave: waves[t.id],
    overlaps: tasks
      .filter((o) => o.id !== t.id && filesOverlap(t.files, o.files))
      .map((o) => ({ task: o.id, entries: firstOverlap(t.files, o.files) })),
  }));
}

/** Largest plan for which the max-width search stays exact; the branch-and-bound is exponential. */
const EXACT_WIDTH_LIMIT = 30;

export interface TaskGraphSummary {
  criticalPath: string[];
  length: number;
  maxWidth: number;
  /** false when `maxWidth` is a greedy lower bound (plans above EXACT_WIDTH_LIMIT tasks). */
  maxWidthExact: boolean;
  widthSet: string[];
  earliestStart: Record<string, number>;
}

/** Critical path, widest conflict-free task set and earliest starts of a task view. Read-only; taskView does not call it. */
export function taskGraphSummary(rows: TaskViewRow[]): TaskGraphSummary {
  const ids = rows.map((r) => r.id).sort();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const earliestStart: Record<string, number> = {};
  for (const r of rows) earliestStart[r.id] = r.wave;

  const criticalPath: string[] = [];
  if (ids.length > 0) {
    let current = ids.reduce((best, id) => (byId.get(id)!.wave > byId.get(best)!.wave ? id : best));
    for (;;) {
      criticalPath.unshift(current);
      const deps = byId.get(current)!.dependencies.filter((d) => byId.has(d)).sort();
      if (deps.length === 0) break;
      current = deps.reduce((best, id) => (byId.get(id)!.wave > byId.get(best)!.wave ? id : best));
    }
  }

  const ancestors = new Map<string, Set<string>>();
  const ancestorsOf = (id: string): Set<string> => {
    const known = ancestors.get(id);
    if (known) return known;
    const set = new Set<string>();
    ancestors.set(id, set);
    for (const dep of byId.get(id)!.dependencies) {
      if (!byId.has(dep)) continue;
      set.add(dep);
      for (const up of ancestorsOf(dep)) set.add(up);
    }
    return set;
  };
  const conflict = (a: string, b: string): boolean =>
    ancestorsOf(a).has(b) ||
    ancestorsOf(b).has(a) ||
    byId.get(a)!.overlaps.some((o) => o.task === b) ||
    byId.get(b)!.overlaps.some((o) => o.task === a);

  let widthSet: string[] = [];
  const chosen: string[] = [];
  const search = (from: number): void => {
    if (chosen.length > widthSet.length) widthSet = [...chosen];
    for (let i = from; i < ids.length; i++) {
      if (chosen.length + (ids.length - i) <= widthSet.length) return;
      if (chosen.some((c) => conflict(c, ids[i]))) continue;
      chosen.push(ids[i]);
      search(i + 1);
      chosen.pop();
    }
  };
  const exact = ids.length <= EXACT_WIDTH_LIMIT;
  if (exact) {
    search(0);
  } else {
    for (const id of ids) {
      if (!widthSet.some((c) => conflict(c, id))) widthSet.push(id);
    }
  }

  return { criticalPath, length: criticalPath.length, maxWidth: widthSet.length, maxWidthExact: exact, widthSet, earliestStart };
}

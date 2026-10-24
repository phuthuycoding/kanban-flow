import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_INDEX, type Stage } from "./schema.js";
import { parseMarkdownTable, readMarkdownSection, splitFrontmatter } from "../shared/frontmatter.js";
import { finding, type Finding } from "./findings.js";
import type { Feature, TaskStateName } from "./features.js";
import { writeFileAtomic } from "../shared/paths.js";
import type { HarnessConfig } from "../harness/config.js";

export interface PlannedTask {
  id: string;
  description: string;
  dependencies: string[];
  /** Role named in the plan; `-` when the plan declares none. */
  role: string;
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
    role: columnIndex(table.headers, "role"),
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
      role: cell(row, col.role).replace(/`/g, "").trim() || "-",
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

/** Role that runs a stage: its configured chain, or the main role when the stage is unassigned. */
export function resolveStageRoles(stage: Stage, harness: HarnessConfig): string[] {
  const chain = harness.stages[stage];
  return chain && chain.length > 0 ? chain : [harness.main];
}

/** Role that runs a task: the plan's role when the harness declares it, otherwise the first implementation role, otherwise main. */
export function resolveTaskRole(task: Pick<PlannedTask, "role">, harness: HarnessConfig): string {
  if (task.role !== "-" && task.role in harness.roles) return task.role;
  return resolveStageRoles("implementation", harness)[0];
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

/** Structural checks on the plan's task graph, planning on. Plans without a task table are not re-gated. */
export function checkTaskGraph(feature: Feature, harness?: HarnessConfig): Finding[] {
  const issues: Finding[] = [];
  if (STAGE_INDEX[feature.stage] < STAGE_INDEX.planning || feature.meta?.kind === "bug") return issues;
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
  if (harness) {
    for (const t of tasks) {
      if (t.role !== "-" && !(t.role in harness.roles)) {
        error("task_role_unknown", `${t.id} names role "${t.role}", which is not in harness.roles (${Object.keys(harness.roles).join(", ")}).`);
      }
    }
  }
  return issues;
}

export interface TaskViewRow {
  id: string;
  description: string;
  role: string;
  dependencies: string[];
  files: string[] | null;
  wave: number;
  state: TaskStateName;
  reason?: string;
  /** For a pending task: the first dependency that is blocked or failed. */
  blockedBy?: string;
}

/** Planned tasks joined with stored state. Unstored tasks are `pending`, or `ready` once every dependency is `done`. */
export function taskView(feature: Feature, harness: HarnessConfig): TaskViewRow[] {
  if (feature.meta?.kind === "bug") return [];
  const path = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  if (!existsSync(path)) return [];
  const { tasks } = parseTaskGraph(splitFrontmatter(readFileSync(path, "utf8")).body);
  const waves = taskWaves(tasks);
  const stored = feature.meta?.tasks ?? {};
  const stateOf = (id: string): TaskStateName => stored[id]?.state ?? "pending";
  return tasks.map((t) => {
    let state = stateOf(t.id);
    if (state === "pending" && t.dependencies.every((d) => stateOf(d) === "done")) state = "ready";
    const row: TaskViewRow = {
      id: t.id,
      description: t.description,
      role: resolveTaskRole(t, harness),
      dependencies: t.dependencies,
      files: t.files,
      wave: waves[t.id],
      state,
    };
    const reason = stored[t.id]?.reason;
    if (reason) row.reason = reason;
    if (state === "pending") {
      const blocker = t.dependencies.find((d) => stateOf(d) === "blocked" || stateOf(d) === "failed");
      if (blocker) row.blockedBy = blocker;
    }
    return row;
  });
}

export interface TasksBaseline {
  sha: string;
  /** `git status --porcelain` lines of the item worktree. */
  porcelain: string[];
}

function baselineSection(existing: string | null): string | null {
  if (existing === null) return null;
  const match = /^## Baseline[ \t]*$/m.exec(existing);
  if (!match) return null;
  const rest = existing.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return (match[0] + (next === -1 ? rest : rest.slice(0, next))).trimEnd();
}

/** The `tasks.md` text for a task view; an existing `## Baseline` section is carried over byte-for-byte. */
export function renderTasksMd(existing: string | null, view: TaskViewRow[], baseline?: TasksBaseline): string {
  const kept = baselineSection(existing);
  const baselineBlock = kept ?? (baseline
    ? ["## Baseline", "", `Branch HEAD: ${baseline.sha}`, "", "git status --porcelain:", "```", ...baseline.porcelain, "```"].join("\n")
    : null);
  const lines = view.map((t) => {
    const note = t.state === "blocked" || t.state === "failed"
      ? ` (${t.state}${t.reason ? `: ${t.reason.replace(/\s+/g, " ").trim()}` : ""})`
      : "";
    return `- [${t.state === "done" ? "x" : " "}] ${t.id} — ${t.description}${note}`;
  });
  return `# Tasks\n\n${baselineBlock ? `${baselineBlock}\n\n` : ""}## Tasks\n\n${lines.join("\n")}\n`;
}

/** Render and atomically write `tasks.md` in the item folder, keeping an existing Baseline. */
export async function writeTasksMd(feature: Feature, view: TaskViewRow[], baseline?: TasksBaseline): Promise<void> {
  const file = join(feature.dir, "tasks.md");
  await writeFileAtomic(file, renderTasksMd(existsSync(file) ? readFileSync(file, "utf8") : null, view, baseline));
}

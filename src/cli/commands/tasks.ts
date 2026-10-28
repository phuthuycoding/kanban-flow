import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findFeature, type Feature } from "../../workflow/features.js";
import { checkTaskGraph, taskView, type TaskViewRow } from "../../workflow/tasks.js";
import { readProjectConfig } from "../../project/config.js";
import type { HarnessConfig } from "../../harness/config.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const NO_HARNESS: HarnessConfig = { main: "main", roles: {}, stages: {}, runners: {} };

interface ShownTask extends TaskViewRow {
  /** `tasks.md` when done was read from a checkbox because meta.tasks is absent. */
  stateSource: "meta" | "tasks.md" | "view";
}

function checkedTaskIds(dir: string): Set<string> {
  const path = join(dir, "tasks.md");
  if (!existsSync(path)) return new Set();
  const ids = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const box = /^\s*-\s\[([xX])\]\s+(.*)$/.exec(line);
    if (!box) continue;
    const id = /\b(TASK-\d+)\b/.exec(box[2]);
    if (id) ids.add(id[1]);
  }
  return ids;
}

/** Display-only. A checkbox never becomes scheduler state: taskView stays the driver's source. */
function showTasks(feature: Feature, view: TaskViewRow[]): ShownTask[] {
  if (feature.meta?.tasks !== undefined) {
    const stored = feature.meta.tasks;
    return view.map((t) => ({ ...t, state: stored[t.id]?.state ?? t.state, stateSource: "meta" }));
  }
  const checked = checkedTaskIds(feature.dir);
  const rows: ShownTask[] = view.map((t) =>
    checked.has(t.id) ? { ...t, state: "done", blockedBy: undefined, reason: undefined, stateSource: "tasks.md" } : { ...t, stateSource: "view" });
  const done = new Set(rows.filter((t) => t.state === "done").map((t) => t.id));
  return rows.map((t) => (t.state === "pending" && t.dependencies.every((d) => done.has(d)) ? { ...t, state: "ready" } : t));
}

function renderRow(t: ShownTask): string {
  const deps = t.dependencies.length > 0 ? t.dependencies.join(", ") : "-";
  const files = t.files ? t.files.join(", ") : "files unknown";
  const note = t.blockedBy ? `blocked by ${t.blockedBy}` : t.reason ?? "";
  const source = t.stateSource === "tasks.md" ? "tasks.md" : "";
  return `${t.id}  wave ${t.wave}  ${t.state.padEnd(9)}  ${t.role}  deps: ${deps}  files: ${files}${note ? `  ${note}` : ""}${source ? `  ${source}` : ""}`;
}

export async function cmdTasks(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf tasks <feature> [--json]", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const feature = findFeature(root.root, name);
  if (!feature) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  const harness = readProjectConfig(root.root).harness ?? NO_HARNESS;

  const errors = checkTaskGraph(feature, harness).filter((f) => f.severity === "ERROR");
  if (errors.length > 0) {
    return {
      code: 1,
      stdout: [`Task graph of '${feature.name}' is invalid; fix the plan:`, ...errors.map((f) => `ERROR ${f.code}: ${f.message}`)].join("\n"),
      stderr: "invalid task graph",
    };
  }

  const view = showTasks(feature, taskView(feature, harness));
  if (args.options.json) {
    return { code: 0, stdout: JSON.stringify({ feature: feature.name, tasks: view }, null, 2) };
  }
  if (view.length === 0) return { code: 0, stdout: "No planned tasks." };
  return { code: 0, stdout: view.map(renderRow).join("\n") };
}

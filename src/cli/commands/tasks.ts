import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ProjectConfigError, readProjectConfig } from "../../project/config.js";
import { DEFAULT_DEVELOPER_MAX } from "../../project/harness-config.js";
import type { Feature } from "../../workflow/features.js";
import { checkTaskGraph, taskGraphSummary, taskView, type TaskViewRow } from "../../workflow/tasks.js";
import { resolveItem } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

interface ShownTask extends TaskViewRow {
  /** `done` when its `tasks.md` checkbox is ticked; otherwise `ready` once every dependency is done. */
  state: "pending" | "ready" | "done";
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

function showTasks(feature: Feature, view: TaskViewRow[]): ShownTask[] {
  const done = checkedTaskIds(feature.dir);
  return view.map((t) => ({
    ...t,
    state: done.has(t.id) ? "done" : t.dependencies.every((d) => done.has(d)) ? "ready" : "pending",
  }));
}

function renderRow(t: ShownTask): string {
  const deps = t.dependencies.length > 0 ? t.dependencies.join(", ") : "-";
  const files = t.files ? t.files.join(", ") : "files unknown";
  return `${t.id}  wave ${t.wave}  ${t.state.padEnd(9)}  deps: ${deps}  files: ${files}`;
}

/**
 * The ceiling `kf tasks --json` reports. A bad `harness.developers` is refused; any other config error must not
 * hide the task list, and since the configured ceiling is then unknown it reads 1, which every project allows.
 */
export function readDeveloperCeiling(root: string): { max: number; source: string; error?: string } | { failed: string } {
  try {
    const max = readProjectConfig(root).harness?.developers?.max;
    return max === undefined ? { max: DEFAULT_DEVELOPER_MAX, source: "default" } : { max, source: "config" };
  } catch (err) {
    if (!(err instanceof ProjectConfigError)) throw err;
    if (err.message.includes("harness.developers")) return { failed: err.message };
    return { max: 1, source: "invalid-config", error: err.message };
  }
}

export async function cmdTasks(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf tasks <feature> [--json] [--graph]", stderr: "missing feature" };
  const root = await resolveItem(cwd, name);
  if (!root.ok) return root.refusal;
  const feature = root.item;

  const errors = checkTaskGraph(feature).filter((f) => f.severity === "ERROR");
  if (errors.length > 0) {
    return {
      code: 1,
      stdout: [`Task graph of '${feature.name}' is invalid; fix the plan:`, ...errors.map((f) => `ERROR ${f.code}: ${f.message}`)].join("\n"),
      stderr: "invalid task graph",
    };
  }

  if (args.options.graph) {
    const summary = taskGraphSummary(taskView(feature));
    if (args.options.json) {
      return { code: 0, stdout: JSON.stringify({ feature: feature.name, ...summary }, null, 2) };
    }
    const path = summary.length === 0 ? "none" : summary.criticalPath.join(" \u2192 ");
    const width = summary.maxWidth === 0 ? "max width: 0" : `max width: ${summary.maxWidthExact ? "" : "\u2265"}${summary.maxWidth} (${summary.widthSet.join(", ")})`;
    const lines = [`critical path: ${path} (length ${summary.length})`, width];
    if (summary.length > 0) {
      lines.push(`earliest start: ${Object.entries(summary.earliestStart).map(([id, w]) => `${id} ${w}`).join(", ")}`);
    }
    return { code: 0, stdout: lines.join("\n") };
  }

  const view = showTasks(feature, taskView(feature));
  if (args.options.json) {
    const developers = readDeveloperCeiling(root.root);
    if ("failed" in developers) return { code: 1, stdout: developers.failed, stderr: "invalid project config" };
    return { code: 0, stdout: JSON.stringify({ feature: feature.name, tasks: view, developers }, null, 2) };
  }
  if (view.length === 0) return { code: 0, stdout: "No planned tasks." };
  return { code: 0, stdout: view.map(renderRow).join("\n") };
}

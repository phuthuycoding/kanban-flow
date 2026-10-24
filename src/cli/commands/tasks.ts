import { findFeature } from "../../workflow/features.js";
import { checkTaskGraph, taskView, type TaskViewRow } from "../../workflow/tasks.js";
import { readProjectConfig } from "../../project/config.js";
import type { HarnessConfig } from "../../harness/config.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const NO_HARNESS: HarnessConfig = { main: "main", roles: {}, stages: {}, runners: {} };

function renderRow(t: TaskViewRow): string {
  const deps = t.dependencies.length > 0 ? t.dependencies.join(", ") : "-";
  const files = t.files ? t.files.join(", ") : "files unknown";
  const note = t.blockedBy ? `blocked by ${t.blockedBy}` : t.reason ?? "";
  return `${t.id}  wave ${t.wave}  ${t.state.padEnd(9)}  ${t.role}  deps: ${deps}  files: ${files}${note ? `  ${note}` : ""}`;
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

  const view = taskView(feature, harness);
  if (args.options.json) {
    return { code: 0, stdout: JSON.stringify({ feature: feature.name, tasks: view }, null, 2) };
  }
  if (view.length === 0) return { code: 0, stdout: "No planned tasks." };
  return { code: 0, stdout: view.map(renderRow).join("\n") };
}

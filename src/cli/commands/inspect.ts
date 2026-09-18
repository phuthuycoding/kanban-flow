import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS } from "../../workflow/schema.js";
import { findFeature, listFeatures } from "../../workflow/features.js";
import { computeStatus, renderStatusText, statusToJson } from "../../workflow/status.js";
import { validateFeature, renderValidateText, validateToJson } from "../../workflow/validate.js";
import { dashboardData } from "../../dashboard/dashboard.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export async function cmdList(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const features = listFeatures(root.root);
  if (args.options.json) {
    return {
      code: 0,
      stdout: JSON.stringify(features.map((f) => ({
        name: f.name,
        kind: f.meta?.kind ?? "feature",
        context: f.context,
        stage: f.stage,
        folder: f.folder,
      })), null, 2),
    };
  }
  if (features.length === 0) {
    return { code: 0, stdout: "No features found." };
  }
  const lines = features.map((f) => `${f.stage.padEnd(14)} ${(f.meta?.kind === "bug" ? "[bug] " : "") + f.name}${f.context ? ` (${f.context})` : ""}`);
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdShow(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Missing feature name.", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  const specPath = join(f.dir, ARTIFACTS["spec-requirement"].file);
  let content: string;
  try {
    content = await readFile(specPath, "utf8");
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
    content = `(no ${ARTIFACTS["spec-requirement"].file} in ${f.dir})`;
  }
  if (args.options.json) {
    return { code: 0, stdout: JSON.stringify({ feature: f.name, kind: f.meta?.kind ?? "feature", context: f.context, stage: f.stage, spec: content }) };
  }
  return { code: 0, stdout: content };
}

export async function cmdView(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const data = dashboardData(root.root);
  if (args.options.json) return { code: 0, stdout: JSON.stringify(data, null, 2) };
  const m = data.metrics;
  const lines = [
    "kaban-flow analytics", "",
    `Total: ${m.total} (${m.features} features, ${m.bugs} bugs)`,
    `Executing: ${m.executing}   Backlog: ${m.backlog}   Completed: ${m.completed}`,
    `Completion rate: ${m.completionRate === null ? "N/A" : m.completionRate + "%"}`,
    `Executing tasks: ${m.tasks.done}/${m.tasks.total} (${m.tasks.completionRate === null ? "N/A" : m.tasks.completionRate + "%"})`,
    "", "By stage:",
    ...data.charts.byStage.map((row) => `  ${row.id.padEnd(14)} ${row.count} (${row.features} features, ${row.bugs} bugs)`),
    "", "By context:",
    ...data.charts.byContext.map((row) => `  ${row.label}: ${row.count} (${row.features} features, ${row.bugs} bugs)`),
    "", "Approval (planning through review):",
    ...data.charts.approvals.map((row) => `  ${row.id}: ${row.count}`),
  ];
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdStatus(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const json = Boolean(args.options.json);
  const all = Boolean(args.options.all);
  const change = typeof args.options.change === "string" ? args.options.change : null;

  if (!change && !all) {
    return { code: 1, stdout: 'Missing required option --change <feature> (or --all for every feature).\nRun: kf list', stderr: "missing --change" };
  }

  const features = change
    ? (() => { const f = findFeature(root.root, change); return f ? [f] : []; })()
    : listFeatures(root.root);

  if (change && features.length === 0) {
    return { code: 1, stdout: `Unknown feature '${change}'. Run: kf list`, stderr: "unknown feature" };
  }
  const statuses = features.map((f) => computeStatus(f));
  if (json) {
    return {
      code: 0,
      stdout: JSON.stringify(
        change
          ? statusToJson(statuses[0])
          : { features: statuses.map(statusToJson) },
        null, 2,
      ),
    };
  }
  if (statuses.length === 0) {
    return { code: 0, stdout: "No active features. Create one with: kf new <feature> --context <ctx>" };
  }
  const blocks = statuses.map(renderStatusText);
  return { code: 0, stdout: blocks.join("\n\n") };
}

export async function cmdValidate(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const json = Boolean(args.options.json);
  const strict = Boolean(args.options.strict);
  const all = Boolean(args.options.all);
  const change = typeof args.options.change === "string" ? args.options.change : null;

  if (!change && !all) {
    return { code: 1, stdout: 'Missing required option --change <feature> (or --all).', stderr: "missing --change" };
  }
  const features = change
    ? (() => { const f = findFeature(root.root, change); return f ? [f] : []; })()
    : listFeatures(root.root);

  if (change && features.length === 0) {
    return { code: 1, stdout: `Unknown feature '${change}'.`, stderr: "unknown feature" };
  }
  const results = features.map((f) => validateFeature(f, strict));
  const allValid = results.every((r) => r.valid);
  if (json) {
    return { code: allValid ? 0 : 1, stdout: JSON.stringify(results.map(validateToJson), null, 2), stderr: allValid ? undefined : "validation failed" };
  }
  const blocks = results.map(renderValidateText);
  const codes = blocks.join("\n") + `\nTotals: ${results.filter((r) => r.valid).length} passed, ${results.filter((r) => !r.valid).length} failed (${results.length} items)`;
  return { code: allValid ? 0 : 1, stdout: codes, stderr: allValid ? undefined : "validation failed" };
}

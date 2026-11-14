import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { findFeature } from "../../workflow/features.js";
import { METRICS_FILE } from "../../workflow/item-metrics.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf metrics <feature> [--json]";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

const LABELS: Array<[string, string]> = [
  ["closedAt", "closed"], ["id", "id"], ["kind", "kind"], ["estimate", "estimate"], ["actual", "actual"], ["gap", "gap"],
  ["stages", "stages"], ["path", "path"], ["gates", "gates"], ["ledger", "ledger"], ["filesChanged", "files changed"],
  ["tier", "tier"], ["loopMetricsRow", "loop-metrics row"],
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One figure as text: a missing or unreliable one with its reason, a span in minutes, anything else field by field. */
function figure(value: unknown): string {
  if (value === null) return "none";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map(figure).join(", ");
  if (!isRecord(value)) return String(value);
  if (typeof value.stage === "string") {
    const { stage, ...rest } = value;
    return `${stage} ${figure(rest)}`;
  }
  if (typeof value.missing === "string") return `missing: ${value.missing}`;
  if (typeof value.unreliable === "string") return `unreliable: ${value.unreliable}`;
  if (typeof value.minutes === "number" && Object.keys(value).every((k) => k === "minutes" || k === "approximate")) {
    return `${value.minutes} min${value.approximate === true ? " (approximate)" : ""}`;
  }
  return Object.entries(value).map(([k, v]) => `${k} ${figure(v)}`).join(", ");
}

function renderText(feature: string, m: Record<string, unknown>): string {
  const known = new Set(["v", "feature", ...LABELS.map(([k]) => k)]);
  const lines = [`Metrics — ${feature}`];
  for (const [key, label] of LABELS) if (key in m) lines.push(`${label}: ${key === "path" && Array.isArray(m.path) ? m.path.join(" → ") : figure(m[key])}`);
  for (const [key, value] of Object.entries(m)) if (!known.has(key)) lines.push(`${key}: ${figure(value)}`);
  return lines.join("\n");
}

/** `kf metrics <feature> [--json]`: the measurement the close wrote. Exit 0 printed, 1 none yet, 3 bad input. */
export async function cmdMetrics(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  if (args.parseError !== undefined) return badInput(args.parseError);
  if (args.positionals.length === 0) return badInput("missing feature");
  if (args.positionals.length > 1) return badInput(`expected one feature, got: ${args.positionals.join(" ")}`);
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err ?? "No .works found. Run: kf init", stderr: "no works" };
  const name = args.positionals[0];
  const item = findFeature(root.root, name);
  if (!item) return badInput(`Unknown feature '${name}'. Run: kf list`);
  const path = join(item.dir, METRICS_FILE);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return { code: 1, stdout: `no measurement yet for ${item.name}: the close writes ${METRICS_FILE}`, stderr: "no measurement" };
  }
  const text = readFileSync(path, "utf8");
  let measurement: unknown;
  try {
    measurement = JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return { code: 1, stdout: `the measurement of ${item.name} is not valid JSON: ${path}: ${err.message}`, stderr: "invalid measurement" };
  }
  if (!isRecord(measurement)) return { code: 1, stdout: `the measurement of ${item.name} is not a JSON object: ${path}`, stderr: "invalid measurement" };
  if (args.options.json === true) return { code: 0, stdout: JSON.stringify(measurement, null, 2) };
  return { code: 0, stdout: renderText(item.name, measurement) };
}

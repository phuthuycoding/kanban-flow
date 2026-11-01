import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findFeature } from "../../workflow/features.js";
import {
  HEADER,
  HistoryFileError,
  NUMERIC_COLUMNS,
  PER_TASK_BUCKETS,
  SEATS,
  loopStats,
  parseLedger,
  readHistory,
  recordRow,
  summarise,
  type HistoryRow,
  type LoopStats,
  type ParsedLedger,
  type SeatFigures,
} from "../../workflow/loop-stats.js";
import { taskView } from "../../workflow/tasks.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf loop-stats <feature> [--json] [--record] | kf loop-stats --all [--json]";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });
const refused = (message: string, stderr: string): CmdResult => ({ code: 1, stdout: message, stderr });

const min = (n: number): string => `${n.toFixed(1)} min`;
const list = (lines: number[]): string => (lines.length > 0 ? lines.join(", ") : "none");

function seatLine(name: string, f: SeatFigures): string {
  return `${name}: ${f.count} × median ${min(f.median)}, sum ${min(f.sum)}`;
}

function renderReport(feature: string, stats: LoopStats): string {
  const byModel = Object.entries(stats.byModel).map(([k, v]) => `${k} ${min(v)}`);
  return [
    `Loop stats — ${feature}${stats.inProgress ? " (in progress)" : ""}`,
    `wall: ${min(stats.wallMinutes)}`,
    `busy: ${min(stats.busyMinutes)}`,
    `controller: ${min(stats.controllerMinutes)}`,
    `saved: ${min(stats.savedMinutes)}`,
    `waits: ${min(stats.waitMinutes)}`,
    `seat minutes: ${min(stats.seatMinutes)}`,
    ...SEATS.map((s) => seatLine(s, stats.seats[s])),
    seatLine("verify", stats.verify),
    `rounds: ${stats.rounds}`,
    `cascades: ${stats.cascades}`,
    `tasks: ${stats.tasks}`,
    `by model: ${byModel.length > 0 ? byModel.join(", ") : "none"}`,
    `unparsed lines: ${list(stats.unparsed)}`,
    `orphan dispatches: ${list(stats.orphans)}`,
    `open waits: ${list(stats.openWaits)}`,
    `other timed lines: ${stats.otherTimed}`,
    `untimed lines: ${stats.untimed}`,
  ].join("\n");
}

/** The first 10 characters of the latest timestamp, as written with its own offset. */
function ledgerDate(parsed: ParsedLedger): string {
  let latest = parsed.lines[0];
  for (const l of parsed.lines) {
    if (l.ts !== undefined && (latest.ts === undefined || l.ts > latest.ts)) latest = l;
  }
  return latest.stamp!.slice(0, 10);
}

function renderHistory(rows: HistoryRow[]): string {
  const summary = summarise(rows);
  return [
    HEADER,
    ...rows.map((r) => [r.date, r.feature, ...NUMERIC_COLUMNS.map((c) => r[c])].join(" · ")),
    ["median", "-", ...NUMERIC_COLUMNS.map((c) => summary.medians[c])].join(" · "),
    `per task: ${PER_TASK_BUCKETS.map((b) => `${b} ${summary.perTask[b].toFixed(1)}`).join(" · ")}`,
    `largest: ${summary.largest.bucket} ${summary.largest.minutesPerTask.toFixed(1)} min/task`,
  ].join("\n");
}

async function allHistory(cwd: string, json: boolean): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return refused(root.err!, "no works");
  let rows: HistoryRow[] | null;
  try {
    rows = readHistory(root.root);
  } catch (err) {
    if (err instanceof HistoryFileError) return refused(err.message, "history file refused");
    throw err;
  }
  if (rows === null) return refused("no loop measured yet", "no history");
  if (!json) return { code: 0, stdout: renderHistory(rows) };
  return { code: 0, stdout: JSON.stringify({ rows, ...summarise(rows) }, null, 2) };
}

export async function cmdLoopStats(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  if (args.parseError !== undefined) return badInput(args.parseError);
  const json = Boolean(args.options.json);
  const record = Boolean(args.options.record);

  if (args.options.all) {
    if (args.positionals.length > 0) return badInput("--all takes no feature");
    if (record) return badInput("--all cannot be combined with --record");
    return allHistory(cwd, json);
  }

  if (args.positionals.length === 0) return badInput("missing feature");
  if (args.positionals.length > 1) return badInput(`expected one feature, got: ${args.positionals.join(" ")}`);
  const root = await findRoot(cwd);
  if (!root.ok) return refused(root.err!, "no works");
  const item = findFeature(root.root, args.positionals[0]);
  if (!item) return badInput(`Unknown feature '${args.positionals[0]}'. Run: kf list`);

  const ledgerPath = join(item.dir, "loop", "progress.md");
  if (!existsSync(ledgerPath)) return refused(`no ledger: ${ledgerPath}`, "no ledger");
  const parsed = parseLedger(readFileSync(ledgerPath, "utf8"));
  if (!parsed.lines.some((l) => l.shape === "dispatched" || l.shape === "done")) {
    return refused(`ledger is untimed: ${ledgerPath}`, "untimed ledger");
  }
  const stats = loopStats(parsed);
  const report = json ? JSON.stringify({ feature: item.name, ...stats }, null, 2) : renderReport(item.name, stats);
  if (!record) return { code: 0, stdout: report };

  const completed = new Set(parsed.lines.filter((l) => l.shape === "complete").map((l) => l.task));
  const missing = taskView(item).map((t) => t.id).filter((id) => !completed.has(id));
  if (missing.length > 0) {
    return refused(`cannot record ${item.name}: no complete line for ${missing.join(", ")}`, "loop not complete");
  }
  let path: string;
  try {
    path = recordRow(root.root, item.name, stats, ledgerDate(parsed));
  } catch (err) {
    if (err instanceof HistoryFileError) return refused(err.message, "history file refused");
    throw err;
  }
  const recorded = `recorded ${item.name} in ${path}`;
  // The JSON report stays parseable on stdout; the confirmation goes to stderr then.
  return json ? { code: 0, stdout: report, stderr: recorded } : { code: 0, stdout: `${report}\n${recorded}` };
}

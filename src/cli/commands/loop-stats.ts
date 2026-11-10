import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { findFeature } from "../../workflow/features.js";
import {
  HEADER,
  HistoryFileError,
  NUMERIC_COLUMNS,
  PER_TASK_BUCKETS,
  SEATS,
  checkVerifyLines,
  checkWaveVerifyLines,
  completedTasks,
  lateStamps,
  loopStats,
  parseLedger,
  parseVerifyLog,
  unansweredOrphans,
  readHistory,
  recordRow,
  summarise,
  type HistoryRow,
  type LagFigures,
  type LoopStats,
  type ParsedLedger,
  type SeatFigures,
} from "../../workflow/loop-stats.js";
import { taskView } from "../../workflow/tasks.js";
import { verifyLogPath, waveVerifyLogPath } from "../../workflow/verify.js";
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

const lagText = (n: number | null): string => (n === null ? "-" : String(n));
const lagPart = (name: string, f: LagFigures): string => `${name} median ${lagText(f.median)} max ${lagText(f.max)} (n=${f.n})`;

/** The unparsed and orphan line numbers as one phrase, or `null` when the ledger has none. */
function brokenLines(unparsed: number[], orphans: number[]): string | null {
  const parts = [
    ...(unparsed.length > 0 ? [`unparsed lines ${list(unparsed)}`] : []),
    ...(orphans.length > 0 ? [`orphan lines ${list(orphans)}`] : []),
  ];
  return parts.length > 0 ? `ledger ${parts.join(" and ")}` : null;
}

/** The problems that make a ledger's figures wrong, as one phrase, or `null` when it has none. */
function ledgerProblems(stats: LoopStats, parsed: ParsedLedger, itemDir: string, ledgerPath: string): string | null {
  const broken = brokenLines(stats.unparsed, unansweredOrphans(parsed, stats.orphans));
  const late = lateStamps(parsed, statSync(ledgerPath).mtimeMs);
  const { unlogged, offClock } = checkVerifyLines(parsed, (task) => {
    const log = verifyLogPath(itemDir, task);
    return parseVerifyLog(existsSync(log) ? readFileSync(log, "utf8") : "");
  });
  const waveCheck = checkWaveVerifyLines(parsed, (wave) => {
    const log = waveVerifyLogPath(itemDir, wave);
    return parseVerifyLog(existsSync(log) ? readFileSync(log, "utf8") : "");
  });
  unlogged.push(...waveCheck.unlogged);
  offClock.push(...waveCheck.offClock);
  const parts = [
    ...(broken ? [`${broken} are left out of every figure`] : []),
    ...(unlogged.length > 0 ? [`ledger lines ${list(unlogged)} report a verify exit no kf verify run logged`] : []),
    ...(offClock.length > 0 ? [`ledger lines ${list(offClock)} are stamped over 15 minutes from the kf verify run they report`] : []),
    ...(late.length > 0 ? [`ledger lines ${list(late)} are stamped after the file was last written, so those times did not come from the clock`] : []),
  ];
  return parts.length > 0 ? `${parts.join("; ")}; fix those lines in ${ledgerPath}` : null;
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
    ...(stats.waveVerify
      ? [seatLine("wave verify", { count: stats.waveVerify.count, median: stats.waveVerify.medianMin, sum: stats.waveVerify.sumMin })]
      : []),
    `rounds: ${stats.rounds}`,
    `cascades: ${stats.cascades}`,
    `tasks: ${stats.tasks}`,
    `by model: ${byModel.length > 0 ? byModel.join(", ") : "none"}`,
    `unparsed lines: ${list(stats.unparsed)}`,
    `orphan dispatches: ${list(stats.orphans)}`,
    `open waits: ${list(stats.openWaits)}`,
    `other timed lines: ${stats.otherTimed}`,
    `untimed lines: ${stats.untimed}`,
    `developers peak: ${stats.developersPeak}`,
    `developer overlap: ${min(stats.developerOverlapMinutes)}`,
    `dispatch lag: ${lagPart("developer", stats.dispatchLag.developer)}, ${lagPart("code-reviewer", stats.dispatchLag.codeReviewer)}`,
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
  const tasks = taskView(item);
  const dependencies = Object.fromEntries(tasks.map((t) => [t.id, t.dependencies]));
  const stats = loopStats(parsed, dependencies);
  const report = json ? JSON.stringify({ feature: item.name, ...stats }, null, 2) : renderReport(item.name, stats);
  const problems = ledgerProblems(stats, parsed, item.dir, ledgerPath);
  if (!record) {
    // Plain reporting still exits 0; what makes the figures wrong is named on stderr so it is not missed.
    return problems ? { code: 0, stdout: report, stderr: `warning: ${problems}` } : { code: 0, stdout: report };
  }

  const completed = completedTasks(parsed);
  // A bug item or an item without a plan has no planned tasks; the ledger's dispatched tasks stand in for them.
  const planned = tasks.map((t) => t.id);
  const ids = planned.length > 0 ? planned : [...new Set(parsed.lines.filter((l) => l.shape === "dispatched").map((l) => l.task!))];
  const missing = ids.filter((id) => !completed.has(id));
  if (missing.length > 0) {
    return refused(`cannot record ${item.name}: no complete line for ${missing.join(", ")}`, "loop not complete");
  }
  if (problems) {
    return refused(`cannot record ${item.name}: ${problems} and record again`, "ledger has broken lines");
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

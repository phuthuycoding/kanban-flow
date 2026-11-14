import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { ARTIFACTS } from "./schema.js";
import { findFeature, type Feature, type ItemEstimate } from "./features.js";
import { itemLogPath } from "./item-log.js";
import { readItemLedger, recordRow, recordableRow, HistoryFileError, type ItemLedger, type LedgerLogs } from "./loop-stats.js";
import { taskView } from "./tasks.js";
import { verifyLogPath, waveVerifyLogPath } from "./verify.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { SIZES, sizeOf, type Size } from "./estimate.js";

/*
 * The measurement of a closed item: estimate against actual, the time each stage and human gate took, and what the
 * task loop spent. Every figure that cannot be taken is `{ missing: <reason> }`, never 0, and a span whose clock ran
 * backwards is `{ unreliable }`. Nothing machine-local (a path, a host, a worktree) goes in.
 */

export const METRICS_FILE = "metrics.json";

export type Missing = { missing: string };
export type Unreliable = { unreliable: string };
export type Span = { minutes: number } | Missing | Unreliable;
export type StageTime = { stage: string; minutes: number } | { stage: string; missing: string } | { stage: string; unreliable: string };

/** The loop figures, or why there are none; the absent side's keys are typed `undefined` so either side reads safely. */
export type LedgerFigures =
  | { rounds: number; seatMinutes: number | Missing; models: string[] | Missing; unparsedLines?: number[]; missing?: undefined }
  | { missing: string; rounds?: undefined; seatMinutes?: undefined; models?: undefined; unparsedLines?: undefined };

export interface ItemMeasurement {
  v: 1;
  closedAt: string;
  id: string | null;
  feature: string;
  kind: string;
  estimate: ItemEstimate | { none: true; reason: string };
  actual: { size: Size; workMinutes: number } | Missing;
  gap: number | Missing;
  stages: StageTime[];
  path: string[] | Missing;
  gates: { requirement: Span; plan: Span; merge: ({ minutes: number; approximate: true }) | Missing | Unreliable };
  ledger: LedgerFigures;
  filesChanged: { count: number } | Missing;
  tier: string | Missing;
  loopMetricsRow: { written: true } | Missing;
}

const BACKWARDS = "clock went backwards";
const round1 = (n: number): number => Math.round(n * 10) / 10;
const minutesBetween = (from: number, to: number): number => (to - from) / 60_000;

/** The task and wave verify logs of an item's loop, read where kf verify writes them. */
export function itemLedgerLogs(itemDir: string): LedgerLogs {
  const read = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");
  return {
    verifyLog: (task) => read(verifyLogPath(itemDir, task)),
    waveVerifyLog: (wave) => read(waveVerifyLogPath(itemDir, wave)),
  };
}

interface Segment { stage: string; start: number; end: number | null }
interface Timeline { segments: Segment[]; delivered: number | null }

/** The stage segments of the lifecycle log, in file order, or why there are none. */
function readTimeline(dir: string): Timeline | Missing {
  const path = itemLogPath(dir);
  if (!existsSync(path)) return { missing: "no lifecycle log" };
  const segments: Segment[] = [];
  let delivered: number | null = null;
  const lines = readFileSync(path, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    let rec: unknown;
    try {
      rec = JSON.parse(lines[i]);
    } catch (err) {
      if (err instanceof SyntaxError) return { missing: `lifecycle log line ${i + 1} is not valid JSON` };
      throw err;
    }
    if (typeof rec !== "object" || rec === null) return { missing: `lifecycle log line ${i + 1} is not a record` };
    const at = "at" in rec ? rec.at : undefined;
    const stage = "stage" in rec ? rec.stage : undefined;
    const event = "event" in rec ? rec.event : undefined;
    const ms = typeof at === "string" ? Date.parse(at) : NaN;
    if (Number.isNaN(ms)) return { missing: `lifecycle log line ${i + 1} has no readable time` };
    if (event === "delivered") delivered = ms;
    if (typeof stage !== "string") continue;
    const last = segments[segments.length - 1];
    if (last && last.stage === stage) continue;
    if (last) last.end = ms;
    segments.push({ stage, start: ms, end: null });
  }
  if (segments.length === 0) return { missing: "the lifecycle log records no stage" };
  return { segments, delivered };
}

function span(from: number, to: number): { minutes: number } | Unreliable {
  const m = minutesBetween(from, to);
  return m < 0 ? { unreliable: BACKWARDS } : { minutes: round1(m) };
}

/** Time per stage, summed over its visits, in the order each stage was first entered; the open last stage has none. */
function stageTimes(segments: Segment[]): StageTime[] {
  const order: string[] = [];
  const total = new Map<string, number>();
  const backwards = new Set<string>();
  for (const s of segments) {
    if (s.end === null) continue;
    if (!order.includes(s.stage)) order.push(s.stage);
    const m = minutesBetween(s.start, s.end);
    if (m < 0) backwards.add(s.stage);
    total.set(s.stage, (total.get(s.stage) ?? 0) + m);
  }
  return order.map((stage) => (backwards.has(stage)
    ? { stage, unreliable: BACKWARDS }
    : { stage, minutes: round1(total.get(stage) ?? 0) }));
}

function stageSpan(times: StageTime[], stage: string): Span {
  const t = times.find((s) => s.stage === stage);
  if (!t) return { missing: `no ${stage} stage recorded` };
  if ("minutes" in t) return { minutes: t.minutes };
  return "unreliable" in t ? { unreliable: t.unreliable } : { missing: t.missing };
}

interface Review { created: number | Missing; tier: string | Missing }

/** The review report's PASS `created` stamp (local time, YYYYMMDD_HHMM) and its tier row. */
function readReview(dir: string): Review {
  const path = join(dir, ARTIFACTS["review-report"].file);
  if (!existsSync(path)) return { created: { missing: "no review report" }, tier: { missing: "no review report" } };
  const { fm, body } = splitFrontmatter(readFileSync(path, "utf8"));
  const row = /^\|\s*Tier and reason\s*\|\s*(.*?)\s*\|\s*$/im.exec(body);
  const tier = row && row[1] !== "" ? row[1] : { missing: "no Tier and reason row in the review report" };
  if (fm.status !== "PASS") return { created: { missing: "the review report is not a PASS" }, tier };
  const stamp = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(fm.created ?? "");
  if (!stamp) return { created: { missing: "the review report has no created stamp (YYYYMMDD_HHMM)" }, tier };
  const [, y, mo, d, h, mi] = stamp.map(Number);
  return { created: new Date(y, mo - 1, d, h, mi).getTime(), tier };
}

/** Work minutes: the first entry into implementation to the review PASS, less any time spent in backlog between. */
function workMinutes(segments: Segment[], created: number | Missing): number | Missing {
  const start = segments.find((s) => s.stage === "implementation")?.start;
  if (start === undefined) return { missing: "no implementation stage recorded" };
  if (typeof created !== "number") return created;
  if (created < start) return { missing: `work time unreliable: ${BACKWARDS} (the review passed before implementation began)` };
  let backlog = 0;
  for (const s of segments) {
    if (s.stage !== "backlog") continue;
    const from = Math.max(s.start, start);
    const to = Math.min(s.end ?? created, created);
    if (to > from) backlog += to - from;
  }
  return round1(minutesBetween(start, created - backlog));
}

function ledgerFigures(ledger: ItemLedger | null): LedgerFigures {
  if (ledger === null) return { missing: "no ledger (loop/progress.md)" };
  const { stats } = ledger;
  const seats = ledger.parsed.lines.some((l) => l.shape === "dispatched" || l.shape === "done");
  const noSeats: Missing = { missing: "no seat time recorded" };
  return {
    rounds: stats.rounds,
    seatMinutes: seats ? round1(stats.seatMinutes) : noSeats,
    models: seats ? Object.keys(stats.byModel).sort() : noSeats,
    ...(stats.unparsed.length > 0 ? { unparsedLines: stats.unparsed } : {}),
  };
}

interface Measured { measurement: ItemMeasurement; ledger: ItemLedger | null }

function measure(f: Feature): Measured {
  const meta = f.meta;
  const timeline = readTimeline(f.dir);
  const review = readReview(f.dir);
  const estimate = meta?.estimate ?? { none: true as const, reason: "no estimate was recorded at approval" };

  const fc = meta?.filesChanged;
  const filesChanged: ItemMeasurement["filesChanged"] = fc === undefined
    ? { missing: "the files changed were not counted on entering review" }
    : fc.count === null ? { missing: fc.reason ?? "the files changed could not be counted" } : { count: fc.count };

  let stages: StageTime[];
  let path: string[] | Missing;
  let requirement: Span;
  let plan: Span;
  let merge: ItemMeasurement["gates"]["merge"];
  let actual: ItemMeasurement["actual"];
  let closedAt = new Date().toISOString();
  if ("missing" in timeline) {
    stages = [{ stage: f.stage, missing: timeline.missing }];
    path = { missing: timeline.missing };
    requirement = { missing: timeline.missing };
    plan = { missing: timeline.missing };
    merge = { missing: timeline.missing };
    actual = { missing: timeline.missing };
  } else {
    stages = stageTimes(timeline.segments);
    path = timeline.segments.map((s) => s.stage);
    requirement = stageSpan(stages, "brainstorm");
    plan = stageSpan(stages, "planning");
    if (timeline.delivered !== null) closedAt = new Date(timeline.delivered).toISOString();
    if (timeline.delivered === null) merge = { missing: "no delivered record" };
    else if (typeof review.created !== "number") merge = review.created;
    else {
      const s = span(review.created, timeline.delivered);
      merge = "minutes" in s ? { minutes: s.minutes, approximate: true } : s;
    }
    const work = workMinutes(timeline.segments, review.created);
    actual = typeof work === "number"
      ? { size: sizeOf(work, "count" in filesChanged ? filesChanged.count : null), workMinutes: work }
      : work;
  }

  let gap: number | Missing;
  if ("none" in estimate) gap = { missing: "no estimate" };
  else if ("missing" in actual) gap = { missing: "no actual size" };
  else gap = SIZES.indexOf(actual.size) - SIZES.indexOf(estimate.size);

  const ledger = readItemLedger(f.dir, taskView(f), itemLedgerLogs(f.dir));
  const measurement: ItemMeasurement = {
    v: 1,
    closedAt,
    id: meta?.id ?? null,
    feature: f.name,
    kind: meta?.kind ?? "feature",
    estimate,
    actual,
    gap,
    stages,
    path,
    gates: { requirement, plan, merge },
    ledger: ledgerFigures(ledger),
    filesChanged,
    tier: review.tier,
    loopMetricsRow: { missing: "only the close writes the loop-metrics row" },
  };
  return { measurement, ledger };
}

function itemOf(root: string, feature: string): Feature {
  const f = findFeature(root, feature);
  if (!f) throw new Error(`Unknown feature '${feature}'`);
  return f;
}

/** The measurement of an item, from its lifecycle log, ledger, review report and metadata; writes nothing. */
export function measureItem(root: string, feature: string): ItemMeasurement {
  return measure(itemOf(root, feature)).measurement;
}

/**
 * Measure the item and write `<item>/metrics.json`; first write its `.works/loop-metrics.md` row when the ledger is
 * one `kf loop-stats --record` accepts, and say in the measurement why not otherwise. Throws when the measurement
 * cannot be written; the close catches that and only warns.
 */
export function writeItemMetrics(root: string, feature: string): string {
  const f = itemOf(root, feature);
  const { measurement, ledger } = measure(f);
  const recordable = recordableRow(ledger);
  if (!recordable.ok) measurement.loopMetricsRow = { missing: recordable.reason };
  else {
    try {
      recordRow(root, f.name, recordable.stats, recordable.date);
      measurement.loopMetricsRow = { written: true };
    } catch (err) {
      if (!(err instanceof HistoryFileError)) throw err;
      // Its message names the history file by its full path; the measurement keeps it relative to the project.
      measurement.loopMetricsRow = { missing: `the loop history refused the row: ${err.message.split(`${root}/`).join("")}` };
    }
  }
  const path = join(f.dir, METRICS_FILE);
  writeFileAtomicSync(path, `${JSON.stringify(measurement, null, 2)}\n`);
  return path;
}

/** The synchronous twin of shared/paths.ts writeFileAtomic: a temp file in the same folder, renamed over the target. */
function writeFileAtomicSync(file: string, content: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { encoding: "utf8", flag: "wx", mode: existsSync(file) ? statSync(file).mode & 0o777 : 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

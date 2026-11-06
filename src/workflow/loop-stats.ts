import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The FR-014 ledger grammar, each shape matched against a line's body (the text before its ` @ <ts>` suffix). */
export const LEDGER_SHAPES = {
  dispatched: /^(TASK-\d+): (test-writer|developer|automation-writer|code-reviewer) dispatched model=(\S+)(?: round=(\d+))?(?: cascade=([0-9a-f]{7,40}))?$/,
  done: /^(TASK-\d+): (test-writer|developer|automation-writer|code-reviewer) done status=(\S+)$/,
  verifyStarted: /^(TASK-\d+): verify started$/,
  verifyDone: /^(TASK-\d+): verify done exit=(\d+)$/,
  developerWaits: /^(TASK-\d+): developer waits — (.+)$/,
  fixQueued: /^(TASK-\d+): fix queued — developer (TASK-\d+) in flight$/,
  fixRound: /^(TASK-\d+): fix round (\d+)\/5 \(.*\)$/,
  cascadeOwed: /^(TASK-\d+): cascade re-review owed — after ([0-9a-f]{7,40}) of (TASK-\d+)$/,
  complete: /^(TASK-\d+): complete \(.*\)$/,
} as const;

// `+hhmm` is accepted beside `+hh:mm`: the same instant, and a hand-written ledger drops the colon easily.
export const TS_SUFFIX = / @ (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))$/;

const SHAPE_KEYWORD = /^TASK-\d+: (test-writer|developer|automation-writer|code-reviewer|verify |fix queued|fix round|cascade re-review owed|complete)/;

/** A line that claims a shape behind a markdown bullet or indentation; it fails the grammar but must not pass as other-timed. */
const LOOSE_KEYWORD = /^\s*(?:[-*+]\s+)?TASK-\d+: (test-writer|developer|automation-writer|code-reviewer|verify |fix queued|fix round|cascade re-review owed|complete)/;

const REOPENED = /^Note (TASK-\d+): reopened — /;

/** An attempted timestamp that TS_SUFFIX rejects (a space for `T`, a missing seconds field, ...): such a line is not untimed. */
const STAMP_ATTEMPT = /@\s*\d{4}-\d{2}-\d{2}/;

/** Date.parse is only specified for `+hh:mm`; normalise `+hhmm` before parsing. */
const parseStamp = (stamp: string): number => Date.parse(stamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

export const SEATS = ["test-writer", "developer", "automation-writer", "code-reviewer"] as const;
export type Seat = (typeof SEATS)[number];
export type ShapeName = keyof typeof LEDGER_SHAPES;

export interface LedgerLine {
  /** 1-based line number in the ledger file. */
  line: number;
  kind: "shape" | "unparsed" | "other-timed" | "untimed";
  shape?: ShapeName;
  task?: string;
  /** Epoch ms (UTC) of the line's suffix. */
  ts?: number;
  /** The suffix timestamp as written, with its own offset. */
  stamp?: string;
  seat?: Seat;
  model?: string;
  round?: number;
  cascade?: string;
  status?: string;
  exit?: number;
  reason?: string;
  otherTask?: string;
  sha?: string;
  /** Set on a `Note TASK-NNN: reopened — …` line: it cancels the task's earlier `complete` line. */
  reopened?: boolean;
}

export interface ParsedLedger {
  lines: LedgerLine[];
}

function shapeFields(shape: ShapeName, m: RegExpExecArray): Partial<LedgerLine> {
  switch (shape) {
    case "dispatched":
      return {
        seat: m[2] as Seat,
        model: m[3],
        ...(m[4] !== undefined ? { round: Number(m[4]) } : {}),
        ...(m[5] !== undefined ? { cascade: m[5] } : {}),
      };
    case "done":
      return { seat: m[2] as Seat, status: m[3] };
    case "verifyDone":
      return { exit: Number(m[2]) };
    case "developerWaits":
      return { reason: m[2] };
    case "fixQueued":
      return { otherTask: m[2] };
    case "fixRound":
      return { round: Number(m[2]) };
    case "cascadeOwed":
      return { sha: m[2], otherTask: m[3] };
    case "verifyStarted":
    case "complete":
      return {};
  }
}

function classify(text: string, line: number): LedgerLine {
  const suffix = TS_SUFFIX.exec(text);
  if (!suffix) return { line, kind: LOOSE_KEYWORD.test(text) && STAMP_ATTEMPT.test(text) ? "unparsed" : "untimed" };
  const stamp = suffix[1];
  const ts = parseStamp(stamp);
  const body = text.slice(0, suffix.index);
  // Only one suffix is stripped; a claimed shape still carrying one fails it (an open shape such as developerWaits would otherwise absorb it).
  if (SHAPE_KEYWORD.test(body) && TS_SUFFIX.test(body)) return { line, kind: "unparsed", ts, stamp };
  for (const shape of Object.keys(LEDGER_SHAPES) as ShapeName[]) {
    const m = LEDGER_SHAPES[shape].exec(body);
    if (m) return { line, kind: "shape", shape, task: m[1], ts, stamp, ...shapeFields(shape, m) };
  }
  const reopened = REOPENED.exec(body);
  if (reopened) return { line, kind: "other-timed", task: reopened[1], reopened: true, ts, stamp };
  return { line, kind: LOOSE_KEYWORD.test(body) ? "unparsed" : "other-timed", ts, stamp };
}

/** Orphans no later open of the same seat or verify answers: a resume re-dispatches a lost seat, which leaves an honest orphan. */
export function unansweredOrphans(parsed: ParsedLedger, orphans: number[]): number[] {
  const key = (l: LedgerLine): string | null => (l.shape === "dispatched" ? `${l.task} ${l.seat}` : l.shape === "verifyStarted" ? `${l.task} verify` : null);
  return orphans.filter((n) => {
    const line = parsed.lines.find((l) => l.line === n);
    const own = line ? key(line) : null;
    return own === null || !parsed.lines.some((l) => l.line > n && key(l) === own);
  });
}

/** Tasks whose latest `complete` line no later `reopened` note cancels. */
export function completedTasks(parsed: ParsedLedger): Set<string> {
  const done = new Set<string>();
  for (const l of parsed.lines) {
    if (l.shape === "complete") done.add(l.task!);
    else if (l.reopened) done.delete(l.task!);
  }
  return done;
}

export interface LoggedRun {
  exit: number;
  ts: number;
}

const VERIFY_HEADER = /^## kf verify (\S+) exit=(\d+)$/;

export interface VerifyLog {
  /** The runs `kf verify` logged, oldest first. */
  runs: LoggedRun[];
  /** Set when the file opens with text a controller wrote under the earlier format: ledger lines before this time have no logged run. */
  handWrittenUntil?: number;
}

export function parseVerifyLog(text: string): VerifyLog {
  // Split on \n only: with the m flag, ^ also matches after a bare CR inside indented command output.
  const lines = text.split("\n");
  const first = lines.findIndex((l) => VERIFY_HEADER.test(l));
  const runs = lines.flatMap((l) => {
    const m = VERIFY_HEADER.exec(l);
    return m ? [{ ts: Date.parse(m[1]), exit: Number(m[2]) }] : [];
  });
  const leading = (first === -1 ? lines : lines.slice(0, first)).join("").trim();
  return leading === "" ? { runs } : { runs, handWrittenUntil: runs[0]?.ts ?? Infinity };
}

/** How far a `verify done` stamp may sit from its run: a background verify can report late. */
const VERIFY_STAMP_TOLERANCE_MS = 15 * 60_000;

/**
 * Check every `verify done` line against the runs `kf verify` logged. Each line takes the unclaimed run with its exit
 * code nearest its stamp: `unlogged` when there is none, so the line did not come from `kf verify`; `offClock` when that
 * run is far away. Logged runs a ledger omits are fine (a run can finish after its session died). Exit 3 ran nothing and
 * is not logged, and a line older than the log's first run under the earlier format has nothing to check against.
 */
export function checkVerifyLines(parsed: ParsedLedger, logOf: (task: string) => VerifyLog): { unlogged: number[]; offClock: number[] } {
  const unlogged: number[] = [];
  const offClock: number[] = [];
  const claimed = new Map<string, Set<number>>();
  for (const l of parsed.lines) {
    if (l.shape !== "verifyDone" || l.exit === 3) continue;
    const { runs, handWrittenUntil } = logOf(l.task!);
    if (handWrittenUntil !== undefined && l.ts! < handWrittenUntil) continue;
    const taken = claimed.get(l.task!) ?? new Set<number>();
    claimed.set(l.task!, taken);
    let best = -1;
    runs.forEach((run, i) => {
      if (run.exit !== l.exit || taken.has(i)) return;
      if (best === -1 || Math.abs(run.ts - l.ts!) < Math.abs(runs[best].ts - l.ts!)) best = i;
    });
    if (best === -1) {
      unlogged.push(l.line);
      continue;
    }
    taken.add(best);
    if (Math.abs(l.ts! - runs[best].ts) > VERIFY_STAMP_TOLERANCE_MS) offClock.push(l.line);
  }
  return { unlogged, offClock };
}

/** Margin for a coarse file clock: a stamp only counts as late past it. */
const LATE_STAMP_MARGIN_MS = 60_000;

/** Lines stamped after the ledger was last written, so the clock did not produce them. Best effort: a later write to the file hides them. */
export function lateStamps(parsed: ParsedLedger, writtenAt: number): number[] {
  return parsed.lines.filter((l) => l.ts !== undefined && l.ts > writtenAt + LATE_STAMP_MARGIN_MS).map((l) => l.line);
}

/** Classify every ledger line after the header; blank lines are skipped. */
export function parseLedger(text: string): ParsedLedger {
  const lines: LedgerLine[] = [];
  text.split("\n").forEach((raw, i) => {
    // Trailing whitespace (a stray space, a CR) carries no meaning; it must not hide the timestamp suffix.
    const content = raw.trimEnd();
    if (i === 0 || content.trim() === "") return;
    lines.push(classify(content, i + 1));
  });
  return { lines };
}

export interface SeatFigures {
  count: number;
  sum: number;
  median: number;
}

export interface LoopStats {
  inProgress: boolean;
  wallMinutes: number;
  seats: Record<Seat, SeatFigures>;
  verify: SeatFigures;
  seatMinutes: number;
  verifyMinutes: number;
  busyMinutes: number;
  savedMinutes: number;
  controllerMinutes: number;
  waitMinutes: number;
  rounds: number;
  cascades: number;
  /** Count of distinct tasks with a `dispatched` line. */
  tasks: number;
  byModel: Record<string, number>;
  unparsed: number[];
  orphans: number[];
  openWaits: number[];
  otherTimed: number;
  untimed: number;
  /** The largest number of developer seat intervals open at the same instant. */
  developersPeak: number;
  /** Minutes during which two or more developer intervals were open. */
  developerOverlapMinutes: number;
  dispatchLag: { developer: LagFigures; codeReviewer: LagFigures };
}

export interface LagFigures {
  median: number | null;
  max: number | null;
  n: number;
}

interface Interval {
  start: number;
  end: number;
}

const MINUTE = 60000;
const round1 = (x: number): number => Math.round(x * 10) / 10;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function figures(minutes: number[]): SeatFigures {
  return { count: minutes.length, sum: round1(sum(minutes)), median: round1(median(minutes)) };
}

function unionMs(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | null = null;
  for (const iv of sorted) {
    if (current && iv.start <= current.end) {
      current.end = Math.max(current.end, iv.end);
      continue;
    }
    if (current) total += current.end - current.start;
    current = { ...iv };
  }
  if (current) total += current.end - current.start;
  return total;
}

/** Sweep the intervals: the peak count open at once, and the ms with two or more open; an end at t and a start at t do not overlap. */
function concurrency(intervals: Interval[]): { peak: number; overlapMs: number } {
  const edges = intervals.flatMap((iv) => [{ at: iv.start, d: 1 }, { at: iv.end, d: -1 }]).sort((a, b) => a.at - b.at || a.d - b.d);
  let open = 0;
  let peak = 0;
  let overlapMs = 0;
  let prev = 0;
  for (const e of edges) {
    if (open >= 2) overlapMs += e.at - prev;
    open += e.d;
    peak = Math.max(peak, open);
    prev = e.at;
  }
  return { peak, overlapMs };
}

function lagFigures(lags: number[]): LagFigures {
  if (lags.length === 0) return { median: null, max: null, n: 0 };
  return { median: round1(median(lags)), max: round1(Math.max(...lags)), n: lags.length };
}

/**
 * Minutes from the latest gate line before each plain dispatch (no `round=`, no `cascade=`) of the seat
 * to the dispatch; a dispatch with no gate line is not counted. Only a task's first plain dispatch counts.
 */
function dispatchLags(shapes: LedgerLine[], seat: Seat, gatesOf: (d: LedgerLine, before: LedgerLine[]) => LedgerLine[]): number[] {
  const lags: number[] = [];
  const seen = new Set<string>();
  shapes.forEach((d, i) => {
    if (d.shape !== "dispatched" || d.seat !== seat || d.round !== undefined || d.cascade !== undefined) return;
    // A resume re-dispatches an in-flight seat; only the first plain dispatch of a task has a gate worth measuring.
    if (seen.has(d.task!)) return;
    seen.add(d.task!);
    const gates = gatesOf(d, shapes.slice(0, i)).filter((g) => g.ts! <= d.ts!);
    if (gates.length === 0) return;
    lags.push((d.ts! - Math.max(...gates.map((g) => g.ts!))) / MINUTE);
  });
  return lags;
}

const isDone = (l: LedgerLine, task: string, seat: Seat): boolean => l.shape === "done" && l.task === task && l.seat === seat;

/** The latest gate lines a developer dispatch could have waited on: its test-writer, its dependencies, the overlapping task, the cap. */
function developerGates(d: LedgerLine, before: LedgerLine[], deps: Record<string, string[]> | undefined): LedgerLine[] {
  const gates = before.filter((l) => isDone(l, d.task!, "test-writer"));
  for (const dep of deps?.[d.task!] ?? []) gates.push(...before.filter((l) => isDone(l, dep, "developer")));
  for (const wait of before.filter((l) => l.shape === "developerWaits" && l.task === d.task)) {
    const after = before.slice(before.indexOf(wait) + 1);
    const overlap = /\((TASK-\d+)\)$/.exec(wait.reason!);
    if (overlap) gates.push(...after.filter((l) => l.shape === "complete" && l.task === overlap[1]));
    else if (/^\d+ developers in flight/.test(wait.reason!)) {
      const first = after.find((l) => l.shape === "done" && l.seat === "developer");
      if (first) gates.push(first);
    }
  }
  return gates;
}

/**
 * Pair each closing line with the latest still-open opening line of the same key before it. A close
 * with no open line, and a pair whose close is earlier than its open, go to `unparsed`; opens still
 * waiting at the end go to `orphans`.
 */
function pairLines(
  lines: LedgerLine[],
  isOpen: (l: LedgerLine) => boolean,
  isClose: (l: LedgerLine) => boolean,
  key: (l: LedgerLine) => string,
  unparsed: number[],
  orphans: number[],
): { open: LedgerLine; close: LedgerLine }[] {
  const stacks = new Map<string, LedgerLine[]>();
  const pairs: { open: LedgerLine; close: LedgerLine }[] = [];
  for (const l of lines) {
    if (isOpen(l)) {
      const stack = stacks.get(key(l)) ?? [];
      stack.push(l);
      stacks.set(key(l), stack);
    } else if (isClose(l)) {
      const open = stacks.get(key(l))?.pop();
      if (!open) unparsed.push(l.line);
      else if (l.ts! < open.ts!) unparsed.push(open.line, l.line);
      else pairs.push({ open, close: l });
    }
  }
  for (const stack of stacks.values()) orphans.push(...stack.map((l) => l.line));
  return pairs;
}

/** Every FR-012 figure of a parsed ledger; minutes are exact until rounded to one decimal here. */
export function loopStats(parsed: ParsedLedger, deps?: Record<string, string[]>): LoopStats {
  const shapes = parsed.lines.filter((l) => l.kind === "shape");
  const of = (shape: ShapeName): LedgerLine[] => shapes.filter((l) => l.shape === shape);
  const unparsed = parsed.lines.filter((l) => l.kind === "unparsed").map((l) => l.line);
  const orphans: number[] = [];

  const seatPairs = pairLines(
    shapes,
    (l) => l.shape === "dispatched",
    (l) => l.shape === "done",
    (l) => `${l.task}\u0000${l.seat}`,
    unparsed,
    orphans,
  );
  const verifyPairs = pairLines(
    shapes,
    (l) => l.shape === "verifyStarted",
    (l) => l.shape === "verifyDone",
    (l) => l.task!,
    unparsed,
    orphans,
  );

  const seatIntervals = seatPairs.map(({ open, close }) => ({ seat: open.seat!, model: open.model!, start: open.ts!, end: close.ts! }));
  const verifyIntervals = verifyPairs.map(({ open, close }) => ({ start: open.ts!, end: close.ts! }));
  const minutesOf = (iv: Interval): number => (iv.end - iv.start) / MINUTE;

  const seats = Object.fromEntries(
    SEATS.map((seat) => [seat, figures(seatIntervals.filter((iv) => iv.seat === seat).map(minutesOf))]),
  ) as Record<Seat, SeatFigures>;
  const byModelExact: Record<string, number> = {};
  for (const iv of seatIntervals) {
    const key = `${iv.seat}/${iv.model}`;
    byModelExact[key] = (byModelExact[key] ?? 0) + minutesOf(iv);
  }

  const dispatched = of("dispatched");
  const taskIds = new Set(dispatched.map((l) => l.task!));
  const completes = of("complete");
  const completed = completedTasks(parsed);
  const inProgress = [...taskIds].some((t) => !completed.has(t));

  const timed = parsed.lines.filter((l) => l.ts !== undefined).map((l) => l.ts!);
  let wallMs = 0;
  if (dispatched.length > 0) {
    const start = Math.min(...dispatched.map((l) => l.ts!));
    const end = inProgress || completes.length === 0 ? Math.max(...timed) : Math.max(...completes.map((l) => l.ts!));
    wallMs = end - start;
  }

  const openWaits: number[] = [];
  let waitMs = 0;
  shapes.forEach((l, i) => {
    if (l.shape !== "developerWaits" && l.shape !== "fixQueued") return;
    const next = shapes.slice(i + 1).find((n) => n.shape === "dispatched" && n.task === l.task && n.seat === "developer");
    if (!next) openWaits.push(l.line);
    else if (next.ts! < l.ts!) unparsed.push(l.line, next.line);
    else waitMs += next.ts! - l.ts!;
  });

  const developerIntervals = seatIntervals.filter((iv) => iv.seat === "developer");
  const { peak, overlapMs } = concurrency(developerIntervals);
  const dispatchLag = {
    developer: lagFigures(dispatchLags(shapes, "developer", (d, before) => developerGates(d, before, deps))),
    codeReviewer: lagFigures(
      dispatchLags(shapes, "code-reviewer", (d, before) => before.filter((l) => isDone(l, d.task!, "developer") || isDone(l, d.task!, "automation-writer"))),
    ),
  };

  const seatMs = sum(seatIntervals.map((iv) => iv.end - iv.start));
  const verifyMs = sum(verifyIntervals.map((iv) => iv.end - iv.start));
  const busyMs = unionMs([...seatIntervals, ...verifyIntervals]);

  return {
    inProgress,
    wallMinutes: round1(wallMs / MINUTE),
    seats,
    verify: figures(verifyIntervals.map(minutesOf)),
    seatMinutes: round1(seatMs / MINUTE),
    verifyMinutes: round1(verifyMs / MINUTE),
    busyMinutes: round1(busyMs / MINUTE),
    savedMinutes: round1((seatMs + verifyMs - busyMs) / MINUTE),
    controllerMinutes: round1((wallMs - busyMs) / MINUTE),
    waitMinutes: round1(waitMs / MINUTE),
    rounds: of("fixRound").length,
    cascades: of("cascadeOwed").length,
    tasks: taskIds.size,
    byModel: Object.fromEntries(Object.entries(byModelExact).map(([k, v]) => [k, round1(v)])),
    unparsed: [...new Set(unparsed)].sort((a, b) => a - b),
    orphans: orphans.sort((a, b) => a - b),
    openWaits,
    otherTimed: parsed.lines.filter((l) => l.kind === "other-timed").length,
    untimed: parsed.lines.filter((l) => l.kind === "untimed").length,
    developersPeak: peak,
    developerOverlapMinutes: round1(overlapMs / MINUTE),
    dispatchLag,
  };
}

export const HEADER = "date · feature · tasks · wall · busy · controller · saved · waits · test-writer · developer · automation-writer · code-reviewer · verify · rounds · cascades · untimed";
const COLUMNS = HEADER.split(" · ");
const TEXT_COLUMNS = new Set(["date", "feature"]);
export const NUMERIC_COLUMNS = COLUMNS.filter((c) => !TEXT_COLUMNS.has(c));

export type HistoryRow = Record<string, string | number>;

/** The history file cannot be used as it is (another header, or a malformed row); nothing is written. */
export class HistoryFileError extends Error {}

export const historyPath = (root: string): string => join(root, ".works", "loop-metrics.md");

function historyLines(path: string): string[] {
  const lines = readFileSync(path, "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines[0] !== HEADER) {
    throw new HistoryFileError(`${path} has a different header than the current one:\n  ${HEADER}\nmove it aside or update its header and rows by hand`);
  }
  return lines.slice(1).filter((l) => l.trim() !== "");
}

/** The item's history row; minutes as integers, seat and verify columns their sum minutes. */
export function historyRow(feature: string, stats: LoopStats, date: string): string {
  const values = [
    date,
    feature,
    stats.tasks,
    stats.wallMinutes,
    stats.busyMinutes,
    stats.controllerMinutes,
    stats.savedMinutes,
    stats.waitMinutes,
    ...SEATS.map((s) => stats.seats[s].sum),
    stats.verify.sum,
    stats.rounds,
    stats.cascades,
    stats.untimed,
  ];
  return values.map((v) => (typeof v === "number" ? String(Math.round(v)) : v)).join(" · ");
}

/** Write the item's row to `.works/loop-metrics.md`, replacing its earlier row; returns the file path. */
export function recordRow(root: string, feature: string, stats: LoopStats, date: string): string {
  const path = historyPath(root);
  const lock = `${path}.lock`;
  try {
    closeSync(openSync(lock, "wx"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new HistoryFileError(`${lock} exists: another kf loop-stats --record is running; retry, or delete the lock when none is`);
    }
    throw err;
  }
  try {
    const rows = existsSync(path) ? historyLines(path) : [];
    const row = historyRow(feature, stats, date);
    const at = rows.findIndex((r) => r.split(" · ")[1] === feature);
    if (at >= 0) rows[at] = row;
    else rows.push(row);
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, `${[HEADER, ...rows].join("\n")}\n`);
      renameSync(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    return path;
  } finally {
    unlinkSync(lock);
  }
}

/** The history rows keyed by column name, or `null` when no loop was recorded yet. */
export function readHistory(root: string): HistoryRow[] | null {
  const path = historyPath(root);
  if (!existsSync(path)) return null;
  return historyLines(path).map((text, i) => {
    const fields = text.split(" · ");
    if (fields.length !== COLUMNS.length) {
      throw new HistoryFileError(`${path}:${i + 2}: expected ${COLUMNS.length} fields, found ${fields.length}`);
    }
    const row: HistoryRow = {};
    COLUMNS.forEach((col, c) => {
      if (TEXT_COLUMNS.has(col)) {
        row[col] = fields[c];
        return;
      }
      const n = Number(fields[c]);
      if (fields[c].trim() === "" || !Number.isFinite(n)) {
        throw new HistoryFileError(`${path}:${i + 2}: column ${col} is not a number: '${fields[c]}'`);
      }
      row[col] = n;
    });
    return row;
  });
}

export const PER_TASK_BUCKETS = ["controller", "test-writer", "developer", "code-reviewer", "verify", "waits"] as const;
export type Bucket = (typeof PER_TASK_BUCKETS)[number];

export interface HistorySummary {
  medians: Record<string, number>;
  perTask: Record<Bucket, number>;
  largest: { bucket: Bucket; minutesPerTask: number };
}

/** Column medians, median minutes per task of each bucket, and the bucket with the biggest one. */
export function summarise(rows: HistoryRow[]): HistorySummary {
  const medians = Object.fromEntries(NUMERIC_COLUMNS.map((c) => [c, round1(median(rows.map((r) => r[c] as number)))]));
  const counted = rows.filter((r) => (r.tasks as number) > 0);
  const perTask = Object.fromEntries(
    PER_TASK_BUCKETS.map((b) => [b, round1(median(counted.map((r) => (r[b] as number) / (r.tasks as number))))]),
  ) as Record<Bucket, number>;
  let largest: Bucket = PER_TASK_BUCKETS[0];
  for (const b of PER_TASK_BUCKETS) if (perTask[b] > perTask[largest]) largest = b;
  return { medians, perTask, largest: { bucket: largest, minutesPerTask: perTask[largest] } };
}

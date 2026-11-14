import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { filesOverlap } from "./allowlist.js";

/*
 * The harness estimation model, ported from the travel `estimates` script: T-shirt sizes, points, the learned
 * minutes factor, the statistics lines and the overlap verdict. History merges the legacy travel ledger
 * (.kf/travel/estimates.md) with the metrics.json of each done item.
 */

export type Size = "S" | "M" | "L" | "XL";

export const SIZES: readonly Size[] = ["S", "M", "L", "XL"];
export const POINTS: Record<Size, number> = { S: 1, M: 2, L: 4, XL: 8 };
export const KINDS = ["feature", "bug", "pr"] as const;

const HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin";
const FIELDS = HEADER.split(" · ");
// Rows written before estmin existed end at gap; they are kept but teach nothing.
const OLD_HEADER = FIELDS.slice(0, -1).join(" · ");
const SEP = " · ";
const LEARN_FLOOR = 20;
// About two weeks of rows at a few items a day: recent enough to follow a change in agent speed, and the median of
// that many ratios is not moved by one stuck run.
const LEARN_WINDOW = 30;
// The default minute bands grow about ×3–4 (5 → 20 → 60), so ×3 moves an estimate up at most about one size.
// Downward is capped tighter because an estimate shrunk too far overfills the day's budget.
const FACTOR_MIN = 0.5;
const FACTOR_MAX = 3;
const DEFAULT_TASKS = 10;
const MIN_DAYS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One measured item of the history; unmeasured items (actual `-`, or a missing actual) are left out. */
export interface HistoryRow {
  /** YYYY-MM-DD: the ledger date, or the close date of a done item. */
  date: string;
  id: string;
  feature: string;
  kind: string;
  /** The estimated size; null when the item recorded no estimate. */
  est: Size | null;
  actual: Size;
  workMinutes: number;
  files: number | null;
  /** The estimate in minutes; null for rows written without one. */
  estMinutes: number | null;
}

/** The history cannot be read: a malformed legacy row or metrics.json, named by file (and line). */
export class EstimateHistoryError extends Error {}

export interface Factor {
  usable: number;
  factor: number;
  raw: number | null;
  window: number;
}

/** DATE_RE alone lets 2026-13-40 through. */
function realDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function isSize(s: unknown): s is Size {
  return typeof s === "string" && (SIZES as readonly string[]).includes(s);
}

// Inclusive upper bounds per size; S minutes is strict (< 5).
const RULE: Record<"S" | "M" | "L", { minutes: (m: number) => boolean; files: (f: number) => boolean }> = {
  S: { minutes: (m) => m < 5, files: (f) => f <= 3 },
  M: { minutes: (m) => m <= 20, files: (f) => f <= 10 },
  L: { minutes: (m) => m <= 60, files: (f) => f <= 30 },
};

function sizeBy(test: "minutes" | "files", value: number): Size {
  for (const s of ["S", "M", "L"] as const) if (RULE[s][test](value)) return s;
  return "XL";
}

/** The higher of the minutes size and the files size; an unknown file count sizes from the minutes alone. */
export function sizeOf(minutes: number, files: number | null): Size {
  const byMinutes = sizeBy("minutes", minutes);
  if (files === null) return byMinutes;
  const byFiles = sizeBy("files", files);
  return SIZES.indexOf(byMinutes) >= SIZES.indexOf(byFiles) ? byMinutes : byFiles;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmt2(n: number): string {
  return String(Number(n.toFixed(2)));
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

/**
 * The minutes correction for one kind: the median of work ÷ estmin over its last 30 rows with an estimate in minutes.
 * Its inputs are the raw estimate and the measured work, never the factor, so the factor cannot feed on itself.
 */
export function factorFor(rows: HistoryRow[], kind: string): Factor {
  const usable = rows.filter((r) => r.kind === kind && r.estMinutes !== null);
  if (usable.length < LEARN_FLOOR) return { usable: usable.length, factor: 1, raw: null, window: 0 };
  const window = usable.slice(-LEARN_WINDOW);
  const raw = median(window.map((r) => r.workMinutes / (r.estMinutes as number)));
  return { usable: usable.length, factor: Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw)), raw, window: window.length };
}

function factorText(f: Factor): string {
  return f.factor === f.raw ? fmt2(f.factor) : `${fmt2(f.factor)} (clamped from ${fmt2(f.raw as number)})`;
}

function pointsLine(size: Size): string {
  return `points: ${POINTS[size]}${size === "XL" ? " (should split)" : ""}`;
}

/** The size, points and defaults lines without history (the script's 2-argument `size`). */
export function defaultSizeLines(minutes: number, files: number | null): string[] {
  const size = sizeOf(minutes, files);
  return [size, pointsLine(size), "defaults (0 rows measured)"];
}

/** The size, points and defaults/learned lines against the history of one kind (the script's 4-argument `size`). */
export function sizeLines(minutes: number, files: number | null, rows: HistoryRow[], kind: string): string[] {
  const f = factorFor(rows, kind);
  let corrected = minutes;
  let text: string;
  if (f.raw === null) text = `defaults (${f.usable} ${kind} rows with estmin)`;
  else {
    corrected = minutes * f.factor;
    text = `learned: ${fmt(minutes)} min × ${factorText(f)} = ${fmt(corrected)} min (${kind}, last ${f.window} rows)`;
  }
  // The files size is never corrected: the factor only learns minutes.
  const size = sizeOf(corrected, files);
  return [size, pointsLine(size), text];
}

function hits(rows: HistoryRow[]): number {
  return rows.filter((r) => r.est === r.actual).length;
}

/** Budget, hit rate, bias, throughput, calibration, per-kind lines and the week-over-week warning. */
export function statsLines(rows: HistoryRow[]): string[] {
  // A row without an estimate counts toward budget and throughput, never toward hit rate and bias.
  const estimated = rows.filter((r) => r.est !== null);
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + POINTS[r.actual]);
  const days = [...byDay.keys()].sort();
  const totals = days.map((d) => byDay.get(d) as number);
  const total = totals.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  if (days.length >= MIN_DAYS) out.push(`budget: ${fmt(median(totals))} points (median of ${days.length} days)`);
  else out.push(`budget: ${DEFAULT_TASKS} tasks (default — fewer than ${MIN_DAYS} days measured)`);
  out.push(`hit rate: ${hits(estimated)}/${estimated.length}`);
  const index = (s: Size | null): number => SIZES.indexOf(s as Size);
  const over = estimated.filter((r) => index(r.est) > index(r.actual)).length;
  const under = estimated.filter((r) => index(r.est) < index(r.actual)).length;
  out.push(`bias: ${over} over, ${under} under`);
  out.push(`throughput: ${total} points / ${days.length} days`);
  out.push(days.length >= MIN_DAYS
    ? `calibration: budget = median daily actual points of ${days.map((d) => `${d} (${byDay.get(d)})`).join(", ")}`
    : "calibration: none yet");
  const kinds = [...new Set(estimated.map((r) => r.kind))].sort();
  for (const k of kinds) {
    const same = estimated.filter((r) => r.kind === k);
    const bias = same.reduce((a, r) => a + index(r.actual) - index(r.est), 0) / same.length;
    const f = factorFor(rows, k);
    const factor = f.raw === null ? `factor 1 (defaults — ${f.usable} rows with estmin, needs ${LEARN_FLOOR})`
      : `factor ${factorText(f)} (median of last ${f.window} rows)`;
    out.push(`kind ${k}: hit rate ${hits(same)}/${same.length}, bias ${bias > 0 ? "+" : ""}${bias.toFixed(1)} sizes, ${factor}`);
  }
  if (days.length > 0) {
    const last = dayNumber(days[days.length - 1]);
    const thisWeek = estimated.filter((r) => last - dayNumber(r.date) <= 6);
    const lastWeek = estimated.filter((r) => { const age = last - dayNumber(r.date); return age >= 7 && age <= 13; });
    if (thisWeek.length > 0 && lastWeek.length > 0 && hits(thisWeek) / thisWeek.length < hits(lastWeek) / lastWeek.length) {
      out.push(`warning: hit rate fell — this week ${hits(thisWeek)}/${thisWeek.length}, last week ${hits(lastWeek)}/${lastWeek.length}`);
    }
  }
  return out;
}

/** A comma-separated plan `Files` cell; an empty cell means unknown files. */
function filesCell(raw: string): string[] | null {
  const list = raw.split(",").map((s) => s.replace(/`/g, "").trim()).filter((s) => s !== "");
  return list.length === 0 ? null : list;
}

/** `sequential` when two plan `Files` cells may touch the same file (unknown files always may), else `parallel`. */
export function overlapVerdict(a: string, b: string): "sequential" | "parallel" {
  return filesOverlap(filesCell(a), filesCell(b)) ? "sequential" : "parallel";
}

function rowNumber(where: string, name: string, raw: string | undefined, integer: boolean): number {
  if (raw === undefined || raw === "" || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new EstimateHistoryError(`${where}: ${name} must be a non-negative number: ${raw ?? "(missing)"}`);
  }
  const n = Number(raw);
  if (integer && !Number.isInteger(n)) throw new EstimateHistoryError(`${where}: ${name} must be a whole number: ${raw}`);
  return n;
}

function parseLegacy(text: string, file: string): HistoryRow[] {
  const rows: HistoryRow[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed === HEADER || trimmed === OLD_HEADER) return;
    const where = `${file}:${i + 1}`;
    const cells = line.split(SEP).map((c) => c.trim());
    if (cells.length !== FIELDS.length && cells.length !== FIELDS.length - 1) {
      throw new EstimateHistoryError(`${where}: expected ${FIELDS.length} fields (${HEADER}), or ${FIELDS.length - 1} without estmin, got ${cells.length}`);
    }
    const cell = Object.fromEntries(FIELDS.map((f, k) => [f, cells[k]])) as Record<string, string | undefined>;
    const date = cell.date as string;
    if (!realDate(date)) throw new EstimateHistoryError(`${where}: date must be a real YYYY-MM-DD day: ${date}`);
    if (!isSize(cell.est)) throw new EstimateHistoryError(`${where}: est must be S|M|L|XL: ${cell.est}`);
    if (cell.actual !== "-" && !isSize(cell.actual)) throw new EstimateHistoryError(`${where}: actual must be S|M|L|XL or -: ${cell.actual}`);
    const measured = isSize(cell.actual);
    const workMinutes = measured ? rowNumber(where, "work", cell.work, false) : 0;
    const files = measured ? rowNumber(where, "files", cell.files, true) : 0;
    let estMinutes: number | null = null;
    if (cell.estmin !== undefined) {
      estMinutes = rowNumber(where, "estmin", cell.estmin, false);
      if (estMinutes === 0) throw new EstimateHistoryError(`${where}: estmin must be above 0: ${cell.estmin}`);
    }
    // A cancelled row (actual `-`) is checked but left out: it measured nothing.
    if (!isSize(cell.actual)) return;
    rows.push({
      date, id: cell.id as string, feature: cell.feature as string, kind: cell.kind as string,
      est: cell.est, actual: cell.actual, workMinutes, files, estMinutes,
    });
  });
  return rows;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** One done item's metrics.json as a history row and its close stamp; null when it has no actual size (left out like actual `-`). */
function metricsRow(file: string): { closedAt: string; row: HistoryRow } | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new EstimateHistoryError(`${file}: not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  const bad = (what: string): never => { throw new EstimateHistoryError(`${file}: ${what}`); };
  if (!isObject(data)) return bad("expected a JSON object");
  const { closedAt, id, feature, kind, estimate, actual, filesChanged } = data;
  if (typeof closedAt !== "string" || !realDate(closedAt.slice(0, 10))) return bad(`closedAt must start with a real YYYY-MM-DD day: ${String(closedAt)}`);
  if (typeof id !== "string" || typeof feature !== "string" || typeof kind !== "string") return bad("id, feature and kind must be strings");
  if (!isObject(actual)) return bad("actual must be { size, workMinutes } or { missing }");
  if (actual.missing !== undefined) return null;
  if (!isSize(actual.size) || !isNonNegative(actual.workMinutes)) return bad("actual must be { size: S|M|L|XL, workMinutes: number } or { missing }");
  let est: Size | null = null;
  let estMinutes: number | null = null;
  if (!isObject(estimate)) return bad("estimate must be { minutes, size } or { none: true }");
  if (estimate.none !== true) {
    if (!isSize(estimate.size) || !isPositive(estimate.minutes)) return bad("estimate must be { minutes: number above 0, size: S|M|L|XL } or { none: true }");
    est = estimate.size;
    estMinutes = estimate.minutes;
  }
  const files = isObject(filesChanged) && isNonNegative(filesChanged.count) ? filesChanged.count : null;
  return { closedAt, row: { date: closedAt.slice(0, 10), id, feature, kind, est, actual: actual.size, workMinutes: actual.workMinutes, files, estMinutes } };
}

function doneRows(root: string): HistoryRow[] {
  const done = join(root, ".works", "done");
  if (!existsSync(done)) return [];
  const found: Array<{ closedAt: string; row: HistoryRow }> = [];
  for (const entry of readdirSync(done, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(done, entry.name, "metrics.json");
    if (!existsSync(file)) continue;
    const measured = metricsRow(file);
    if (measured !== null) found.push(measured);
  }
  return found.sort((a, b) => a.closedAt.localeCompare(b.closedAt)).map((f) => f.row);
}

export const legacyEstimatesPath = (root: string): string => join(root, ".kf", "travel", "estimates.md");

/** The measured history: legacy ledger rows and done items' metrics, by date, legacy rows first on the same day. */
export function readEstimateHistory(root: string): HistoryRow[] {
  const file = legacyEstimatesPath(root);
  const legacy = existsSync(file) ? parseLegacy(readFileSync(file, "utf8"), file) : [];
  // Array.prototype.sort is stable, so legacy rows stay ahead of done rows on a tie.
  return [...legacy, ...doneRows(root)].sort((a, b) => a.date.localeCompare(b.date));
}

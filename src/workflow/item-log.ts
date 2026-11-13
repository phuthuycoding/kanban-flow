import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { detectReviewer } from "../shared/actor.js";
import { machineId } from "../shared/machine.js";
import { STAGES, type Stage } from "./schema.js";
// Types only: features.ts imports this module at runtime, so a runtime import back would be a cycle.
import type { FeatureMeta } from "./features.js";

/** The item's lifecycle log: one JSON record per line, at the item folder root, only ever appended to. */
export const ITEM_LOG_FILE = "lifecycle.jsonl";

export const ITEM_EVENTS = [
  "created", "opened", "reconciled", "stage", "approved", "approval-restored",
  "cancelled", "waiver", "linked", "delivered", "docs",
] as const;
export type ItemEvent = (typeof ITEM_EVENTS)[number];

/** Which machine wrote a record. `machine` is a random id kept under ~/.kf, never a host name. */
export interface ItemOrigin {
  machine: string;
  via: "cli";
}

export interface ItemRecord {
  v: 1;
  at: string;
  actor: string;
  origin: ItemOrigin;
  event: ItemEvent;
  /** The stage before, on a record that changes the stage. The fold does not read it. */
  from?: Stage;
  /** The stage after this record, when the record states or changes it. */
  stage?: Stage;
  /** Shared metadata fields with the whole value each has after this record. */
  set?: Record<string, unknown>;
  /** Shared metadata fields this record removed. */
  unset?: string[];
  /** Set on `opened` and `reconciled`: the record was derived from the snapshot, not written by the change itself. */
  derived?: true;
}

/** An item's metadata without its machine-local part. */
export type SharedMeta = Omit<FeatureMeta, "worktree">;

export interface ItemState {
  stage: Stage;
  meta: SharedMeta;
}

export type FoldResult =
  | { ok: true; state: ItemState | null; records: number }
  | { ok: false; line: number; reason: string };

/**
 * Every metadata field that travels with the item. Typed against FeatureMeta so a field added
 * there without a decision here fails the typecheck: `worktree` is the one field left out.
 */
const SHARED_KEYS = Object.keys({
  schema: true, feature: true, context: true, created: true, kind: true, goal: true, issue: true, pr: true,
  delivered: true, deliveredAt: true, docsBranch: true, docsCommit: true, docsLanded: true, approval: true,
  executionId: true, status: true, cancellation: true, bypasses: true, verifyWaiver: true, ship: true, id: true,
} satisfies Record<keyof SharedMeta, true>);
const SHARED_KEY_SET: ReadonlySet<string> = new Set(SHARED_KEYS);

export function itemLogPath(dir: string): string {
  return join(dir, ITEM_LOG_FILE);
}

const HOOK_CODE = "hook:";

/**
 * A skipped hook is recorded in `.kfw.json` by its absolute path, which names the project or the
 * home directory. The log keeps the hook's file name and drops the directory: which hook was
 * skipped travels with the item, where it sat on one machine does not.
 */
function withoutHookDirs(bypasses: unknown): unknown {
  if (!Array.isArray(bypasses)) return bypasses;
  return bypasses.map((bypass: unknown) => {
    if (!isPlainObject(bypass) || bypass.flag !== "skip-hooks" || !Array.isArray(bypass.codes)) return bypass;
    return {
      ...bypass,
      codes: bypass.codes.map((code: unknown) =>
        typeof code === "string" && code.startsWith(HOOK_CODE)
          ? `${HOOK_CODE}${code.slice(HOOK_CODE.length).split(/[\\/]/).pop()}`
          : code),
    };
  });
}

/**
 * The shared part of a metadata object: `worktree`, legacy run-state keys and unknown keys are
 * dropped, and a skipped hook keeps only its file name. The input is never changed.
 */
export function sharedMeta(meta: object): SharedMeta {
  const source = meta as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SHARED_KEYS) {
    if (source[key] !== undefined) out[key] = key === "bypasses" ? withoutHookDirs(source[key]) : source[key];
  }
  return out as unknown as SharedMeta;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality of JSON values; the key order of objects does not count. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    const other = Object.keys(b).filter((k) => b[k] !== undefined);
    return keys.length === other.length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
  }
  return false;
}

/** What turns `before` into `after`: each changed field with its whole new value, and the fields that went away. */
export function diffShared(before: SharedMeta | null, after: SharedMeta): { set: Record<string, unknown>; unset: string[] } {
  const from = (before ?? {}) as Record<string, unknown>;
  const to = after as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(to)) {
    if (to[key] !== undefined && !sameValue(from[key], to[key])) set[key] = to[key];
  }
  const unset = Object.keys(from).filter((key) => from[key] !== undefined && to[key] === undefined).sort();
  return { set, unset };
}

function recordProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return "not a JSON object";
  if (value.v !== 1) return "unknown record version";
  if (typeof value.at !== "string") return "no time";
  if (typeof value.event !== "string" || !(ITEM_EVENTS as readonly string[]).includes(value.event)) return "unknown event";
  if (value.stage !== undefined && !(STAGES as readonly string[]).includes(value.stage as string)) return "unknown stage";
  if (value.set !== undefined && !isPlainObject(value.set)) return "set is not an object";
  if (value.unset !== undefined && !(Array.isArray(value.unset) && value.unset.every((k) => typeof k === "string"))) return "unset is not a list of names";
  return null;
}

/**
 * Fold a log into the stage and shared metadata it describes. One unreadable line refuses the whole
 * log: a state rebuilt around a gap would be presented as the item's history.
 */
export function foldItemLog(text: string): FoldResult {
  let stage: Stage | null = null;
  const meta: Record<string, unknown> = {};
  let records = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { ok: false, line: i + 1, reason: "not JSON" };
    }
    const problem = recordProblem(parsed);
    if (problem) return { ok: false, line: i + 1, reason: problem };
    const record = parsed as ItemRecord;
    if (record.stage !== undefined) stage = record.stage;
    if (stage === null) return { ok: false, line: i + 1, reason: "the first record names no stage" };
    // Only the shared keys: a replicated log is read by programs that did not write it (#184), so a
    // `__proto__`, `worktree` or unknown key in a record changes nothing.
    for (const [key, value] of Object.entries(record.set ?? {})) if (SHARED_KEY_SET.has(key)) meta[key] = value;
    for (const key of record.unset ?? []) if (SHARED_KEY_SET.has(key)) delete meta[key];
    records += 1;
  }
  return { ok: true, state: stage === null ? null : { stage, meta: meta as unknown as SharedMeta }, records };
}

/** The fold of the item's log; an item with no log file has no state. */
export function readItemLog(dir: string): FoldResult {
  const path = itemLogPath(dir);
  if (!existsSync(path)) return { ok: true, state: null, records: 0 };
  return foldItemLog(readFileSync(path, "utf8"));
}

/** The id the item's log already holds, or undefined when there is no readable log or it names none. */
function loggedId(dir: string): string | undefined {
  try {
    const fold = readItemLog(dir);
    const id = fold.ok ? fold.state?.meta.id : undefined;
    return typeof id === "string" ? id : undefined;
  } catch {
    // An unreadable log path is reported by the write that follows; here it only means no id to reuse.
    return undefined;
  }
}

/**
 * The metadata with an id: the same object when it has one. Otherwise a copy with the id the item's
 * log already holds, when `dir` is given and the log names one — an id is generated once, so a
 * `.kfw.json` that lost it gets the same one back — or else with a new uuid.
 */
export function withItemId<T extends FeatureMeta>(meta: T, dir?: string): T {
  if (typeof meta.id === "string") return meta;
  return { ...meta, id: (dir === undefined ? undefined : loggedId(dir)) ?? randomUUID() };
}

type RecordBody = Pick<ItemRecord, "event" | "from" | "stage" | "set" | "unset" | "derived">;

function append(root: string, dir: string, body: RecordBody): void {
  const record: ItemRecord = {
    v: 1,
    at: new Date().toISOString(),
    actor: detectReviewer(root),
    origin: { machine: machineId(), via: "cli" },
    event: body.event,
    ...(body.from !== undefined ? { from: body.from } : {}),
    ...(body.stage !== undefined ? { stage: body.stage } : {}),
    ...(body.set && Object.keys(body.set).length > 0 ? { set: body.set } : {}),
    ...(body.unset && body.unset.length > 0 ? { unset: body.unset } : {}),
    ...(body.derived ? { derived: true as const } : {}),
  };
  const path = itemLogPath(dir);
  // A log cut short by a crash has no final newline; the new record must still start its own line.
  const gap = existsSync(path) && !readFileSync(path, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(path, `${gap}${JSON.stringify(record)}\n`);
}

class UnreadableLog extends Error {}

/** The log's state, or a throw the callers turn into the one warning: an unparsable log is never appended to. */
function readState(dir: string): ItemState | null {
  const fold = readItemLog(dir);
  if (!fold.ok) throw new UnreadableLog(`line ${fold.line} is unreadable (${fold.reason})`);
  return fold.state;
}

/** Append `opened` (no log yet) or `reconciled` (the log is behind) so the log folds to `current`. */
function catchUp(root: string, dir: string, state: ItemState | null, current: ItemState): void {
  if (state === null) {
    append(root, dir, { event: "opened", stage: current.stage, set: diffShared(null, current.meta).set, derived: true });
    return;
  }
  const diff = diffShared(state.meta, current.meta);
  const moved = state.stage !== current.stage;
  if (!moved && Object.keys(diff.set).length === 0 && diff.unset.length === 0) return;
  append(root, dir, { event: "reconciled", ...(moved ? { stage: current.stage } : {}), ...diff, derived: true });
}

/** Callers may hand over whole metadata: only its shared part is ever compared or written. */
function shared(state: ItemState): ItemState {
  return { stage: state.stage, meta: sharedMeta(state.meta) };
}

function warn(name: string, dir: string, err: unknown): void {
  process.stderr.write(`⚠ lifecycle log not written for '${name}': ${itemLogPath(dir)}: ${err instanceof Error ? err.message : String(err)}\n`);
}

/**
 * Bring the item's log up to date with `current`. Never throws: the log must not change the result of
 * the command that calls this, so a failure is one warning and the next write catches up.
 */
export function syncItemLog(root: string, dir: string, name: string, current: ItemState): void {
  try {
    catchUp(root, dir, readState(dir), shared(current));
  } catch (err) {
    warn(name, dir, err);
  }
}

/**
 * Record one lifecycle change. `before` is the item as it was before the change, read inside the item
 * lock, or null for a new item; `after` is the item as it is now. The log is first brought up to date
 * with `before`, then gains the event's record when anything shared changed. Never throws.
 */
export function recordChange(root: string, dir: string, name: string, event: ItemEvent, before: ItemState | null, after: ItemState): void {
  try {
    const state = readState(dir);
    after = shared(after);
    if (before === null) {
      append(root, dir, { event, stage: after.stage, set: diffShared(null, after.meta).set });
      return;
    }
    // An item that had no id gets it with this change: the id belongs to the item, not to the event,
    // so the opening record carries it and the log never disagrees with the snapshot about it.
    const was = shared(before);
    const baseline: ItemState = was.meta.id === undefined && after.meta.id !== undefined
      ? { stage: was.stage, meta: { ...was.meta, id: after.meta.id } }
      : was;
    catchUp(root, dir, state, baseline);
    const diff = diffShared(baseline.meta, after.meta);
    const moved = baseline.stage !== after.stage;
    if (!moved && Object.keys(diff.set).length === 0 && diff.unset.length === 0) return;
    append(root, dir, { event, ...(moved ? { from: baseline.stage, stage: after.stage } : {}), ...diff });
  } catch (err) {
    warn(name, dir, err);
  }
}

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { withLock } from "../shared/lock.js";
import type { Feature } from "./features.js";

export type StepOutcome =
  | { argv: string[]; outcome: "exit"; code: number }
  | { argv: string[]; outcome: "signal"; signal: string }
  | { argv: string[]; outcome: "not-started"; error: string }
  | { argv: string[]; outcome: "not-run" };

/** One `kf verify --stage` run that ran at least one command — written only by kf, read by the review gate and `kf status`. */
export interface StageRecord {
  at: string;
  /** Full HEAD sha of the directory the commands ran in (the item worktree, else the project root). */
  sha: string;
  /** No tracked file had uncommitted changes when the run started; untracked files do not count. */
  clean: boolean;
  /** One outcome per configured argv, in config order. */
  commands: StepOutcome[];
  /** sha256 of the stdout and stderr of every command that ran, in order. */
  outputSha256: string;
  exit: 0 | 1;
}

// Not `task-NNN-verify.log`: `kf next` and `kf loop-stats` read loop/ files by that name, and a stage run is no task's.
export const STAGE_RECORD_FILE = "stage-verify.jsonl";

export function stageRecordPath(itemDir: string): string {
  return join(itemDir, "loop", STAGE_RECORD_FILE);
}

/** Append one record as a JSON line under the item lock, so two runs never interleave. */
export async function appendStageRecord(root: string, feature: Feature, record: StageRecord): Promise<void> {
  await withLock(root, feature.name, async () => {
    mkdirSync(join(feature.dir, "loop"), { recursive: true });
    appendFileSync(stageRecordPath(feature.dir), `${JSON.stringify(record)}\n`);
  });
}

export type LatestStageRecord = { kind: "none" } | { kind: "invalid"; reason: string } | { kind: "record"; record: StageRecord };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function isStepOutcome(v: unknown): v is StepOutcome {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!isStringArray(o.argv)) return false;
  switch (o.outcome) {
    case "exit": return typeof o.code === "number";
    case "signal": return typeof o.signal === "string";
    case "not-started": return typeof o.error === "string";
    case "not-run": return true;
    default: return false;
  }
}

function isStageRecord(v: unknown): v is StageRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.at === "string" && typeof r.sha === "string" && /^[0-9a-f]{40}$/.test(r.sha)
    && typeof r.clean === "boolean" && Array.isArray(r.commands) && r.commands.every(isStepOutcome)
    && typeof r.outputSha256 === "string" && (r.exit === 0 || r.exit === 1);
}

/**
 * The last non-blank line of the item's record file decides. An unreadable last line is `invalid`, never a reason
 * to fall back to an earlier line: a pass before a torn write is not evidence for the tree that follows it.
 */
export function readLatestStageRecord(feature: Feature): LatestStageRecord {
  const path = stageRecordPath(feature.dir);
  if (!existsSync(path)) return { kind: "none" };
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { kind: "none" };
  const last = lines[lines.length - 1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch (err) {
    return { kind: "invalid", reason: `the last line of ${path} is not JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!isStageRecord(parsed)) return { kind: "invalid", reason: `the last line of ${path} is not a stage record` };
  return { kind: "record", record: parsed };
}

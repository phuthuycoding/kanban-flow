import { existsSync } from "node:fs";

import { runGit, trackedChanges } from "../shared/git.js";
import { readProjectConfig } from "../project/config.js";
import { finding, type Finding } from "./findings.js";
import { readLatestStageRecord, stageRecordPath, type StageRecord } from "./stage-record.js";
import type { Feature, VerifyWaiver } from "./features.js";

export type StageEvidenceState =
  | "pass" | "fail" | "stale" | "dirty-at-record" | "dirty-now" | "config-changed"
  | "invalid" | "none" | "waived" | "not-configured" | "dir-missing";

export interface StageEvidence {
  state: StageEvidenceState;
  /** The directory the stage commands run in: the item worktree, else the project root. */
  dir: string;
  head: string | null;
  record?: StageRecord;
  waiver?: VerifyWaiver;
  /** Why the latest record could not be read (`invalid`). */
  reason?: string;
}

const sameArgv = (a: string[][], b: string[][]): boolean =>
  a.length === b.length && a.every((argv, i) => argv.length === b[i].length && argv.every((x, j) => x === b[i][j]));

/**
 * What stands behind the item's move into review: the latest stage record judged against the item's HEAD, its
 * tree and the commands pinned now — or, only where nothing is pinned, the human's waiver. It runs no command.
 */
export function evaluateStageEvidence(root: string, feature: Feature): StageEvidence {
  const dir = feature.meta?.worktree?.path ?? root;
  if (!existsSync(dir)) return { state: "dir-missing", dir, head: null };
  const rev = runGit(dir, ["rev-parse", "HEAD"]);
  const head = rev.code === 0 ? rev.stdout.trim() : null;

  const pinned = readProjectConfig(root).harness?.verify?.stage ?? [];
  if (pinned.length === 0) {
    const waiver = feature.meta?.verifyWaiver;
    return waiver ? { state: "waived", dir, head, waiver } : { state: "not-configured", dir, head };
  }

  const latest = readLatestStageRecord(feature);
  if (latest.kind === "none") return { state: "none", dir, head };
  if (latest.kind === "invalid") return { state: "invalid", dir, head, reason: latest.reason };
  const record = latest.record;
  const argv = record.commands.map((c) => c.argv);
  if (!sameArgv(argv, pinned)) return { state: "config-changed", dir, head, record };
  if (record.sha !== head) return { state: "stale", dir, head, record };
  if (record.exit !== 0) return { state: "fail", dir, head, record };
  if (!record.clean) return { state: "dirty-at-record", dir, head, record };
  if (trackedChanges(dir).length > 0) return { state: "dirty-now", dir, head, record };
  return { state: "pass", dir, head, record };
}

/** One ERROR per refusing state, each naming the cause and what to run; none for `pass` and `waived`. */
export function stageEvidenceFindings(feature: Feature, ev: StageEvidence): Finding[] {
  const name = feature.name;
  const run = `kf verify ${name} --stage`;
  const file = stageRecordPath(feature.dir);
  const short = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : "none");
  const one = (code: string, message: string): Finding[] => [finding(feature, "ERROR", file, code, message)];
  switch (ev.state) {
    case "pass":
    case "waived":
      return [];
    case "none":
      return one("verify_record_missing", `'${name}' has no stage verify record. Run: ${run}`);
    case "fail":
      return one("verify_record_failed", `The latest stage verify of '${name}' failed (exit ${ev.record?.exit}) at ${short(ev.record?.sha)}. Fix it, commit, then run: ${run}`);
    case "stale":
      return one("verify_record_stale", `The latest stage verify of '${name}' ran at ${short(ev.record?.sha)}, but HEAD is ${short(ev.head)}. Run: ${run}`);
    case "dirty-at-record":
      return one("verify_tree_dirty", `The latest stage verify record of '${name}' was taken on a tree with uncommitted tracked changes. Commit them, then run: ${run}`);
    case "dirty-now":
      return one("verify_tree_dirty", `'${name}' has uncommitted tracked changes now, so the stage verify record at ${short(ev.record?.sha)} does not cover the tree. Commit them, then run: ${run}`);
    case "config-changed":
      return one("verify_config_changed", `harness.verify.stage changed since the stage verify record at ${short(ev.record?.sha)} of '${name}'. Run: ${run}`);
    case "invalid":
      return one("verify_record_invalid", `The stage verify record of '${name}' cannot be read: ${ev.reason}. Run: ${run}`);
    case "not-configured":
      return one("verify_not_configured", `No harness.verify.stage is pinned in .kf/config.json, and '${name}' has no waiver. Pin the stage commands and run ${run}, or, on the human's word, record a waiver: ${run} --waive "<reason>"`);
    case "dir-missing":
      return one("verify_dir_missing", `The item directory ${ev.dir} of '${name}' does not exist, so no stage verify can stand for it. Restore it, then run: ${run}`);
  }
}

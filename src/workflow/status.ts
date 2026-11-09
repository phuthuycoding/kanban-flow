import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  STAGES,
  ARTIFACTS,
  FEATURE_ONLY_ARTIFACTS,
  STAGE_INDEX,
  PHASE_NAMES,
  currentStageName,
  type ArtifactId,
} from "./schema.js";
import { splitFrontmatter, isFilledFile } from "../shared/frontmatter.js";
import type { Feature } from "./features.js";
import { executionContractHash, findWorksRoot } from "./features.js";
import { ProjectConfigError, readProjectConfig } from "../project/config.js";
import { validateFeature } from "./validate.js";
import type { Finding } from "./findings.js";
import { evaluateStageEvidence, type StageEvidence } from "./stage-evidence.js";

export type ArtifactStatus = "done" | "missing" | "waiting";

export interface ArtifactState {
  id: ArtifactId;
  file: string;
  exists: boolean;
  filled: boolean;
  /** due determines whether absence blocks advancement at the current stage */
  due: boolean;
  status: ArtifactStatus;
  path: string;
  note: string;
}

export interface FeatureStatus {
  feature: Feature;
  stageIndex: number;
  artifacts: ArtifactState[];
  doneCount: number;
  dueCount: number;
  totalCount: number;
  next: ArtifactId | null;
  /**
   * Blocking ERRORs from the real validator, not a second set of rules. The artifact list above
   * answers only "which files exist and are filled", but it is read as a readiness checklist —
   * and every worker is told to run `kf status` for exactly that. Without these an item could
   * print `Artifacts: 5/5` and `Next: kf approve`, then fail `kf approve` on four findings.
   *
   * Same list the text and `--json` renderings use, so the two cannot drift apart.
   */
  blockers: Finding[];
  taskProgress: { done: number; total: number };
  /** Why a review PASS item did not close on this run; set by the command that attempted it. */
  close?: CloseState;
  /** Stage verify evidence while the item is in implementation, testing or review; null otherwise or without a root. */
  stageVerify: StageEvidence | null;
}

/**
 * The result of a close attempt on a review PASS item that stayed in review. Computed by the
 * command layer (it calls gh through archiveItem); rendering here stays pure.
 */
export type CloseState =
  | { kind: "awaiting-merge"; pr: string }
  | { kind: "pr-closed"; pr: string }
  | { kind: "refused"; detail: string };

function readArtifactContent(dir: string, file: string): string {
  const p = join(dir, file);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

/** Frontmatter `status:` of a report artifact (e.g. review-report), or null when absent/unreadable. */
export function reportStatus(dir: string, artifact: ArtifactId): string | null {
  const p = join(dir, ARTIFACTS[artifact].file);
  if (!existsSync(p)) return null;
  try {
    return splitFrontmatter(readFileSync(p, "utf8")).fm.status ?? null;
  } catch {
    return null;
  }
}

/** Report status of the current execution only; a report left over from an earlier execution is null. */
export function currentReportStatus(feature: Feature, artifact: "testing-result" | "review-report"): string | null {
  const p = join(feature.dir, ARTIFACTS[artifact].file);
  if (!existsSync(p) || !feature.meta?.executionId) return null;
  const { fm } = splitFrontmatter(readFileSync(p, "utf8"));
  return fm.execution === feature.meta.executionId ? fm.status ?? null : null;
}

export function countTasks(content: string): { done: number; total: number } {
  const lines = content.split("\n");
  let done = 0;
  let total = 0;
  for (const line of lines) {
    if (/^\s*- \[ \]/.test(line)) total += 1;
    else if (/^\s*- \[[xX]\]/.test(line)) {
      total += 1;
      done += 1;
    }
  }
  return { done, total };
}

/** Compute artifact completion status for a feature at its current stage. */
export function computeStatus(feature: Feature, root?: string): FeatureStatus {
  const stageIndex = STAGE_INDEX[feature.stage];
  const artifacts: ArtifactState[] = [];
  let doneCount = 0;
  let dueCount = 0;

  for (const id of Object.keys(ARTIFACTS) as ArtifactId[]) {
    if (feature.meta?.kind === "bug" && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const def = ARTIFACTS[id];
    const path = join(feature.dir, def.file);
    const exists = existsSync(path);
    const raw = readArtifactContent(feature.dir, def.file);
    const { fm, body } = splitFrontmatter(raw);
    const current = (id !== "testing-result" && id !== "review-report")
      || (Boolean(feature.meta?.executionId) && fm.execution === feature.meta?.executionId);
    const filled = exists && isFilledFile(raw, body) && current;
    const due = stageIndex >= def.dueFromStage;

    let status: ArtifactStatus;
    let note = "";
    if (exists && filled) {
      status = "done";
      doneCount += 1;
    } else if (due) {
      status = "missing";
      note = exists ? current ? "not filled (placeholders or empty)" : "report belongs to a different execution" : "file missing";
      dueCount += 1;
    } else {
      status = "waiting";
      const dueStage = STAGES[def.dueFromStage];
      note = `due at ${PHASE_NAMES[dueStage]}`;
    }
    artifacts.push({ id, file: def.file, exists, filled, due, status, path, note });
  }

  const tasksPath = join(feature.dir, "tasks.md");
  const taskProgress = existsSync(tasksPath)
    ? countTasks(readFileSync(tasksPath, "utf8"))
    : { done: 0, total: 0 };

  const next =
    artifacts.find((a) => a.due && a.status !== "done")?.id ?? null;
  // Straight from the real validator — no second set of rules. `approval_required` is the one
  // ERROR left out: it is not a defect in the artifacts but the human gate, and the `Approval:`
  // field and the `Next:` line below already say so. Listing it here would put a red ERROR on
  // every correctly-prepared item sitting in planning, which is exactly where the signal matters.
  const blockers = validateFeature(feature, false, true).issues
    .filter((i) => i.severity === "ERROR" && i.code !== "approval_required");

  return {
    feature,
    stageIndex,
    artifacts,
    doneCount,
    dueCount,
    totalCount: artifacts.length,
    next,
    blockers,
    taskProgress,
    stageVerify: root !== undefined && STAGE_VERIFY_STAGES.includes(feature.stage)
      ? evaluateStageEvidence(root, feature)
      : null,
  };
}

const STAGE_VERIFY_STAGES: readonly string[] = ["implementation", "testing", "review"];

const sha7 = (sha: string | null | undefined): string => (sha ?? "").slice(0, 7);

function ageSince(at: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}

function stageVerifyLine(ev: StageEvidence, feature: string): string {
  const rec = ev.record;
  switch (ev.state) {
    case "pass": return `Stage verify: PASS ${sha7(rec?.sha)} at HEAD, ${ageSince(rec?.at ?? "")} ago`;
    case "fail": return `Stage verify: FAIL ${sha7(rec?.sha)} at HEAD (exit ${rec?.exit})`;
    case "stale": return `Stage verify: stale (record ${sha7(rec?.sha)}, HEAD ${sha7(ev.head)})`;
    case "waived": return `Stage verify: waived — ${ev.waiver?.reason} (${ev.waiver?.by}, ${ev.waiver?.at.slice(0, 10)})`;
    case "none": return `Stage verify: none — run kf verify ${feature} --stage`;
    case "not-configured": return "Stage verify: not configured — pin harness.verify.stage or record a waiver";
    case "dirty-at-record": return `Stage verify: record ${sha7(rec?.sha)} taken on a dirty tree`;
    case "dirty-now": return "Stage verify: tree has uncommitted changes";
    case "config-changed": return `Stage verify: harness.verify.stage changed since record ${sha7(rec?.sha)}`;
    case "invalid": return `Stage verify: invalid record — ${ev.reason}`;
    case "dir-missing": return `Stage verify: item directory missing — ${ev.dir}`;
  }
}

interface DomainsFlag { domains: boolean; error?: string }
const domainsCache = new Map<string, DomainsFlag>();

/** Reads only `worktree.domains`; keyed by the config file's mtime so a rewritten config is seen
 *  while status --all / the dashboard do not re-read it per item. A broken config reads as off and
 *  reports why: the direct URL works whatever the flag says, a domain URL may lead nowhere. */
function resolveDomains(root: string): DomainsFlag {
  const file = join(root, ".kf", "config.json");
  const key = `${root}\0${((st) => (st ? `${st.mtimeMs}:${st.size}` : "none"))(statSync(file, { throwIfNoEntry: false }))}`;
  const hit = domainsCache.get(key);
  if (hit) return hit;
  let flag: DomainsFlag;
  try {
    flag = { domains: readProjectConfig(root).worktree?.domains ?? true };
  } catch (err) {
    if (!(err instanceof ProjectConfigError)) throw err;
    flag = { domains: false, error: err.message };
  }
  domainsCache.set(key, flag);
  return flag;
}

/** Render a human-readable status snapshot (mirrors `openspec status`). */
export function renderStatusText(s: FeatureStatus): string {
  const lines: string[] = [];
  const ready = s.artifacts.filter((a) => a.status !== "waiting");
  const done = ready.filter((a) => a.status === "done").length;
  const taskStr =
    s.taskProgress.total > 0
      ? `, tasks ${s.taskProgress.done}/${s.taskProgress.total}`
      : "";

  const approval = approvalState(s.feature);
  lines.push(`${s.feature.meta?.kind === "bug" ? "Bug" : "Feature"}: ${s.feature.name} (${s.feature.context ?? "no-context"})`);
  lines.push(`Stage: ${s.feature.stage} (${PHASE_NAMES[s.feature.stage]})   Approval: ${approval}   Artifacts: ${done}/${ready.length}${taskStr}`);
  if (s.feature.meta?.executionId) lines.push(`Execution: ${s.feature.meta.executionId}`);
  if (s.feature.meta?.issue) lines.push(`Issue: ${s.feature.meta.issue}`);
  if (s.close?.kind === "awaiting-merge") lines.push(`Awaiting merge: ${s.close.pr}`);
  if (s.close?.kind === "pr-closed") lines.push(`PR closed without merging: ${s.close.pr}`);
  if (s.close?.kind === "refused") lines.push(`Not closed: ${s.close.detail}`);
  if (s.feature.meta?.docsBranch) lines.push(`Docs branch: ${s.feature.meta.docsBranch}`);
  if (s.feature.meta?.issue && s.feature.stage === "done") {
    lines.push(`Delivered: ${s.feature.meta.delivered ? `yes${s.feature.meta.deliveredAt ? ` at ${s.feature.meta.deliveredAt}` : ""}` : "no — run: kf archive " + s.feature.name + " to finalize delivery"}`);
  }
  const wt = s.feature.meta?.worktree;
  if (wt) {
    lines.push(`Worktree: ${wt.path}  (branch ${wt.branch})`);
    const root = findWorksRoot(s.feature.dir);
    const flag: DomainsFlag = root === null ? { domains: true } : resolveDomains(root);
    lines.push(flag.domains
      ? `Domain:   http://${wt.domain}  (direct: http://127.0.0.1:${wt.port})`
      : `Direct:   http://127.0.0.1:${wt.port}`);
    if (flag.error) lines.push(`Config:   invalid .kf/config.json — ${flag.error}`);
  }
  const bypasses = s.feature.meta?.bypasses ?? [];
  if (bypasses.length > 0) lines.push(`Bypasses: ${bypasses.length} (${bypasses.map((b) => `--${b.flag} → ${currentStageName(b.to)}`).join(", ")})`);
  if (s.stageVerify) lines.push(stageVerifyLine(s.stageVerify, s.feature.name));
  const cancellation = s.feature.meta?.cancellation;
  if (cancellation) {
    lines.push(`Cancelled: ${cancellation.at} by ${cancellation.by} (was ${currentStageName(cancellation.fromStage)}) — ${cancellation.reason.split("\n")[0]}`);
  }
  lines.push("");

  for (const a of s.artifacts) {
    const mark =
      a.status === "done" ? "[x]" : a.status === "missing" ? "[ ]" : "[-]";
    const suffix = a.status === "done" ? "" : `  ${a.note}`;
    lines.push(`${mark} ${a.id}${suffix}`);
  }

  if (s.blockers.length > 0) {
    lines.push("");
    lines.push(`Blocking (${s.blockers.length}) — kf validate --change "${s.feature.name}" for the full report:`);
    for (const b of s.blockers) lines.push(`  [ERROR] ${b.file}: ${b.message} (${b.code})`);
  }

  if (s.close?.kind === "awaiting-merge" && !s.next && s.blockers.length === 0) {
    lines.push("");
    lines.push(`Next: merge ${s.close.pr} on GitHub, then kf status --change ${s.feature.name}`);
  } else if (s.close?.kind === "pr-closed" && !s.next && s.blockers.length === 0) {
    lines.push("");
    lines.push(`Next: human decision — ${s.close.pr} was closed without merging: reopen and merge it, or open a new PR and run kf issues link "${s.feature.name}" <url> --pr --replace, or kf stage "${s.feature.name}" implementation, or kf cancel "${s.feature.name}"`);
  } else if (s.next) {
    lines.push("");
    lines.push(`Next: kf instruct ${s.next} --change "${s.feature.name}"`);
  } else if (s.blockers.length > 0) {
    // Naming a next step that is going to be refused is the whole bug. Say what to fix instead.
    lines.push("");
    lines.push(`Next: clear the blocking findings above, then re-run kf status --change ${s.feature.name}.`);
  } else if (s.feature.stage === "planning" && approval !== "approved") {
    lines.push(`Next: human approval, then kf approve "${s.feature.name}"`);
  } else if (s.feature.stage === "planning" && approval === "approved") {
    // Approve moves the item, so an approved planning item predates that; re-running approve moves it.
    lines.push(`Next: kf approve "${s.feature.name}"`);
  } else if (s.feature.stage === "backlog") {
    lines.push(`Next: kf stage "${s.feature.name}" implementation`);
  } else if (s.feature.stage === "implementation") {
    lines.push("");
    lines.push(`Next: load the kf:implement skill for "${s.feature.name}"`);
  }
  return lines.join("\n");
}

/** Render a JSON-serializable status object. */
export function statusToJson(s: FeatureStatus) {
  return {
    feature: s.feature.name,
    kind: s.feature.meta?.kind ?? "feature",
    context: s.feature.context,
    stage: s.feature.stage,
    approval: approvalState(s.feature),
    executionId: s.feature.meta?.executionId ?? null,
    issue: s.feature.meta?.issue ?? null,
    pr: s.feature.meta?.pr ?? null,
    docsBranch: s.feature.meta?.docsBranch ?? null,
    close: s.close ?? null,
    worktree: s.feature.meta?.worktree ?? null,
    bypasses: s.feature.meta?.bypasses ?? [],
    cancellation: s.feature.meta?.cancellation ?? null,
    artifacts: s.artifacts.map((a) => ({
      id: a.id,
      file: a.file,
      status: a.status,
      due: a.due,
      path: a.path,
      note: a.note,
    })),
    doneCount: s.doneCount,
    dueCount: s.dueCount,
    totalCount: s.totalCount,
    next: s.next,
    blockers: s.blockers,
    tasks: s.taskProgress,
    stageVerify: s.stageVerify
      ? {
          state: s.stageVerify.state,
          sha: s.stageVerify.record?.sha ?? null,
          head: s.stageVerify.head,
          matchesHead: s.stageVerify.record && s.stageVerify.head ? s.stageVerify.record.sha === s.stageVerify.head : null,
          at: s.stageVerify.record?.at ?? null,
          exit: s.stageVerify.record?.exit ?? null,
          reason: s.stageVerify.waiver?.reason ?? null,
          by: s.stageVerify.waiver?.by ?? null,
        }
      : null,
  };
}

export function approvalState(feature: Feature): "pending" | "approved" | "changed" {
  const approval = feature.meta?.approval;
  if (approval?.status !== "approved") return "pending";
  return approval.contractHash && approval.contractHash === executionContractHash(feature.dir, feature.meta?.kind === "bug" ? "bug" : "feature") ? "approved" : "changed";
}

/** A `lookup-rerun` entry always carries the `next` step renderBuckets prints in place of its command. */
export type WaitingToMergeEntry =
  | { feature: string; pr?: string; command: string; docsBranch?: string; reason?: string; kind?: never; next?: never }
  | { feature: string; pr?: never; command: string; docsBranch: string; reason?: string; kind: "lookup-rerun"; next: string };

export interface Buckets {
  /** Items waiting on a human decision. */
  needsYou: Array<{ feature: string; decision: string }>;
  /** Things the human does outside kf: merge a PR, push a docs branch. */
  waitingToMerge: WaitingToMergeEntry[];
}

/**
 * The two buckets `kf status --all` ends with. `docsBranchesUnpushed` comes from
 * git state the caller read; everything else is read off the statuses.
 */
export function computeBuckets(
  statuses: FeatureStatus[],
  docsBranchesUnpushed: Array<{ feature: string; branch: string; reason?: string; kind?: "lookup-rerun"; remedy?: string; gone?: true }>,
): Buckets {
  const needsYou: Buckets["needsYou"] = [];
  const waitingToMerge: Buckets["waitingToMerge"] = [];
  for (const s of statuses) {
    const f = s.feature;
    if (f.stage === "brainstorm" && splitFrontmatter(readArtifactContent(f.dir, ARTIFACTS["spec-requirement"].file)).fm.status !== "confirmed") {
      needsYou.push({ feature: f.name, decision: "confirm spec" });
    } else if (f.stage === "planning" && approvalState(f) !== "approved") {
      needsYou.push({ feature: f.name, decision: "approve plan (or --backlog)" });
    } else if (f.stage === "testing" && currentReportStatus(f, "testing-result") === "BLOCKED") {
      needsYou.push({ feature: f.name, decision: "testing BLOCKED — unblock it or revise the plan" });
    } else if (f.stage === "review") {
      const review = currentReportStatus(f, "review-report");
      if (review === "FAIL" || review === "REJECT" || review === "REQUIREMENT_BUG") {
        needsYou.push({ feature: f.name, decision: `review ${review} — repair (kf stage ${f.name} implementation) or revise the plan` });
      } else if (s.close?.kind === "pr-closed") {
        needsYou.push({ feature: f.name, decision: `${s.close.pr} was closed without merging — reopen and merge it, open a new PR and run kf issues link ${f.name} <url> --pr --replace, or move the item back` });
      } else if (s.close?.kind === "awaiting-merge") {
        const number = /\/pull\/(\d+)$/.exec(s.close.pr)?.[1];
        waitingToMerge.push({ feature: f.name, pr: s.close.pr, command: number ? `gh pr merge ${number}` : `gh pr merge ${s.close.pr}` });
      } else if (s.close?.kind === "refused") {
        needsYou.push({ feature: f.name, decision: `review PASS but not closed: ${s.close.detail}` });
      }
    }
  }
  for (const d of docsBranchesUnpushed) {
    if (d.gone) {
      needsYou.push({ feature: d.feature, decision: d.remedy ? docsNotProvenLandedDecision(d.feature, d.remedy, d.reason) : docsNeverLandedDecision(d.feature, d.reason) });
      continue;
    }
    if (d.kind === "lookup-rerun") {
      waitingToMerge.push({ feature: d.feature, docsBranch: d.branch, command: DOCS_LOOKUP_RERUN, ...(d.reason ? { reason: d.reason } : {}), kind: d.kind, next: docsLookupRerunDecision(d.feature, DOCS_LOOKUP_RERUN) });
      continue;
    }
    waitingToMerge.push({ feature: d.feature, docsBranch: d.branch, command: `git push -u origin ${d.branch}`, ...(d.reason ? { reason: d.reason } : {}) });
  }
  return { needsYou, waitingToMerge };
}

/** A docs branch nothing proves landed and nothing is left to push; doctor gives the same decision. */
export function docsNeverLandedDecision(feature: string, reason?: string): string {
  return `canonical docs for ${feature} never landed${reason ? ` (${reason})` : ""}: re-land them on a fresh docs branch for a PR with kf archive ${feature}, or leave them`;
}

/** A gone docs branch no lookup could run for until the human applies `remedy`, so it is not called never landed. */
export function docsNotProvenLandedDecision(feature: string, remedy: string, reason?: string): string {
  return `run ${remedy} first, then re-run ${DOCS_LOOKUP_RERUN}: canonical docs for ${feature} are not proven landed${reason ? ` (${reason})` : ""}; if they still are not, re-land them on a fresh docs branch for a PR with kf archive ${feature}, or leave them`;
}

/** The command kf status --all gives a gone docs branch whose merged-PR lookup could not run. */
export const DOCS_LOOKUP_RERUN = "kf status --all";

/** The next step for a gone docs branch whose merged-PR lookup could not run; doctor gives the same one. */
export function docsLookupRerunDecision(feature: string, rerun: string): string {
  return `re-run ${rerun} once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive ${feature}`;
}

export function renderBuckets(b: Buckets): string {
  const lines = ["Needs you"];
  if (b.needsYou.length === 0) lines.push("  (none)");
  for (const n of b.needsYou) lines.push(`  ${n.feature} — ${n.decision}`);
  lines.push("Waiting to merge");
  if (b.waitingToMerge.length === 0) lines.push("  (none)");
  for (const w of b.waitingToMerge) {
    if (!w.docsBranch) lines.push(`  ${w.feature} — ${w.pr}: ${w.command}`);
    else if (w.kind === "lookup-rerun") lines.push(`  ${w.feature} — ${w.docsBranch} not proven merged${w.reason ? ` (${w.reason})` : ""}: ${w.next}`);
    else if (w.reason) lines.push(`  ${w.feature} — ${w.docsBranch} not proven merged (${w.reason}): ${w.command}`);
    else lines.push(`  ${w.feature} — ${w.docsBranch} awaiting push: ${w.command}`);
  }
  return lines.join("\n");
}

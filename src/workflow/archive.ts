import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { sameCommit } from "./validate-reports.js";

import { ARTIFACTS, METADATA_FILE, currentStageName, type LegacyStageName, type Stage } from "./schema.js";
import { findFeature, stageDir, updateFeatureMeta, withDocsLanded, writeFeatureMeta, type Bypass, type Feature, type FeatureMeta } from "./features.js";
import { lockPath, withLock } from "../shared/lock.js";
import { isPidAlive } from "../shared/process.js";
import { validateFeature, checkDirectionGate, renderValidateText } from "./validate.js";
import { writeFileAtomic } from "../shared/paths.js";
import { runHook, resolveHook, type HookResult, type HookSource } from "../integrations/hooks.js";
import { recordBypasses } from "./bypass.js";
import {
  resolveDocsTarget,
  writeCanonicalDocsBranch,
  docsLandedProof,
  type DocsBranchResult,
  type DocsTarget,
} from "./canonical-docs.js";
import { checkMergeGate, type MergeGateFailure } from "../integrations/github.js";
import { readProjectConfig } from "../project/config.js";
import { worktreeConfig } from "../worktree/config.js";
import { assertWorktreeClean, deleteItemBranch, teardownWorktree, tipPastMergedHead, type BranchDeletion, type LandedProof, type TeardownResult } from "../worktree/lifecycle.js";
import { branchExists, WorktreeDirtyError } from "../worktree/manager.js";
import { branchPushed, countCommits, deleteBranch, hasRemote, originDefaultRef, revParse } from "../shared/git.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { recordChange, sharedMeta, withItemId } from "./item-log.js";

/** Which command asked for the close; only the re-run hints differ. */
export type ArchiveTrigger = "status" | "sync" | "archive" | "stage" | "issues";

export interface ArchiveOptions {
  force?: boolean;
  skipHooks?: boolean;
  trigger?: ArchiveTrigger;
}

/** Why an archive was refused. Each reason carries the short stderr tag `kf archive` has always printed. */
export type ArchiveRefusalReason =
  | "unknown-item"
  | "cancelled"
  | "merge-gate"
  | "gate"
  | "wrong-stage"
  | "direction"
  | "target-exists"
  | "metadata-missing"
  | "worktree-dirty"
  | "teardown-failed"
  | "landing-commits"
  | "docs-target"
  | "changed-concurrently"
  | "pr-branch"
  | "close-in-progress";

export type ArchiveOutcome =
  | {
      kind: "archived";
      name: string;
      from: Stage;
      dir: string;
      hasIssue: boolean;
      bypasses: Bypass[];
      teardown: TeardownResult | null;
      /** Worktree path printed when one was removed; null when there was no worktree. */
      worktreePath: string | null;
      /** The item branch deleted locally and on origin; null when the item had no worktree branch. */
      branch: BranchDeletion | null;
      /** How the branch's commits were counted, when that fell back from origin's default branch. */
      countNote: string | null;
      /** The recorded PR the close was verified against; null when the item had nothing to land. */
      pr: string | null;
      /** Why the reviewed commit is not the merged one; null when they agree or the report names none. */
      reviewNote: string | null;
      /** The warning for an item approved before living docs whose PASS report records no `docs:`; null otherwise. */
      legacyDocsNote: string | null;
    }
  | {
      /** The item was already in done: delivery re-stamped, a recorded docs branch waited on or re-landed. */
      kind: "reconciled";
      name: string;
      dir: string;
      /** Docs committed again on a re-landed docs branch, repository-relative; empty otherwise. */
      docs: string[];
      /** True when delivery was already stamped before this reconcile. */
      alreadyDelivered: boolean;
      /** What this reconcile did about the recorded docs branch; null when there is none. */
      docsBranch: ReconciledDocsBranch | null;
      hasIssue: boolean;
      bypasses: Bypass[];
    }
  | {
      kind: "refused";
      reason: ArchiveRefusalReason;
      stdout: string;
      stderrTag: string;
      merge?: MergeGateFailure;
      /** The ERROR codes of a gate or direction refusal; absent for every other reason. */
      codes?: string[];
    }
  | { kind: "hook-failed"; hook: HookResult; stdout: string; stderrTag: string }
  | { kind: "error"; error: unknown };

/**
 * The recorded docs branch on a done-item reconcile. `waiting`: it is still live (local or on
 * origin) — record kept, nothing written; `push` when it is only local, `reason` why a local
 * branch is not proven landed, when there is one. `landed`: proven landed, recorded as docsLanded.
 * `relanded`: gone, so the docs were committed anew on `branch` (now the record); `unproven`
 * says why the merged-PR lookup could not run, when it could not — the earlier PR may have merged.
 */
export type ReconciledDocsBranch =
  | { kind: "waiting"; branch: string; push: boolean; reason?: string }
  | { kind: "landed"; branch: string }
  | { kind: "relanded"; branch: string; why: string; unproven?: string };

/** What the reconcile will do about a recorded docs branch, decided before any side effect. */
type DocsBranchPlan =
  | { kind: "waiting"; branch: string; push: boolean; reason?: string }
  | { kind: "landed"; branch: string; by: "ancestor" | "merged-pr" | "content" }
  | { kind: "branch"; branch: string; target: Extract<DocsTarget, { kind: "branch" }>; unproven?: string }
  | { kind: "refused"; message: string };

/**
 * A live docs branch (local or on origin) is only waited on. One gone from here that nothing
 * proves landed is re-landed on a fresh docs branch, never into the working tree — whatever kept
 * the proof from running: the docs on origin may have been edited since, and that overwrite
 * must show in a PR diff.
 */
function docsBranchPlan(root: string, f: Feature, branch: string): DocsBranchPlan {
  const pushed = branchPushed(root, "origin", branch);
  if (pushed === true || (pushed === null && revParse(root, `refs/remotes/origin/${branch}`))) return { kind: "waiting", branch, push: false };
  const proof = docsLandedProof(root, f);
  if (proof.landed) return { kind: "landed", branch, by: proof.by };
  if (pushed === false) return { kind: "waiting", branch, push: true, ...(proof.pushed && proof.reason ? { reason: proof.reason } : {}) };
  const target = resolveDocsTarget(root, f, { branchOnly: `the docs branch ${branch} is gone and nothing proves its docs landed, so the rewrite must show in a PR diff` });
  if (target.kind === "refused") return target;
  return { kind: "branch", branch, target, ...(!proof.gone && proof.reason ? { unproven: proof.reason } : {}) };
}

const refuse = (reason: ArchiveRefusalReason, stderrTag: string, stdout: string): ArchiveOutcome => ({ kind: "refused", reason, stdout, stderrTag });

const errorCodes = (issues: Array<{ severity: string; code: string }>): string[] => [...new Set(issues.filter((i) => i.severity === "ERROR").map((i) => i.code))];

/** A gate or direction refusal, with the codes of the checks that block it. */
const refuseChecks = (reason: "gate" | "direction", stderrTag: string, stdout: string, issues: Array<{ severity: string; code: string }>): ArchiveOutcome => ({
  kind: "refused", reason, stdout, stderrTag, codes: errorCodes(issues),
});

/** The command that repeats this close as the human typed it, with the flags that change what it does. */
function rerunCommand(name: string, opts: ArchiveOptions): string {
  if (opts.trigger === "status") return `kf status --change ${name}`;
  if (opts.trigger === "sync") return "kf sync";
  if (opts.trigger === "issues") return `kf issues done ${name}`;
  const flags = `${opts.force ? " --force" : ""}${opts.skipHooks ? " --skip-hooks" : ""}`;
  return opts.trigger === "stage" ? `kf stage ${name} done${flags}` : `kf archive ${name}${flags}`;
}

/** The same sentences `kf archive` has always printed for a merge-gate refusal; the failure rides along for callers that act on it. */
function refuseMerge(name: string, failure: MergeGateFailure): ArchiveOutcome {
  const outcome = mergeRefusal(name, failure);
  return outcome.kind === "refused" ? { ...outcome, merge: failure } : outcome;
}

function mergeRefusal(name: string, failure: MergeGateFailure): ArchiveOutcome {
  switch (failure.reason) {
    case "no-repository":
      return refuse("merge-gate", "no repository", `Cannot archive '${name}': PR ${failure.pr} is recorded but no "repository" is configured to verify it. Set one in .kf/config.json or archive after removing the pr link.`);
    case "unverifiable":
      return refuse("merge-gate", "pr unverifiable", `Cannot archive '${name}': could not verify merge state of ${failure.pr} — unverifiable is not merged.\n${failure.detail}`);
    case "parse":
      return refuse("merge-gate", "pr view parse", `Cannot archive '${name}': gh pr view ${failure.pr} returned unexpected output:\n${failure.output}`);
    case "not-merged":
      if (failure.state === "CLOSED") {
        return refuse("merge-gate", "pr closed", `Cannot archive '${name}': PR ${failure.pr} is not merged — it was closed without merging. Reopen and merge it, open a new PR and record it (kf issues link ${name} <url> --pr --replace), or decide what happens to the item (kf stage ${name} implementation, or kf cancel ${name}).`);
      }
      return refuse("merge-gate", "pr not merged", `Cannot archive '${name}': PR ${failure.pr} is not merged (state: ${failure.state}) — merge it first, then archive.`);
  }
}

const hookFailed = (hook: HookResult): ArchiveOutcome => ({
  kind: "hook-failed",
  hook,
  stdout: `Hook 'done' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\nArchive refused.\n\n${hook.output}\n\nRe-run with --skip-hooks to bypass.`,
  stderrTag: "hook failed",
});

/**
 * Commits on `branch` that its base lacks — the landing rule's "commits ahead". The base is
 * `origin/<default>` (the primary checkout may sit on any branch, even one holding these
 * commits); without origin/HEAD the primary's HEAD is the only base left, and the note says so.
 */
function commitsAhead(root: string, branch: string): { count: number; tip: string; note: string | null; againstHead: boolean } {
  const tip = revParse(root, `refs/heads/${branch}`);
  if (!tip) throw new Error(`branch ${branch} has no commit to count`);
  const base = originDefaultRef(root);
  if (base) return { count: countCommits(root, base, tip), tip, note: null, againstHead: false };
  // A local-only repo has no origin, so no default branch exists to be unknown: the checkout's
  // HEAD is the base, and 0 commits ahead of it means no commit is lost by deleting the branch.
  // The "no proof" rule is for a repo whose origin exists but has no origin/HEAD.
  if (!hasRemote(root, "origin")) return { count: countCommits(root, "HEAD", tip), tip, note: null, againstHead: false };
  return {
    count: countCommits(root, "HEAD", tip),
    tip,
    againstHead: true,
    note: "commits counted against the checkout's HEAD: origin/HEAD is not set, so the default branch is unknown (set it: git remote set-head origin -a)",
  };
}

/** `landing:` of the review report, or null when the report or the key is absent. */
function reviewLanding(dir: string): string | null {
  const p = join(dir, ARTIFACTS["review-report"].file);
  if (!existsSync(p)) return null;
  return splitFrontmatter(readFileSync(p, "utf8")).fm.landing ?? null;
}

/**
 * The merge already happened and only the human can undo it, so a review of another commit is reported, never a refusal.
 * Null when the report predates its `commit:` field or the heads agree.
 */
function reviewMismatch(dir: string, mergedHead: string): string | null {
  const p = join(dir, ARTIFACTS["review-report"].file);
  if (!existsSync(p)) return null;
  const reviewed = splitFrontmatter(readFileSync(p, "utf8")).fm.commit;
  if (!reviewed || sameCommit(mergedHead, reviewed)) return null;
  return `the review passed ${reviewed.slice(0, 7)} but ${mergedHead.slice(0, 7)} was merged: the review did not see the last commits`;
}

/**
 * The one warning line of a close for an item approved before living docs (no `livingDocs` marker)
 * whose PASS review report records no `docs:`; null for every other item.
 */
function legacyDocsWarning(f: Feature): string | null {
  if (f.meta?.approval?.livingDocs === true) return null;
  const p = join(f.dir, ARTIFACTS["review-report"].file);
  if (!existsSync(p)) return null;
  const { fm } = splitFrontmatter(readFileSync(p, "utf8"));
  if (fm.status !== "PASS" || (fm.docs ?? "").trim() !== "") return null;
  return `${f.name}: no living doc recorded (approved before living docs)`;
}

/** The docs-branch record after a reconcile: kept, landed, or the branch the docs were re-landed on. */
function docsRecord(meta: FeatureMeta, plan: DocsBranchPlan | null, written: DocsBranchResult | null): FeatureMeta {
  if (plan?.kind === "landed") return withDocsLanded(meta, plan.branch, plan.by);
  if (plan?.kind !== "branch" || !written) return meta;
  // Nothing committed: the fetched origin/<default> already holds these exact docs.
  if (!written.branch || !written.commit) return withDocsLanded(meta, plan.branch, "content");
  return { ...meta, docsBranch: written.branch, docsCommit: written.commit };
}

function reconciledDocsBranch(plan: DocsBranchPlan | null, written: DocsBranchResult | null): ReconciledDocsBranch | null {
  if (!plan || plan.kind === "refused") return null;
  if (plan.kind === "landed") return { kind: "landed", branch: plan.branch };
  if (plan.kind === "branch") {
    return written?.branch ? { kind: "relanded", branch: written.branch, why: plan.target.why, ...(plan.unproven ? { unproven: plan.unproven } : {}) } : { kind: "landed", branch: plan.branch };
  }
  return plan;
}

/** What the irreversible steps of a failed close already removed, for its error message. */
function alreadyRemoved(teardown: TeardownResult | null, path: string | null, branch: BranchDeletion | null): string {
  const gone: string[] = [];
  if (teardown?.removed) gone.push(`worktree ${path ?? ""}`);
  if (branch?.local.kind === "deleted") gone.push(`branch ${branch.branch} (local)`);
  if (branch?.remote.kind === "deleted") gone.push(`branch ${branch.branch} on origin`);
  return gone.length > 0 ? ` Already removed and not restored: ${gone.join(", ")}.` : "";
}

/**
 * Archive a work item: review → done, or an idempotent reconcile of an item already in
 * done. Pure of CLI concerns — callers render the outcome. Anything that used to propagate as a
 * throw comes back as `{ kind: "error" }`.
 */
export async function archiveItem(root: string, name: string, opts: ArchiveOptions = {}): Promise<ArchiveOutcome> {
  try {
    const key = findFeature(root, name)?.name;
    if (!key) return await runArchive(root, name, opts);
    return await whileClosing(root, key, name, () => runArchive(root, name, opts));
  } catch (error) {
    return { kind: "error", error };
  }
}

/**
 * One close per item at a time. The item lock is not held across the close: the reconcile path
 * re-takes it through updateFeatureMeta and the final move takes it again (an in-process
 * re-entry waits on itself forever), the done and worktree-remove hooks are user processes
 * that may run kf on this item (they would wait on their parent until LOCK_TIMEOUT_MS), and
 * the close's network steps (fetch, gh, push) can outlast that timeout for every other writer
 * of the item. So a close-in-progress marker is taken under the lock instead,
 * and a second close refuses before its hook while the first one's process is alive.
 */
async function whileClosing(root: string, key: string, name: string, close: () => Promise<ArchiveOutcome>): Promise<ArchiveOutcome> {
  const marker = lockPath(root, `${key}.closing`);
  const busy = await withLock(root, key, async (): Promise<number | null> => {
    const holder = existsSync(marker) ? Number((await readFile(marker, "utf8")).trim()) : NaN;
    if (Number.isInteger(holder) && isPidAlive(holder)) return holder;
    await writeFile(marker, String(process.pid));
    return null;
  });
  if (busy !== null) {
    return refuse("close-in-progress", "close in progress", `Cannot archive '${name}': another close of it is running (pid ${busy}). Wait for it, then check: kf status --change ${key}. If that process is gone, remove the stale marker: ${relative(root, marker)}`);
  }
  try {
    return await close();
  } finally {
    await rm(marker, { force: true });
  }
}

async function runArchive(root: string, name: string, opts: ArchiveOptions): Promise<ArchiveOutcome> {
  const f = findFeature(root, name);
  if (!f) return refuse("unknown-item", "unknown feature", `Unknown feature '${name}'. Run: kf list`);
  if (f.stage === "cancelled") {
    // The type says Stage, but features.ts accepts legacy names in old metadata; name the stage kf stage accepts.
    const recorded: string | undefined = f.meta?.cancellation?.fromStage;
    const reopen = recorded !== undefined ? currentStageName(recorded as Stage | LegacyStageName) : undefined;
    return refuse("cancelled", "cancelled", `'${name}' was cancelled (${f.meta?.cancellation?.reason ?? "no reason recorded"}). Move it back to ${reopen ?? "its stage"} first if you want to finish it.`);
  }

  const rerun = rerunCommand(name, opts);

  // Delivery gate: a recorded PR must be verifiably merged — archive is the post-delivery
  // step, so an unmerged/unverifiable PR refuses before any side effect, on both the
  // review → done move and the done reconcile path. No --force escape.
  const merge = checkMergeGate(f, readProjectConfig(root).repository);
  if (merge.kind === "failed") return refuseMerge(f.name, merge.failure);

  // Only review → done transition is archive-able. If already done, reconcile idempotently: the
  // close writes nothing under docs/, only a docs branch recorded by an earlier release is re-landed.
  if (f.stage === "done") {
    const check = validateFeature(f, false, true);
    if (!check.valid && !opts.force) return refuseChecks("gate", "gate failed", renderValidateText(check), check.issues);
    const recordedBranch = f.meta?.docsBranch;
    const plan = recordedBranch ? docsBranchPlan(root, f, recordedBranch) : null;
    if (plan?.kind === "refused") return refuse("docs-target", "docs target", `Cannot archive '${name}': ${plan.message}`);
    // Reaching this point with the gate failing means --force was given. Record it like the
    // review → done path does, or a forced refresh would leave no trail.
    const forcedCodes = check.valid ? [] : check.issues.filter((i) => i.severity === "ERROR").map((i) => i.code);
    // Reconcile also re-runs the done hook: the AC gate re-checks, the board re-syncs and
    // the issue close is a no-op on an already-closed issue. --skip-hooks records a bypass.
    const skipHooks = Boolean(opts.skipHooks);
    const skippedHook: HookSource | null = skipHooks ? resolveHook(root, "done") : null;
    if (!skipHooks) {
      const hook = runHook(root, {
        feature: f.name,
        context: f.context,
        dir: f.dir,
        root,
        from: "done",
        to: "done",
        approval: f.meta?.approval?.status ?? "pending",
      });
      if (hook.ran && !hook.ok) return hookFailed(hook);
    }
    const recorded = recordBypasses(f.stage, "done", forcedCodes, skippedHook);
    const metaPath = join(f.dir, METADATA_FILE);
    const originalMeta = f.meta && existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
    let written: DocsBranchResult | null = null;
    try {
      if (plan?.kind === "branch") written = await writeCanonicalDocsBranch(root, f, plan.target);
      if (f.meta) await updateFeatureMeta(root, f.name, (meta) => ({
        ...docsRecord(meta, plan, written),
        bypasses: recorded.length > 0 ? [...(meta.bypasses ?? []), ...recorded] : meta.bypasses,
        status: "archived",
        // Reconciling an item already stamped keeps its first delivery timestamp.
        delivered: true,
        deliveredAt: meta.deliveredAt ?? new Date().toISOString(),
      }), {}, "delivered");
    } catch (err) {
      const committed = written?.branch ?? null;
      const rollback = await Promise.allSettled([
        ...(committed ? [Promise.resolve().then(() => deleteBranch(root, committed))] : []),
        ...(originalMeta === null ? [] : [writeFileAtomic(metaPath, originalMeta)]),
      ]);
      const failures = rollback.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
      if (failures.length > 0) throw new AggregateError([err, ...failures], `Reconcile failed and rollback was incomplete for '${name}'.`);
      throw new Error(`Reconcile failed for '${name}'; feature remains in done.`, { cause: err });
    }
    return {
      kind: "reconciled",
      name,
      dir: f.dir,
      docs: written ? written.docs : [],
      alreadyDelivered: Boolean(f.meta?.delivered),
      docsBranch: reconciledDocsBranch(plan, written),
      hasIssue: Boolean(f.meta?.issue),
      bypasses: recorded,
    };
  }
  if (f.stage !== "review") {
    return refuse("wrong-stage", "wrong stage", `Cannot archive '${name}': feature is in stage "${f.stage}". Archive only from review (run: kf stage ${name} review first).`);
  }

  // The merged PR must be this item's branch, or its head commit proves nothing about the
  // commits about to be deleted.
  const itemBranch = f.meta?.worktree?.branch ?? null;
  if (merge.kind === "merged" && itemBranch && merge.headRefName !== itemBranch) {
    return refuse("pr-branch", "pr branch mismatch", `Cannot archive '${name}': PR ${merge.pr} merged ${merge.headRefName}, not the item branch ${itemBranch}. Fix the recorded pr link, then re-run: ${rerun}`);
  }
  // Commits pushed after the merge (repair rounds) never reached the default branch: closing
  // as delivered would stamp a tree the PR did not ship.
  const past = merge.kind === "merged" && itemBranch ? tipPastMergedHead(root, itemBranch, merge.headRefOid) : null;
  if (merge.kind === "merged" && itemBranch && past && past.count > 0) {
    return refuse("pr-branch", "branch past merged head", `Cannot archive '${name}': the item branch ${itemBranch} is at ${past.tip.slice(0, 12)}, ${past.count} commits past ${merge.headRefOid.slice(0, 12)} that PR ${merge.pr} merged — those commits were not delivered. Land them in a follow-up PR or drop them, then reset ${itemBranch} to ${merge.headRefOid.slice(0, 12)} and re-run: ${rerun}`);
  }

  // Read now: the item folder moves to done before the outcome is built.
  const reviewNote = merge.kind === "merged" ? reviewMismatch(f.dir, merge.headRefOid) : null;
  const legacyDocsNote = legacyDocsWarning(f);

  // Landing rule: with no PR to verify, `landing: none` may close only when the item branch
  // carries nothing — otherwise unpushed work would be counted as delivered.
  const landing = reviewLanding(f.dir);
  const ahead = !f.meta?.pr && itemBranch && branchExists(root, itemBranch) ? commitsAhead(root, itemBranch) : null;
  if (ahead && landing === "none" && ahead.count > 0) {
    return refuse("landing-commits", "landing none with commits", `Cannot archive '${name}': landing: none but the branch has ${ahead.count} commits — open a PR or cancel.${ahead.note ? ` (${ahead.note})` : ""}`);
  }
  // What lets the branch be deleted. Without a merged PR only `landing: none` on a branch with
  // 0 commits ahead does; a forced close never makes up for that — it keeps the branch.
  const proof: LandedProof = merge.kind === "merged"
    ? { kind: "merged-head", sha: merge.headRefOid }
    : ahead && landing === "none" && ahead.count === 0 && !ahead.againstHead
      ? { kind: "base-tip", sha: ahead.tip }
      : {
          kind: "none",
          detail: ahead && ahead.count > 0
            ? `${ahead.count} commits and no merged PR to prove they landed — never deleted, even with --force`
            : ahead?.againstHead
              ? `0 commits ahead of the checkout's HEAD is no proof they landed: origin/HEAD is not set, so the default branch is unknown`
              : "no merged PR and no landing: none on a branch with 0 commits to prove its work landed",
        };

  const force = Boolean(opts.force);
  const forcedCodes: string[] = [];
  const check = validateFeature({ ...f, stage: "done" }, false, true);
  if (!check.valid) {
    if (!force) {
      return refuseChecks("gate", "gate failed", `Gate failed for '${name}'. Fix validation before archiving:\n\n${renderValidateText(check)}\n\nOr re-run with --force.`, check.issues);
    }
    forcedCodes.push(...check.issues.filter((i) => i.severity === "ERROR").map((i) => i.code));
  }

  // Directional gate: only a PASS review-report may enter done.
  const direction = checkDirectionGate(f, "done", merge.kind === "merged");
  if (direction.length > 0) {
    if (!force) {
      const lines = direction.map((i) => `  [${i.severity}] ${i.file}: ${i.message} (${i.code})`).join("\n");
      return refuseChecks("direction", "direction gate failed", `Cannot archive '${name}' — review result does not allow done:\n\n${lines}\n\nOr re-run with --force.`, direction);
    }
    forcedCodes.push(...direction.map((i) => i.code));
  }

  const dest = stageDir(root, "done");
  const target = join(dest, f.folder);
  if (existsSync(target)) {
    return refuse("target-exists", "target exists", `Target already exists: ${target}`);
  }

  // A dirty worktree refuses before the hook: the hook closes the issue and moves the board,
  // which must not happen for an item that then stays in review.
  const wtCfg = f.meta?.worktree ? worktreeConfig(root, readProjectConfig(root).worktree) : null;
  if (wtCfg) {
    try {
      assertWorktreeClean(root, f);
    } catch (err) {
      return refuse("worktree-dirty", "worktree dirty", `Cannot archive '${name}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Phase hook: run the 'done' hook before archiving (unless --skip-hooks).
  const skipHooks = Boolean(opts.skipHooks);
  const skippedHook: HookSource | null = skipHooks ? resolveHook(root, "done") : null;
  let ranHook: HookSource | null = null;
  if (!skipHooks) {
    const hook = runHook(root, {
      feature: f.name,
      context: f.context,
      dir: f.dir,
      root,
      from: f.stage,
      to: "done",
      approval: f.meta?.approval?.status ?? "pending",
    });
    if (hook.ran && !hook.ok) return hookFailed(hook);
    if (hook.ran) ranHook = hook.hook;
  }

  const afterHook = validateFeature({ ...f, stage: "done" }, false, true);
  if (!afterHook.valid && !force) return refuseChecks("gate", "gate failed", renderValidateText(afterHook), afterHook.issues);
  if (!f.meta) return refuse("metadata-missing", "metadata missing", "Feature metadata is missing.");

  // Every gate held and the hook ran: from here on the close is irreversible. Removing a CLEAN
  // worktree is safe — its work has landed (merged PR) or there was none (landing: none, 0
  // commits). Teardown re-checks dirtiness as a guard against a change since the check above.
  let teardown: TeardownResult | null = null;
  if (f.meta.worktree && wtCfg) {
    const where = f.meta.worktree.path;
    const wasOnDisk = existsSync(where);
    try {
      teardown = await teardownWorktree(root, f, wtCfg);
    } catch (err) {
      const hookRan = ranHook ? ` The done hook already ran (${ranHook.path}).` : "";
      // Teardown checks dirtiness before it removes anything; any other failure may come after
      // `git worktree remove`, so say what is left on disk.
      if (err instanceof WorktreeDirtyError) {
        return refuse("worktree-dirty", "worktree dirty", `Cannot archive '${name}': ${err.message}${hookRan} Nothing was removed. Then re-run: ${rerun}`);
      }
      const left = existsSync(where)
        ? `The worktree ${where} is still on disk.`
        : wasOnDisk ? `The worktree ${where} was removed.` : `The worktree ${where} is not on disk.`;
      return refuse("teardown-failed", "teardown failed", `Cannot archive '${name}': worktree teardown failed: ${err instanceof Error ? err.message : String(err)}.${hookRan} ${left} The branch was not deleted. Fix the cause, then re-run: ${rerun}`);
    }
  }
  const branch = f.meta.worktree ? deleteItemBranch(root, f.meta.worktree.branch, proof) : null;

  const recorded = recordBypasses(f.stage, "done", forcedCodes, skippedHook);
  const stale = await withLock(root, f.name, async (): Promise<ArchiveOutcome | null> => {
    const cur = findFeature(root, f.name);
    if (!cur?.meta || cur.stage !== f.stage || cur.dir !== f.dir) {
      return refuse("changed-concurrently", "changed concurrently", `Cannot archive '${name}': it changed while the archive was running.${alreadyRemoved(teardown, f.meta?.worktree?.path ?? null, branch)} Re-run: ${rerun}`);
    }
    const originalMeta = readFileSync(join(cur.dir, METADATA_FILE), "utf8");
    const before = { stage: cur.stage, meta: sharedMeta(cur.meta) };
    let moved = false;
    try {
      // Move → meta stamp.
      await mkdir(dest, { recursive: true });
      await rename(cur.dir, target);
      moved = true;
      // `delivered` is the terminal fact — written last, after every other side effect landed.
      const stamped = withItemId({
        ...cur.meta,
        bypasses: recorded.length > 0 ? [...(cur.meta.bypasses ?? []), ...recorded] : cur.meta.bypasses,
        status: "archived",
        worktree: undefined,
        delivered: true,
        deliveredAt: new Date().toISOString(),
      });
      await writeFeatureMeta(target, stamped);
      // Only after the stamp: a failed stamp moves the folder back, and a record in it would travel along.
      recordChange(root, target, name, "delivered", before, { stage: "done", meta: sharedMeta(stamped) });
    } catch (err) {
      const failures: unknown[] = [];
      if (moved) {
        for (const undo of [() => writeFileAtomic(join(target, METADATA_FILE), originalMeta), () => rename(target, cur.dir)]) {
          try {
            await undo();
          } catch (rollbackError) {
            failures.push(rollbackError);
          }
        }
      }
      const removed = alreadyRemoved(teardown, f.meta?.worktree?.path ?? null, branch);
      if (failures.length > 0) throw new AggregateError([err, ...failures], `Archive failed and rollback was incomplete for '${name}'.${removed}`);
      throw new Error(`Archive failed for '${name}' (${err instanceof Error ? err.message : String(err)}); feature restored to review (move and metadata rolled back).${removed} Fix the cause, then finish with: ${rerun}`, { cause: err });
    }
    return null;
  });
  if (stale) return stale;

  return {
    kind: "archived",
    name,
    from: f.stage,
    dir: target,
    hasIssue: Boolean(f.meta?.issue),
    bypasses: recorded,
    teardown,
    worktreePath: f.meta?.worktree?.path ?? null,
    branch,
    countNote: ahead?.note ?? null,
    pr: f.meta?.pr ?? null,
    reviewNote,
    legacyDocsNote,
  };
}

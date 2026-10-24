import { rename, rm } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";

import { findFeature, stageDir, writeFeatureMeta, type Bypass, type Cancellation } from "./features.js";
import { withLock } from "../shared/lock.js";
import { findSecretLike } from "./validate.js";
import { runningRun } from "../harness/run.js";
import { runHook, resolveHook, type HookResult, type HookSource } from "../integrations/hooks.js";
import { readProjectConfig } from "../project/config.js";
import { nowTimestamp } from "../shared/time.js";
import { canonicalDocPaths } from "./canonical-docs.js";
import { recordBypasses } from "./bypass.js";
import { worktreeConfig } from "../worktree/config.js";
import { teardownWorktree, type TeardownResult } from "../worktree/lifecycle.js";

export interface CancelOptions {
  /** Raw reason as given; trimmed here. Empty or credential-like is refused. */
  reason: string;
  /** Raw `--by`; blank falls back to the configured reviewer, then "human". */
  by?: string;
  force?: boolean;
  skipHooks?: boolean;
  purgeDocs?: boolean;
  /**
   * Asks a human whether the listed canonical docs may be deleted. Absent means nobody can be
   * asked (no TTY), so a purge without `force` is refused rather than assumed.
   */
  confirmPurge?: (docs: string[]) => Promise<boolean>;
}

/** Why a cancel was refused. Each maps 1:1 to the stderr tag `kf cancel` has always printed. */
export type CancelRefusalReason =
  | "missing-reason"
  | "secret-in-reason"
  | "unknown-item"
  | "already-cancelled"
  | "metadata-missing"
  | "run-in-progress"
  | "purge-unconfirmed"
  | "worktree-dirty"
  | "changed-concurrently";

export type CancelOutcome =
  | {
      kind: "cancelled";
      reason: string;
      by: string;
      cancellation: Cancellation;
      /** Where the item folder now lives. */
      target: string;
      /** Canonical docs of an archived item, absolute paths; empty for any other stage. */
      docs: string[];
      purged: boolean;
      teardown: TeardownResult | null;
      bypasses: Bypass[];
    }
  /** The human declined the purge prompt, so nothing was touched. */
  | { kind: "kept"; stdout: string }
  | { kind: "refused"; reason: CancelRefusalReason; stdout: string; stderrTag: string }
  | { kind: "hook-failed"; hook: HookResult; stdout: string; stderrTag: string }
  | { kind: "error"; error: unknown };

const refuse = (reason: CancelRefusalReason, stderrTag: string, stdout: string): CancelOutcome => ({ kind: "refused", reason, stdout, stderrTag });

/**
 * The reason checks on their own, because `kf cancel` has always reported a missing reason before
 * it looks for a project — the CLI runs this ahead of `findRoot` to keep that order.
 */
export function refuseReason(name: string, rawReason: string): CancelOutcome | null {
  const reason = rawReason.trim();
  if (!reason) {
    return refuse("missing-reason", "missing reason", 'Cancelling needs a reason: kf cancel ' + name + ' --reason "<why it is being dropped>"');
  }
  if (findSecretLike(reason).length > 0) {
    return refuse("secret-in-reason", "secret in reason", "The reason looks like it contains a credential; rewrite it without the secret.");
  }
  return null;
}

/**
 * Stop a work item for good: gates, hook, optional doc purge, worktree teardown and the move into
 * `cancelled`. Pure of CLI concerns; callers render the outcome. Anything that used to propagate
 * as a throw comes back as `{ kind: "error" }`.
 */
export async function cancelItem(root: string, name: string, opts: CancelOptions): Promise<CancelOutcome> {
  try {
    return await runCancel(root, name, opts);
  } catch (error) {
    return { kind: "error", error };
  }
}

async function runCancel(root: string, name: string, opts: CancelOptions): Promise<CancelOutcome> {
  const badReason = refuseReason(name, opts.reason);
  if (badReason) return badReason;
  const reason = opts.reason.trim();

  const f = findFeature(root, name);
  if (!f) return refuse("unknown-item", "unknown feature", `Unknown feature '${name}'. Run: kf list`);
  if (f.stage === "cancelled") {
    return refuse("already-cancelled", "already cancelled", `'${name}' is already cancelled (${f.meta?.cancellation?.reason ?? "no reason recorded"}).`);
  }
  if (!f.meta) return refuse("metadata-missing", "metadata missing", "Feature metadata is missing.");

  const force = Boolean(opts.force);
  const forcedCodes: string[] = [];
  const active = runningRun(f);
  if (active) {
    if (!force) {
      return refuse("run-in-progress", "run in progress", `Run ${active.id} (${active.role} @ ${active.stage}) is still running for '${name}'. Wait for it, or re-run with --force.`);
    }
    forcedCodes.push("run_in_progress");
  }

  const skipHooks = Boolean(opts.skipHooks);
  const skippedHook: HookSource | null = skipHooks ? resolveHook(root, "cancelled") : null;
  if (!skipHooks) {
    const hook = runHook(root, {
      feature: f.name, context: f.context, dir: f.dir, root,
      from: f.stage, to: "cancelled", approval: f.meta.approval?.status ?? "pending",
    });
    if (hook.ran && !hook.ok) {
      return {
        kind: "hook-failed",
        hook,
        stdout: `Hook 'cancelled' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\nCancel refused.\n\n${hook.output}\n\nRe-run with --skip-hooks to bypass.`,
        stderrTag: "hook failed",
      };
    }
  }

  const docs = f.stage === "dones" ? canonicalDocPaths(root, f) : [];
  let purgeApproved = false;
  if (opts.purgeDocs && docs.length > 0) {
    if (force) {
      purgeApproved = true;
    } else if (!opts.confirmPurge) {
      return refuse(
        "purge-unconfirmed",
        "purge requires interactive confirmation or --force",
        `Refusing to delete canonical docs without confirmation:\n${docs.map((d) => `  ${relative(root, d)}`).join("\n")}\nRe-run with --force.`,
      );
    } else {
      if (!(await opts.confirmPurge(docs))) {
        return { kind: "kept", stdout: `Cancelled nothing. Re-run without --purge-docs to drop the work item and keep the docs.` };
      }
      purgeApproved = true;
    }
  }

  const by = typeof opts.by === "string" && opts.by.trim()
    ? opts.by.trim()
    : readProjectConfig(root).reviewer ?? "human";

  // Same rule as archive: a dirty worktree refuses teardown so uncommitted work cannot be
  // lost by a cancel. The branch is kept either way — a cancelled item may reopen.
  let teardown: TeardownResult | null = null;
  if (f.meta.worktree) {
    const wtCfg = worktreeConfig(root, readProjectConfig(root).worktree);
    try {
      teardown = await teardownWorktree(root, f, wtCfg);
    } catch (err) {
      return refuse("worktree-dirty", "worktree dirty", `Cannot cancel '${name}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const recorded = recordBypasses(f.stage, "cancelled", forcedCodes, skippedHook);
  const cancellation = { at: nowTimestamp(), by, reason, fromStage: f.stage };
  const dest = stageDir(root, "cancelled");
  mkdirSync(dest, { recursive: true });
  const target = join(dest, f.folder);
  const moveError = await withLock(root, f.name, async (): Promise<CancelOutcome | null> => {
    const cur = findFeature(root, f.name);
    if (!cur?.meta || cur.stage !== f.stage || cur.dir !== f.dir) {
      return refuse("changed-concurrently", "changed concurrently", `Cannot cancel '${name}': it changed while the cancel was running. Re-run: kf cancel ${name}`);
    }
    await writeFeatureMeta(cur.dir, {
      ...cur.meta,
      status: "cancelled",
      cancellation,
      worktree: undefined,
      ...(recorded.length > 0 ? { bypasses: [...(cur.meta.bypasses ?? []), ...recorded] } : {}),
    });
    try {
      await rename(cur.dir, target);
    } catch (err) {
      try {
        await writeFeatureMeta(cur.dir, cur.meta);
      } catch (rollbackError) {
        throw new AggregateError([err, rollbackError], `Cancel failed and metadata rollback was incomplete for '${name}'.`);
      }
      throw err;
    }
    return null;
  });
  if (moveError) return moveError;

  // Deleting docs cannot be undone, so it happens only after the move succeeded.
  let purged = false;
  if (purgeApproved) {
    for (const doc of docs) await rm(doc, { recursive: true, force: true });
    purged = true;
  }

  return { kind: "cancelled", reason, by, cancellation, target, docs, purged, teardown, bypasses: recorded };
}

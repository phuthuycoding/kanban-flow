import { mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { TRANSITIONS, type Stage } from "./schema.js";
import { findFeature, stageDir, writeFeatureMeta, type Bypass, type WorktreeRegistration } from "./features.js";
import { validateFeature, checkDirectionGate, renderValidateText } from "./validate.js";
import { withLock } from "../shared/lock.js";
import { runHook, resolveHook, type HookResult, type HookSource } from "../integrations/hooks.js";
import { recordBypasses, bypassNote } from "../cli/commands/helpers.js";
import { readProjectConfig } from "../project/config.js";
import { worktreeConfig } from "../worktree/config.js";
import { ensureWorktree, forceRemoveWorktree } from "../worktree/lifecycle.js";
import { syncBase } from "../project/base-sync.js";

export interface TransitionOptions {
  force?: boolean;
  skipHooks?: boolean;
  cwd: string;
}

/**
 * Why a transition was refused. Each reason maps 1:1 to the short stderr tag `kf stage` has always
 * printed (see REFUSAL_TAGS), so the CLI wrapper loses nothing. `archive-required` is the one reason
 * with no tag: moving into `dones` is archive's job, and the caller decides what to do about it.
 */
export type RefusalReason =
  | "unknown-item"
  | "already-dones"
  | "cancellation-missing"
  | "wrong-reopen-stage"
  | "invalid-transition"
  | "archive-required"
  | "gate"
  | "direction"
  | "target-exists"
  | "metadata-missing"
  | "worktree-setup-failed"
  | "changed-concurrently";

export type TransitionOutcome =
  | {
      kind: "moved";
      from: Stage;
      to: Stage;
      dir: string;
      worktree?: WorktreeRegistration;
      hook?: HookResult;
      bypasses: Bypass[];
      /** True when a cancelled item was put back at the stage it was cancelled from. */
      reopened: boolean;
      stdout: string;
    }
  | { kind: "refused"; reason: RefusalReason; stdout: string; stderrTag: string }
  | { kind: "hook-failed"; hook: HookResult; stdout: string; stderrTag: string }
  | { kind: "error"; error: unknown };

export type Transition = (root: string, name: string, to: Stage, opts: TransitionOptions) => Promise<TransitionOutcome>;

const refuse = (reason: RefusalReason, stderrTag: string, stdout: string): TransitionOutcome => ({ kind: "refused", reason, stdout, stderrTag });

/**
 * Move a work item to `to`: gates, phase hook, worktree provisioning and the move itself. Pure of
 * CLI concerns — it never reads argv and never delegates to another command; callers render the
 * outcome. Anything that used to propagate as a throw comes back as `{ kind: "error" }`.
 */
export const transitionItem: Transition = async (root, name, to, opts) => {
  try {
    return await runTransition(root, name, to, opts);
  } catch (error) {
    return { kind: "error", error };
  }
};

async function runTransition(root: string, name: string, to: Stage, opts: TransitionOptions): Promise<TransitionOutcome> {
  const f = findFeature(root, name);
  if (!f) return refuse("unknown-item", "unknown feature", `Unknown feature '${name}'. Run: kf list`);
  if (f.stage === "dones") return refuse("already-dones", "already dones", `Feature '${name}' is already archived (dones).`);

  // A cancelled item has exactly one way back: the stage it was cancelled from.
  let isReopen = false;
  if (f.stage === "cancelled") {
    const from = f.meta?.cancellation?.fromStage;
    if (!from) {
      return refuse("cancellation-missing", "cancellation missing", `'${name}' is cancelled but its metadata has no fromStage, so kf cannot tell where it belongs. Re-run with --force to place it anywhere.`);
    }
    if (to !== from && !opts.force) {
      return refuse("wrong-reopen-stage", "wrong reopen stage", `Cancelled '${name}' can only be reopened at ${from} (where it was cancelled). Run: kf stage ${name} ${from}`);
    }
    isReopen = to === from;
  }

  const allowed = TRANSITIONS[f.stage];
  if (f.stage !== "cancelled" && !allowed.includes(to)) {
    const desc = allowed.join(", ");
    return refuse("invalid-transition", "not allowed transition", `Cannot move '${name}' ${f.stage} → ${to}. Allowed: ${desc}.`);
  }
  // Reopening into `dones` is putting an item back where it was, not archiving it again. Routing
  // it through archive made `kf cancel`'s own advertised reopen command refuse itself, with no
  // escape: archive rejects a cancelled item before it ever looks at --force. The move happens
  // below, and the archive state it had is restored right after by the caller — see `reopened`.
  if (to === "dones" && !isReopen) return refuse("archive-required", "", "");

  // Gate: feature must be valid for its CURRENT stage before leaving it.
  const force = Boolean(opts.force);
  const forcedCodes: string[] = [];
  // Returning to planning is checked against the brainstorm gate: the requirement must still be
  // confirmed. A cancelled item is exempt — pretending it sits in brainstorm walked straight past
  // the `cancelled` shortcut inside validateFeature, so `kf validate` called the item valid while
  // `kf stage` refused the very reopen `kf cancel` prints, and blamed a stage it was not in. The
  // only way through was --force, which stamps a permanent bypass for a gate that should not hold.
  const check = to === "planning" && f.stage !== "brainstorm" && f.stage !== "cancelled"
    ? validateFeature({ ...f, stage: "brainstorm" }, false, false, readProjectConfig(root).harness)
    : validateFeature(f, false, true, readProjectConfig(root).harness);
  if (!check.valid) {
    if (!force) {
      return refuse("gate", "gate failed", `Gate failed for '${name}' (${f.stage}). Fix validation before moving:\n\n${renderValidateText(check)}\n\nOr re-run with --force.`);
    }
    forcedCodes.push(...check.issues.filter((i) => i.severity === "ERROR").map((i) => i.code));
  }

  // Directional gate: PASS/FAIL/REQUIREMENT_BUG semantics of the reports.
  const direction = checkDirectionGate(f, to);
  if (direction.length > 0) {
    if (!force) {
      const lines = direction.map((i) => `  [${i.severity}] ${i.file}: ${i.message} (${i.code})`).join("\n");
      return refuse("direction", "direction gate failed", `Cannot move '${name}' ${f.stage} → ${to} — report status blocks this direction:\n\n${lines}\n\nOr re-run with --force.`);
    }
    forcedCodes.push(...direction.map((i) => i.code));
  }

  // Freshness: before planning surveys code or implementation cuts the worktree
  // branch, fast-forward the base checkout to upstream — a transition that is
  // going to fail (gates above) never reaches this.
  let baseNote = "";
  if (to === "planning" || to === "implementation") {
    const sync = syncBase(root);
    if (sync.warning) baseNote = `\n  ⚠ ${sync.warning}`;
    else if (sync.note) baseNote = `\n  ${sync.note}`;
  }

  // Phase hook: run the hook of the stage we are entering (before the move).
  // If it exits non-zero the transition is refused, unless skipHooks.
  const skipHooks = Boolean(opts.skipHooks);
  let hookResult: HookResult | null = null;
  const skippedHook: HookSource | null = skipHooks ? resolveHook(root, to) : null;
  if (!skipHooks) {
    hookResult = runHook(root, {
      feature: f.name,
      context: f.context,
      dir: f.dir,
      root,
      from: f.stage,
      to,
      approval: to === "planning" ? "pending" : f.meta?.approval?.status ?? "pending",
    });
    if (hookResult.ran && !hookResult.ok) {
      return {
        kind: "hook-failed",
        hook: hookResult,
        stdout:
          `Hook '${to}' failed (exit ${hookResult.code})${hookResult.hook ? ` [${hookResult.hook.path}]` : ""}.\nTransition refused.\n\n${hookResult.output}\n\nRe-run with --skip-hooks to bypass.`,
        stderrTag: "hook failed",
      };
    }
  }

  const dest = stageDir(root, to);
  const target = join(dest, f.folder);
  if (existsSync(target)) return refuse("target-exists", "target exists", `Target already exists: ${target}`);
  if (!f.meta) return refuse("metadata-missing", "metadata missing", "Feature metadata is missing.");

  // Worktree lifecycle: entering implementation provisions the environment. Fail-closed —
  // a work item implementing on the user's main checkout is exactly what this prevents.
  // Only a newly created worktree is rolled back below; a reused one (re-enter after FAIL)
  // stays, because it predates this transition.
  let worktree: WorktreeRegistration | null = null;
  const wtCfg = worktreeConfig(root, readProjectConfig(root).worktree);
  if (to === "implementation" && wtCfg.enabled) {
    try {
      worktree = await ensureWorktree(root, f, wtCfg);
    } catch (err) {
      return refuse(
        "worktree-setup-failed",
        "worktree setup failed",
        `Cannot move '${name}' to implementation — worktree setup failed:\n  ${err instanceof Error ? err.message : String(err)}\n\nFix that, or set "worktree.enabled": false in .kf/config.json.`,
      );
    }
  }

  const recorded = recordBypasses(f.stage, to, forcedCodes, skippedHook);
  const removeNewWorktree = async (): Promise<void> => {
    if (worktree && !f.meta!.worktree) {
      try {
        await forceRemoveWorktree(root, { ...f, meta: { ...f.meta!, worktree } }, wtCfg);
      } catch {
        /* best-effort rollback — the failed move is the error that matters */
      }
    }
  };
  try {
    // Only the re-read, the write and the rename hold the lock — gates, hooks and the worktree stay outside.
    const refused = await withLock(root, f.name, async (): Promise<TransitionOutcome | null> => {
      const cur = findFeature(root, f.name);
      if (!cur?.meta || cur.stage !== f.stage || cur.dir !== f.dir) {
        return refuse("changed-concurrently", "changed concurrently", `Cannot move '${name}': it changed while the transition was running. Re-run: kf stage ${name} ${to}`);
      }
      if (existsSync(target)) return refuse("target-exists", "target exists", `Target already exists: ${target}`);
      let metadataUpdated = false;
      try {
        let meta = recorded.length > 0 ? { ...cur.meta, bypasses: [...(cur.meta.bypasses ?? []), ...recorded] } : cur.meta;
        if (worktree) meta = { ...meta, worktree };
        // Putting an item back in `dones` means putting back the state it had there. `status` does
        // not depend on validation, so restore it here rather than leaving it to the doc re-sync,
        // which can legitimately refuse on an item that was never fully valid.
        if (cur.stage === "cancelled") meta = { ...meta, cancellation: undefined, status: isReopen && to === "dones" ? "archived" : undefined };
        if (to === "planning") {
          await writeFeatureMeta(cur.dir, { ...meta, approval: { status: "pending" }, executionId: undefined });
          metadataUpdated = true;
        } else if (to === "testing" || to === "implementation") {
          await writeFeatureMeta(cur.dir, { ...meta, executionId: to === "testing" ? randomUUID() : undefined });
          metadataUpdated = true;
        } else if (recorded.length > 0 || cur.stage === "cancelled" || worktree) {
          await writeFeatureMeta(cur.dir, meta);
          metadataUpdated = true;
        }
        await mkdir(dest, { recursive: true });
        await rename(cur.dir, target);
      } catch (err) {
        if (metadataUpdated) {
          try {
            await writeFeatureMeta(cur.dir, cur.meta);
          } catch (rollbackError) {
            throw new AggregateError([err, rollbackError], `Transition failed and metadata rollback was incomplete for '${name}'.`);
          }
        }
        throw err;
      }
      return null;
    });
    if (refused) {
      await removeNewWorktree();
      return refused;
    }
  } catch (err) {
    await removeNewWorktree();
    throw err;
  }
  const hookNote = hookResult?.ran ? `\n  Hook '${to}' ran [${hookResult.hook?.source ?? ""}]` : "";
  const worktreeNote = worktree ? `\n  Worktree: ${worktree.path}\n  Domain:   http://${worktree.domain}  (direct: http://127.0.0.1:${worktree.port})` : "";
  return {
    kind: "moved",
    from: f.stage,
    to,
    dir: target,
    ...(worktree ? { worktree } : {}),
    ...(hookResult?.ran ? { hook: hookResult } : {}),
    bypasses: recorded,
    reopened: isReopen,
    stdout: `✓ Moved '${name}' ${f.stage} → ${to}\n  ${target}${baseNote}${worktreeNote}${hookNote}${bypassNote(recorded)}`,
  };
}

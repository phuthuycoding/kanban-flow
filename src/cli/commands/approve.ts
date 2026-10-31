import { updateFeatureMeta, executionContractHash, findFeature } from "../../workflow/features.js";
import { validateFeature, renderValidateText } from "../../workflow/validate.js";
import { transitionItem, type TransitionOutcome } from "../../workflow/transition.js";
import { driveConfigured } from "../../workflow/status.js";
import { readProjectConfig } from "../../project/config.js";
import { worktreeConfig } from "../../worktree/config.js";
import { nowTimestamp } from "../../shared/time.js";
import { resolveItem } from "./helpers.js";
import { taskHarnessNeedsWorktreeMessage } from "./inspect.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/**
 * Human-in-the-Loop gate for Phase 2: the execution contract (implementation
 * plan + use cases + test cases) must be approved before autonomous execution.
 * The approval is also the start decision: the item moves to implementation, or to backlog with --backlog.
 */
export async function cmdApprove(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf approve <feature> [--backlog] [--by <name>]", stderr: "missing feature" };
  const root = await resolveItem(cwd, name);
  if (!root.ok) return root.refusal;
  const f = root.item;

  if (f.stage !== "planning") {
    return {
      code: 1,
      stdout: `Cannot approve '${name}': feature is in stage "${f.stage}". Approval only applies during Phase 2 (planning).`,
      stderr: "wrong stage",
    };
  }

  const check = validateFeature(f, false, false, readProjectConfig(root.root).harness);
  if (!check.valid) {
    return { code: 1, stdout: `Cannot approve an incomplete execution contract:\n${renderValidateText(check)}`, stderr: "invalid contract" };
  }
  const contractHash = executionContractHash(f.dir, f.meta?.kind === "bug" ? "bug" : "feature");
  if (!contractHash || !f.meta) return { code: 1, stdout: "Execution contract or metadata is missing.", stderr: "invalid contract" };
  const cfg = readProjectConfig(root.root);
  const by = typeof args.options.by === "string" ? args.options.by : (cfg.reviewer ?? "human");
  if (!by.trim()) return { code: 1, stdout: "Approver name must not be empty.", stderr: "missing approver" };
  const to = args.options.backlog ? "backlog" : "implementation";
  const warning = !worktreeConfig(root.root, cfg.worktree).enabled && (cfg.harness?.verify?.stage?.length ?? 0) > 0
    ? `⚠ ${taskHarnessNeedsWorktreeMessage(f.name)} (task_harness_needs_worktree)\n`
    : "";

  const previous = { approval: f.meta.approval, executionId: f.meta.executionId };
  const approval = { status: "approved" as const, by, at: nowTimestamp(), contractHash };
  await updateFeatureMeta(root.root, f.name, (meta) => ({ ...meta, approval, executionId: undefined }));
  const outcome = await transitionItem(root.root, f.name, to, { cwd });
  if (outcome.kind !== "moved") {
    // A failed move leaves the item in planning; an `approved` item there would read as started to every skill.
    try {
      await updateFeatureMeta(root.root, f.name, (meta) => ({ ...meta, approval: previous.approval, executionId: previous.executionId }));
    } catch (restoreError) {
      const cause = outcome.kind === "error" ? outcome.error : new Error(failureDetail(outcome, to));
      throw new AggregateError([cause, restoreError], `The move of '${name}' to ${to} failed and its previous approval could not be restored; .kfw.json still records the new approval.`);
    }
    if (outcome.kind === "error") {
      throw new Error(`Approval of '${name}' was not kept: the move to ${to} failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`, { cause: outcome.error });
    }
    return {
      code: 1,
      stdout: `${warning}✗ Approval of '${name}' was not kept: the move planning → ${to} was refused.\n\n${failureDetail(outcome, to)}\n\nFix that, then re-run: kf approve ${name}${to === "backlog" ? " --backlog" : ""}`,
      stderr: outcome.stderrTag,
    };
  }

  const moved = findFeature(root.root, f.name);
  const next = to === "backlog"
    ? `kf stage ${name} implementation`
    : moved && driveConfigured(moved, cfg.harness) ? `kf drive ${name}` : `load the kanban-implement skill for '${name}'`;
  return {
    code: 0,
    stdout: `${warning}✓ Approved '${name}' (by ${by} at ${approval.at}) → ${to}\n  Execution contract is now the binding scope for autonomous phases.\n${outcome.stdout}\nNext: ${next}`,
  };
}

/** Why the move failed, without the `--skip-hooks` / `--force` advice `kf stage` gives: `kf approve` takes neither flag. */
function failureDetail(outcome: Exclude<TransitionOutcome, { kind: "moved" } | { kind: "error" }>, to: string): string {
  if (outcome.kind === "refused") return outcome.stdout;
  const { hook } = outcome;
  return `Hook '${to}' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\n\n${hook.output}`;
}

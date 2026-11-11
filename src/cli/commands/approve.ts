import { updateFeatureMeta, executionContractHash, findFeature, type FeatureMeta } from "../../workflow/features.js";
import { validateFeature, renderValidateText } from "../../workflow/validate.js";
import { FORCE_RETRY_HINT, stageRetryHint, transitionItem, type TransitionOutcome } from "../../workflow/transition.js";
import { readProjectConfig } from "../../project/config.js";
import { nowTimestamp } from "../../shared/time.js";
import { resolveItem } from "./helpers.js";
import type { Stage } from "../../workflow/schema.js";
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

  const check = validateFeature(f, false, false);
  if (!check.valid) {
    return { code: 1, stdout: `Cannot approve an incomplete execution contract:\n${renderValidateText(check)}`, stderr: "invalid contract" };
  }
  const contractHash = executionContractHash(f.dir, f.meta?.kind === "bug" ? "bug" : "feature");
  if (!contractHash || !f.meta) return { code: 1, stdout: "Execution contract or metadata is missing.", stderr: "invalid contract" };
  const cfg = readProjectConfig(root.root);
  const by = typeof args.options.by === "string" ? args.options.by : (cfg.reviewer ?? "human");
  if (!by.trim()) return { code: 1, stdout: "Approver name must not be empty.", stderr: "missing approver" };
  const to = args.options.backlog ? "backlog" : "implementation";
  const previous = { approval: f.meta.approval, executionId: f.meta.executionId };
  const approval = { status: "approved" as const, by, at: nowTimestamp(), contractHash, livingDocs: true as const };
  await updateFeatureMeta(root.root, f.name, (meta) => ({ ...meta, approval, executionId: undefined }));
  const outcome = await transitionItem(root.root, f.name, to, { cwd });
  if (outcome.kind !== "moved") {
    // A failed move leaves the item in planning; an `approved` item there would read as started to every skill.
    let notRestored = "";
    try {
      notRestored = await restoreApproval(root.root, f.name, approval, previous);
    } catch (restoreError) {
      const cause = outcome.kind === "error" ? outcome.error : new Error(failureDetail(outcome, name, to));
      throw new AggregateError([cause, restoreError], `The move of '${name}' to ${to} failed and its previous approval could not be restored; .kfw.json still records the new approval.`);
    }
    if (outcome.kind === "error") {
      throw new Error(`Approval of '${name}' was not kept: the move to ${to} failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}${notRestored ? ` (${notRestored})` : ""}`, { cause: outcome.error });
    }
    return {
      code: 1,
      stdout: `✗ Approval of '${name}' was not kept: the move planning → ${to} was refused.\n\n${failureDetail(outcome, name, to)}${notRestored ? `\n\n⚠ ${notRestored}` : ""}\n\nFix that, then re-run: kf approve ${name}${to === "backlog" ? " --backlog" : ""}`,
      stderr: outcome.stderrTag,
    };
  }

  const next = to === "backlog" ? `kf stage ${name} implementation` : `load the kf:implement skill for '${name}'`;
  return {
    code: 0,
    stdout: `✓ Approved '${name}' (by ${by} at ${approval.at}) → ${to}\n  Execution contract is now the binding scope for autonomous phases.\n${outcome.stdout}\nNext: ${next}`,
  };
}

/**
 * Put the approval back as it was before this run, but only while the item is still in planning and still carries
 * the approval this run wrote; anything else means someone moved or re-approved it meanwhile, and their state wins.
 * Returns why nothing was restored, or "" when it was.
 */
async function restoreApproval(
  root: string,
  name: string,
  ours: NonNullable<FeatureMeta["approval"]>,
  previous: Pick<FeatureMeta, "approval" | "executionId">,
): Promise<string> {
  const current = findFeature(root, name);
  if (!current) return `the previous approval was not restored: '${name}' is gone; nothing was changed`;
  if (current.stage !== "planning") return `the previous approval was not restored: '${name}' is in ${current.stage} now; its metadata is left as it is`;
  let changed = false;
  await updateFeatureMeta(root, name, (meta) => {
    const a = meta.approval;
    if (a?.status !== ours.status || a.at !== ours.at || a.by !== ours.by || a.contractHash !== ours.contractHash) {
      changed = true;
      return meta;
    }
    return { ...meta, approval: previous.approval, executionId: previous.executionId };
  });
  return changed ? `the previous approval was not restored: '${name}' was approved again meanwhile; its metadata is left as it is` : "";
}

/**
 * Why the move failed, with the retry advice of `kf stage` (--force, --skip-hooks, kf stage <feature> <stage>)
 * left out: `kf approve` takes no bypass flag, and the caller prints the approve retry instead.
 */
function failureDetail(outcome: Exclude<TransitionOutcome, { kind: "moved" } | { kind: "error" }>, name: string, to: Stage): string {
  if (outcome.kind === "refused") {
    return outcome.stdout.replace(`\n\n${FORCE_RETRY_HINT}`, "").replace(` ${stageRetryHint(name, to)}`, "");
  }
  const { hook } = outcome;
  return `Hook '${to}' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\n\n${hook.output}`;
}

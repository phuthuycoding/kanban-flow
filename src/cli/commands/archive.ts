import { archiveItem, type ArchiveOutcome } from "../../workflow/archive.js";
import { bypassNote } from "../../workflow/bypass.js";
import type { BranchDeletion, TeardownResult } from "../../worktree/lifecycle.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/** The refusal of a docs flag an earlier release had: the close no longer touches docs/. */
export function removedDocsFlag(flag: string): CmdResult {
  return { code: 1, stdout: `--${flag} was removed: living docs are edited at review (docs/specs/); see kf instruct living-doc`, stderr: "removed flag" };
}

function issueNote(hasIssue: boolean): string {
  return hasIssue ? "" : "\n  ⚠ no linked issue — tracker has no delivery record.";
}

function worktreeNote(teardown: TeardownResult, path: string | null): string {
  return `\n  Worktree removed: ${path ?? ""}` +
    teardown.warnings.map((w) => `\n  ⚠ ${w}`).join("");
}

function branchNote(branch: BranchDeletion): string {
  const local = branch.local.kind === "deleted" ? "deleted locally" : branch.local.kind === "absent" ? "already gone locally"
    : branch.local.kind === "kept" ? "kept locally" : "NOT deleted locally";
  const remote = branch.remote.kind === "deleted" ? ", deleted on origin"
    : branch.remote.kind === "absent" ? ", not on origin"
    : branch.remote.kind === "no-remote" ? ""
    : branch.remote.kind === "moved" || branch.remote.kind === "kept" ? ", kept on origin" : ", NOT deleted on origin";
  return `\n  Branch ${branch.branch}: ${local}${remote}` +
    (branch.local.kind === "kept" ? `\n  ⚠ kept ${branch.branch}: ${branch.local.detail}` : "") +
    (branch.local.kind === "failed" ? `\n  ⚠ git branch -D ${branch.branch}: ${branch.local.detail}` : "") +
    (branch.remote.kind === "refused" ? `\n  ⚠ origin kept ${branch.branch} (never forced): ${branch.remote.detail}` : "") +
    (branch.remote.kind === "moved" ? `\n  ⚠ origin kept ${branch.branch}: it is at ${branch.remote.sha.slice(0, 12)}, not the commit that landed` : "") +
    (branch.remote.kind === "kept" && branch.local.kind !== "kept" ? `\n  ⚠ origin kept ${branch.branch}: ${branch.remote.detail}` : "");
}

/** Worktree, branch and legacy-docs lines of a close, shared by kf archive, kf status and kf sync. */
export function closeDetails(outcome: Extract<ArchiveOutcome, { kind: "archived" }>): string {
  const removed = outcome.teardown ? worktreeNote(outcome.teardown, outcome.worktreePath) : "";
  const counted = outcome.countNote ? `\n  ⚠ ${outcome.countNote}` : "";
  const reviewed = outcome.reviewNote ? `\n  ⚠ ${outcome.reviewNote}` : "";
  const legacy = outcome.legacyDocsNote ? `\n  ⚠ ${outcome.legacyDocsNote}` : "";
  return `${removed}${outcome.branch ? branchNote(outcome.branch) : ""}${counted}${reviewed}${legacy}`;
}

function renderArchived(outcome: Extract<ArchiveOutcome, { kind: "archived" }>): string {
  return `✓ Archived '${outcome.name}'  review → done\n  ${outcome.dir}\n  Delivery finalized — \`delivered\` stamped in .kfw.json.${issueNote(outcome.hasIssue)}${closeDetails(outcome)}${bypassNote(outcome.bypasses)}`;
}

/** The docs lines of a reconcile: what happened to the recorded docs branch, if there is one. */
function reconciledDocs(outcome: Extract<ArchiveOutcome, { kind: "reconciled" }>): string {
  const d = outcome.docsBranch;
  if (!d) return "";
  switch (d.kind) {
    case "waiting":
      return `\nCanonical docs wait on ${d.branch}${d.reason ? ` — not proven merged (${d.reason})` : ""}${d.push ? `: git push -u origin ${d.branch}, then open a PR for it` : ""} — nothing rewritten.`;
    case "landed":
      return `\nCanonical docs from ${d.branch} are on origin's default branch — recorded as landed, nothing rewritten.`;
    case "relanded":
      return `\nCanonical docs ${d.unproven ? `not proven landed (${d.unproven})` : "never landed"}; committed again to ${d.branch}, not pushed (${d.why}):` +
        outcome.docs.map((doc) => `\n  ${doc}`).join("") +
        (d.unproven ? `\n  ⚠ If the earlier PR did merge, this PR reverts later edits to these docs: do not merge it.` : "") +
        `\nCommit hooks were skipped for this kf-authored docs commit (--no-verify); run them before pushing if the repo relies on them.` +
        `\nPush it: git push -u origin ${d.branch}, then open a PR for it.`;
  }
}

function renderReconciled(outcome: Extract<ArchiveOutcome, { kind: "reconciled" }>): string {
  const delivered = outcome.alreadyDelivered
    ? "\n  Delivery finalized — item was already marked delivered; side effects re-checked."
    : "\n  Delivery finalized — `delivered` stamped in .kfw.json.";
  return `Feature '${outcome.name}' is already in done.${reconciledDocs(outcome)}${delivered}${issueNote(outcome.hasIssue)}${bypassNote(outcome.bypasses)}`;
}

/** Render an archive outcome the way `kf archive` prints it. An `error` outcome is rethrown. */
export function renderArchive(outcome: ArchiveOutcome): CmdResult {
  switch (outcome.kind) {
    case "error":
      throw outcome.error;
    case "refused":
    case "hook-failed":
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "archived":
      return { code: 0, stdout: renderArchived(outcome) };
    case "reconciled":
      return { code: 0, stdout: renderReconciled(outcome) };
  }
}

export async function cmdArchive(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf archive <feature>", stderr: "missing feature" };
  if (args.options["skip-specs"]) return removedDocsFlag("skip-specs");
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  return renderArchive(await archiveItem(root.root, name, {
    force: Boolean(args.options.force),
    skipHooks: Boolean(args.options["skip-hooks"]),
  }));
}

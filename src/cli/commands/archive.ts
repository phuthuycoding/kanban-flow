import { archiveItem, type ArchiveOutcome } from "../../workflow/archive.js";
import { bypassNote } from "../../workflow/bypass.js";
import type { BranchDeletion, TeardownResult } from "../../worktree/lifecycle.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export { canonicalContent, canonicalDocPaths, type CanonicalKind } from "../../workflow/canonical-docs.js";

function canonicalBlock(docs: string[], skipSpecs: boolean, indent: string): string {
  if (docs.length > 0) return `${indent}Canonical docs synced:\n${docs.map((d) => `${indent}  ${d}`).join("\n")}`;
  return `${indent}${skipSpecs ? "(--skip-specs: canonical docs not touched)" : "(no canonical docs synced)"}`;
}

function issueNote(hasIssue: boolean): string {
  return hasIssue ? "" : "\n  ⚠ no linked issue — tracker has no delivery record.";
}

function worktreeNote(teardown: TeardownResult, path: string | null): string {
  return `\n  Worktree removed: ${path ?? ""}` +
    teardown.taskBranches.map((b) => `\n  kept task branch: ${b}`).join("") +
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

/** Where the docs went, when that is not the plain working-tree sync `canonicalBlock` already prints. */
function docsBranchNote(outcome: Extract<ArchiveOutcome, { kind: "archived" }>): string {
  if (outcome.docsOn === "tree") return outcome.docsNote ? `\n  ⚠ ${outcome.docsNote}` : "";
  const why = outcome.docsNote ? ` (${outcome.docsNote})` : "";
  if (!outcome.docsBranch) return `\n  Canonical docs already current on origin's default branch${why} — nothing committed.`;
  return `\n  Canonical docs committed to ${outcome.docsBranch}, not pushed${why}:` +
    outcome.docs.map((d) => `\n    ${d}`).join("") +
    `\n  Commit hooks were skipped for this kf-authored docs commit (--no-verify); run them before pushing if the repo relies on them.` +
    `\n  Push it: git push -u origin ${outcome.docsBranch}, then open a PR for it.`;
}

/** Worktree, branch and docs lines of a close, shared by kf archive, kf status and kf sync. */
export function closeDetails(outcome: Extract<ArchiveOutcome, { kind: "archived" }>): string {
  const removed = outcome.teardown ? worktreeNote(outcome.teardown, outcome.worktreePath) : "";
  const counted = outcome.countNote ? `\n  ⚠ ${outcome.countNote}` : "";
  return `${removed}${outcome.branch ? branchNote(outcome.branch) : ""}${counted}${docsBranchNote(outcome)}`;
}

function renderArchived(outcome: Extract<ArchiveOutcome, { kind: "archived" }>): string {
  const docs = outcome.docsOn === "tree" ? `\n${canonicalBlock(outcome.docs, outcome.skipSpecs, "  ")}` : "";
  return `✓ Archived '${outcome.name}'  review → done\n  ${outcome.dir}${docs}\n  Delivery finalized — \`delivered\` stamped in .kfw.json.${issueNote(outcome.hasIssue)}${closeDetails(outcome)}${bypassNote(outcome.bypasses)}`;
}

/** The docs lines of a reconcile: the plain resync, or what happened to the recorded docs branch. */
function reconciledDocs(outcome: Extract<ArchiveOutcome, { kind: "reconciled" }>): string {
  const d = outcome.docsBranch;
  if (!d) return canonicalBlock(outcome.docs, outcome.skipSpecs, "");
  switch (d.kind) {
    case "waiting":
      return `Canonical docs wait on ${d.branch}${d.push ? `: git push -u origin ${d.branch}, then open a PR for it` : ""} — nothing rewritten.`;
    case "landed":
      return `Canonical docs from ${d.branch} are on origin's default branch — recorded as landed, nothing rewritten.`;
    case "relanded":
      return `Canonical docs never landed; committed again to ${d.branch}, not pushed (${d.why}):` +
        outcome.docs.map((doc) => `\n  ${doc}`).join("") +
        `\nCommit hooks were skipped for this kf-authored docs commit (--no-verify); run them before pushing if the repo relies on them.` +
        `\nPush it: git push -u origin ${d.branch}, then open a PR for it.`;
    case "tree":
      return canonicalBlock(outcome.docs, outcome.skipSpecs, "") +
        (d.note ? `\n⚠ ${d.note}` : "") +
        (outcome.docsChanged ? `\n  They replace the docs of ${d.branch}, which never landed: they are in the working tree, not committed — commit them; ${d.branch} stays recorded until they reach origin's default branch.` : "");
  }
}

function renderReconciled(outcome: Extract<ArchiveOutcome, { kind: "reconciled" }>): string {
  const delivered = outcome.alreadyDelivered
    ? "\n  Delivery finalized — item was already marked delivered; side effects re-checked."
    : "\n  Delivery finalized — `delivered` stamped in .kfw.json.";
  return `Feature '${outcome.name}' is already in done.\n${reconciledDocs(outcome)}${delivered}${issueNote(outcome.hasIssue)}${bypassNote(outcome.bypasses)}`;
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
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  return renderArchive(await archiveItem(root.root, name, {
    force: Boolean(args.options.force),
    skipHooks: Boolean(args.options["skip-hooks"]),
    skipSpecs: Boolean(args.options["skip-specs"]),
  }));
}

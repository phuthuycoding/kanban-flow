import { archiveItem, type ArchiveOutcome } from "../../workflow/archive.js";
import { bypassNote } from "../../workflow/bypass.js";
import type { TeardownResult } from "../../worktree/lifecycle.js";
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
  return `\n  Worktree removed: ${path ?? ""} (branch ${teardown.branch} kept)` +
    (teardown.unmergedCommits > 0
      ? `\n  ⚠ ${teardown.branch} has ${teardown.unmergedCommits} commit(s) not merged into HEAD — merge or PR it yourself.`
      : "") +
    teardown.taskBranches.map((b) => `\n  kept task branch: ${b}`).join("") +
    teardown.warnings.map((w) => `\n  ⚠ ${w}`).join("");
}

function renderArchived(outcome: Extract<ArchiveOutcome, { kind: "archived" }>): string {
  const removed = outcome.teardown ? worktreeNote(outcome.teardown, outcome.worktreePath) : "";
  return `✓ Archived '${outcome.name}'  review → dones\n  ${outcome.dir}\n${canonicalBlock(outcome.docs, outcome.skipSpecs, "  ")}\n  Delivery finalized — \`delivered\` stamped in .kfw.json.${issueNote(outcome.hasIssue)}${removed}${bypassNote(outcome.bypasses)}`;
}

function renderReconciled(outcome: Extract<ArchiveOutcome, { kind: "reconciled" }>): string {
  const delivered = outcome.alreadyDelivered
    ? "\n  Delivery finalized — item was already marked delivered; side effects re-checked."
    : "\n  Delivery finalized — `delivered` stamped in .kfw.json.";
  return `Feature '${outcome.name}' is already in dones.\n${canonicalBlock(outcome.docs, outcome.skipSpecs, "")}${delivered}${issueNote(outcome.hasIssue)}${bypassNote(outcome.bypasses)}`;
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

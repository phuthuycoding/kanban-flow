import { relative } from "node:path";

import { selectOption } from "../../project/bootstrap.js";
import { cancelItem, refuseReason } from "../../workflow/cancel.js";
import { findRoot } from "./helpers.js";
import { bypassNote } from "../../workflow/bypass.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/**
 * Stop a work item for good. The reason is mandatory: a cancelled item without
 * one is indistinguishable from a folder someone forgot, which is the state
 * this command exists to replace.
 */
export async function cmdCancel(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: 'Usage: kf cancel <feature> --reason "<why>" [--by <name>] [--purge-docs] [--force] [--skip-hooks]', stderr: "missing feature" };
  const reason = typeof args.options.reason === "string" ? args.options.reason : "";
  const badReason = refuseReason(name, reason);
  if (badReason?.kind === "refused") return { code: 1, stdout: badReason.stdout, stderr: badReason.stderrTag };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };

  const outcome = await cancelItem(root.root, name, {
    reason,
    by: typeof args.options.by === "string" ? args.options.by : undefined,
    force: Boolean(args.options.force),
    skipHooks: Boolean(args.options["skip-hooks"]),
    purgeDocs: Boolean(args.options["purge-docs"]),
    confirmPurge: process.stdin.isTTY
      ? async (docs) => {
        const pick = await selectOption(
          `Delete these canonical docs of '${name}'? (↑/↓ + Enter)\n${docs.map((d) => `  ${relative(root.root, d)}`).join("\n")}`,
          ["Keep them — only cancel the work item", "Delete them"],
        );
        return pick === 1;
      }
      : undefined,
  });
  switch (outcome.kind) {
    case "error":
      throw outcome.error;
    case "refused":
    case "hook-failed":
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "kept":
      return { code: 0, stdout: outcome.stdout };
    case "cancelled":
      break;
  }

  const { docs, purged, teardown, cancellation, by, target } = outcome;
  const docsNote = docs.length === 0
    ? ""
    : purged
      ? `\n  Deleted canonical docs:\n${docs.map((d) => `    ${relative(root.root, d)}`).join("\n")}`
      : `\n  Canonical docs left in place (use --purge-docs to delete them):\n${docs.map((d) => `    ${relative(root.root, d)}`).join("\n")}`;
  const worktreeNote = teardown?.removed || teardown?.unmergedCommits
    ? `\n  Worktree removed (branch ${teardown.branch} kept)` +
      (teardown.unmergedCommits > 0
        ? `\n  ⚠ ${teardown.branch} has ${teardown.unmergedCommits} commit(s) not merged into HEAD — merge or PR it yourself.`
        : "") +
      teardown.warnings.map((w) => `\n  ⚠ ${w}`).join("")
    : "";
  return {
    code: 0,
    stdout: `✓ Cancelled '${name}' (was ${cancellation.fromStage}) by ${by}\n  Reason: ${outcome.reason.split("\n")[0]}\n  ${target}${docsNote}${worktreeNote}\n  Reopen with: kf stage ${name} ${cancellation.fromStage}${bypassNote(outcome.bypasses)}`,
  };
}

import { archiveItem, type ArchiveOutcome } from "../../workflow/archive.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export { canonicalContent, canonicalDocPaths, type CanonicalKind } from "../../workflow/canonical-docs.js";

/** Render an archive outcome the way `kf archive` prints it. An `error` outcome is rethrown. */
export function renderArchive(outcome: ArchiveOutcome): CmdResult {
  switch (outcome.kind) {
    case "error":
      throw outcome.error;
    case "refused":
    case "hook-failed":
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "archived":
    case "reconciled":
      return { code: 0, stdout: outcome.stdout };
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

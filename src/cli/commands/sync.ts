import { readProjectConfig } from "../../project/config.js";
import { listFeatures } from "../../workflow/features.js";
import { findRoot, noRepository } from "./helpers.js";
import { closeDetails } from "./archive.js";
import { archiveItem } from "../../workflow/archive.js";
import { migrateLegacyStages } from "../../workflow/migrate.js";
import { currentReportStatus } from "../../workflow/status.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/**
 * `kf sync` — the pull-model delivery sweep. Every review/done item with a recorded PR goes
 * through archiveItem, whose merge gate (`gh pr view`) closes the merged ones and refuses the
 * rest; a review item whose current PASS report says `landing: none` closes under the landing
 * rule. Other items without `pr` are never touched. Runnable by hand or from cron/launchd; no
 * daemon. A done item already
 * `delivered` is skipped: the flag is stamped last, so nothing is left to finalize, and its
 * canonical docs may legitimately carry later edits (superseded banners) that a re-archive
 * would refuse on every sweep.
 */
export async function cmdSync(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const migration = await migrateLegacyStages(root.root);
  const repo = readProjectConfig(root.root).repository;
  if (!repo) {
    const refusal = noRepository();
    return migration.lines.length > 0 ? { ...refusal, stdout: `${migration.lines.join("\n")}\n\n${refusal.stdout}` } : refusal;
  }

  const candidates = listFeatures(root.root).filter(
    (f) => ((f.stage === "review" || (f.stage === "done" && !f.meta?.delivered)) && Boolean(f.meta?.pr))
      || (f.stage === "review" && currentReportStatus(f, "review-report") === "PASS"),
  );
  if (candidates.length === 0) {
    return {
      code: migration.failed ? 1 : 0,
      stdout: [...migration.lines, "No PR-linked items awaiting delivery — nothing to sync."].join("\n"),
    };
  }

  const lines: string[] = [...migration.lines];
  let failed = migration.failed;
  for (const f of candidates) {
    const outcome = await archiveItem(root.root, f.name, { trigger: "sync" });
    switch (outcome.kind) {
      case "archived":
        lines.push(`✓ ${f.name}: archived (${outcome.pr ? "PR merged" : "nothing to land"})${closeDetails(outcome)}`);
        break;
      case "reconciled":
        lines.push(`✓ ${f.name}: archived (PR merged)`);
        break;
      case "refused":
        // An unmerged or unverifiable PR is the normal state of a sweep, not a failure.
        if (outcome.merge?.reason === "not-merged") {
          lines.push(outcome.merge.state === "CLOSED"
            ? `⚠ ${f.name}: skipped — ${outcome.merge.pr} was closed without merging; reopen and merge it, or move the item back`
            : `- ${f.name}: skipped (PR ${outcome.merge.state.toLowerCase()})`);
        } else if (outcome.merge) {
          lines.push(`⚠ ${f.name}: could not verify ${outcome.merge.pr} — skipped`);
        } else {
          failed = true;
          lines.push(`✗ ${f.name}: ${outcome.stdout.split("\n")[0]}`);
        }
        break;
      case "hook-failed":
        failed = true;
        lines.push(`✗ ${f.name}: ${outcome.stdout.split("\n")[0]}`);
        break;
      case "error":
        throw outcome.error;
    }
  }
  return { code: failed ? 1 : 0, stdout: lines.join("\n") };
}

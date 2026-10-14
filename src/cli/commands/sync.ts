import { readProjectConfig } from "../../project/config.js";
import { listFeatures } from "../../workflow/features.js";
import { findRoot, gh, noRepository } from "./helpers.js";
import { cmdArchive } from "./archive.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/**
 * `kf sync` — the pull-model delivery sweep. For every review/dones item with a recorded
 * PR it checks merge state via `gh pr view` and runs the archive finalization for the
 * merged ones. Items without `pr` are never touched — no-PR delivery stays an explicit
 * human `kf archive`. Runnable by hand or from cron/launchd; no daemon. A dones item already
 * `delivered` is skipped: the flag is stamped last, so nothing is left to finalize, and its
 * canonical docs may legitimately carry later edits (superseded banners) that a re-archive
 * would refuse on every sweep.
 */
export async function cmdSync(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const repo = readProjectConfig(root.root).repository;
  if (!repo) return noRepository();

  const candidates = listFeatures(root.root).filter(
    (f) => (f.stage === "review" || (f.stage === "dones" && !f.meta?.delivered)) && Boolean(f.meta?.pr),
  );
  if (candidates.length === 0) {
    return { code: 0, stdout: "No PR-linked items awaiting delivery — nothing to sync." };
  }

  const lines: string[] = [];
  let failed = false;
  for (const f of candidates) {
    const res = gh(["pr", "view", f.meta!.pr!, "-R", repo, "--json", "state"]);
    if (!res.ok) {
      lines.push(`⚠ ${f.name}: could not verify ${f.meta!.pr} — skipped`);
      continue;
    }
    let state = "UNKNOWN";
    try {
      state = ((JSON.parse(res.stdout) as { state?: string }).state ?? "UNKNOWN").toUpperCase();
    } catch {
      lines.push(`⚠ ${f.name}: gh pr view ${f.meta!.pr} returned unexpected output — skipped`);
      continue;
    }
    if (state !== "MERGED") {
      lines.push(`- ${f.name}: skipped (PR ${state.toLowerCase()})`);
      continue;
    }
    const r = await cmdArchive({ command: "archive", positionals: [f.name], options: {} }, root.root);
    if (r.code === 0) {
      lines.push(`✓ ${f.name}: archived (PR merged)`);
    } else {
      failed = true;
      lines.push(`✗ ${f.name}: ${r.stdout.split("\n")[0]}`);
    }
  }
  return { code: failed ? 1 : 0, stdout: lines.join("\n") };
}

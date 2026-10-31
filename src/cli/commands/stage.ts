import { STAGES, type Stage, type LegacyStageName } from "../../workflow/schema.js";
import { renderArchive } from "./archive.js";
import { archiveItem } from "../../workflow/archive.js";
import { findRoot } from "./helpers.js";
import { transitionItem } from "../../workflow/transition.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/** The stages of earlier releases, each answered with where that work went instead of "unknown stage". */
const LEGACY_STAGE_HINTS: Record<LegacyStageName, (feature: string) => string> = {
  shipping: (feature) => `shipping is gone: open the PR at review, merge on GitHub, kf status --change ${feature} closes the item`,
  dones: (feature) => `the stage is now done: a review PASS item closes on merge via kf status --change ${feature}, kf sync or kf archive`,
};

export async function cmdStage(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const [name, toRaw] = args.positionals;
  if (!name || !toRaw) {
    return {
      code: 1,
      stdout: "Usage: kf stage <feature> <next-stage>\nStages: brainstorm → planning → backlog → implementation → testing → review → done",
      stderr: "missing args",
    };
  }
  if (Object.hasOwn(LEGACY_STAGE_HINTS, toRaw)) {
    return { code: 1, stdout: LEGACY_STAGE_HINTS[toRaw as LegacyStageName](name), stderr: "legacy stage" };
  }
  const to = toRaw as Stage;
  if (!STAGES.includes(to)) {
    return { code: 1, stdout: `Unknown stage '${to}'. Stages: ${STAGES.join(" → ")}`, stderr: "unknown stage" };
  }
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };

  const outcome = await transitionItem(root.root, name, to, {
    force: Boolean(args.options.force),
    skipHooks: Boolean(args.options["skip-hooks"]),
    cwd,
  });
  switch (outcome.kind) {
    case "error":
      throw outcome.error;
    case "hook-failed":
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "refused":
      if (outcome.reason === "archive-required") {
        return renderArchive(await archiveItem(root.root, name, {
          force: Boolean(args.options.force),
          skipHooks: Boolean(args.options["skip-hooks"]),
          skipSpecs: Boolean(args.options["skip-specs"]),
        }));
      }
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "moved":
      break;
  }
  const moved = outcome.stdout;

  // An item reopened into `done` must end up as archived as it was: `status: "archived"` back,
  // and canonical docs re-synced, since `kf cancel --purge-docs` may have deleted them. Archive
  // is idempotent once the item is in `done`, so hand off rather than duplicate its logic.
  if (outcome.reopened && to === "done") {
    // The caller's flags are deliberately NOT forwarded. `--force` on `kf stage` means "skip a
    // gate"; inside archive it also means "overwrite canonical docs that changed since the
    // snapshot", which would destroy hand edits on a command that never offered to. A re-sync
    // that refuses is the correct outcome here, and archive says why.
    //
    // Archive can fail as well as refuse — a missing source artifact, an unwritable docs tree.
    // The move and the metadata write have already committed by now, so a failure must not
    // turn a successful reopen into exit 1.
    const resync = await archiveItem(root.root, name);
    if (resync.kind === "error") {
      const why = resync.error instanceof Error ? resync.error.message : String(resync.error);
      return { code: 0, stdout: `${moved}\n  Canonical docs were not re-synced: ${why}\n  Fix that, then run: kf archive ${name}` };
    }
    const rendered = renderArchive(resync);
    if (resync.kind === "refused" || resync.kind === "hook-failed") {
      return { code: 0, stdout: `${moved}\n  Canonical docs were not re-synced. Run: kf archive ${name}\n${rendered.stdout}` };
    }
    return { code: 0, stdout: `${moved}\n${rendered.stdout}` };
  }
  return { code: 0, stdout: moved };
}

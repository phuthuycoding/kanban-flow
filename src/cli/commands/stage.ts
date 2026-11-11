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
          trigger: "stage",
        }));
      }
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "moved":
      break;
  }
  return { code: 0, stdout: outcome.stdout };
}

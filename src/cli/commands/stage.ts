import { STAGES, type Stage } from "../../workflow/schema.js";
import { cmdArchive } from "./archive.js";
import { findRoot } from "./helpers.js";
import { transitionItem } from "../../workflow/transition.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export async function cmdStage(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const [name, toRaw] = args.positionals;
  if (!name || !toRaw) {
    return {
      code: 1,
      stdout: "Usage: kf stage <feature> <next-stage>\nStages: brainstorm → planning → backlog → implementation → testing → review → shipping → dones",
      stderr: "missing args",
    };
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
      if (outcome.reason === "archive-required") return cmdArchive({ ...args, command: "archive", positionals: [name] }, cwd);
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderrTag };
    case "moved":
      break;
  }
  const moved = outcome.stdout;

  // An item reopened into `dones` must end up as archived as it was: `status: "archived"` back,
  // and canonical docs re-synced, since `kf cancel --purge-docs` may have deleted them. Archive
  // is idempotent once the item is in `dones`, so hand off rather than duplicate its logic.
  if (outcome.reopened && to === "dones") {
    // The caller's flags are deliberately NOT forwarded. `--force` on `kf stage` means "skip a
    // gate"; inside archive it also means "overwrite canonical docs that changed since the
    // snapshot", which would destroy hand edits on a command that never offered to. A re-sync
    // that refuses is the correct outcome here, and archive says why.
    //
    // Archive can throw as well as return non-zero — a missing source artifact, an unwritable
    // docs tree. The move and the metadata write have already committed by now, so a throw must
    // not turn a successful reopen into exit 1.
    let resync: CmdResult;
    try {
      resync = await cmdArchive({ command: "archive", positionals: [name], options: {} }, cwd);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return { code: 0, stdout: `${moved}\n  Canonical docs were not re-synced: ${why}\n  Fix that, then run: kf archive ${name}` };
    }
    if (resync.code !== 0) {
      return { code: 0, stdout: `${moved}\n  Canonical docs were not re-synced. Run: kf archive ${name}\n${resync.stdout}` };
    }
    return { code: 0, stdout: `${moved}\n${resync.stdout}` };
  }
  return { code: 0, stdout: moved };
}

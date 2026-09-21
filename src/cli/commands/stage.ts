import { rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { STAGES, TRANSITIONS, type Stage } from "../../workflow/schema.js";
import { findFeature, stageDir, writeFeatureMeta } from "../../workflow/features.js";
import { cmdArchive } from "./archive.js";
import { validateFeature, checkDirectionGate, renderValidateText } from "../../workflow/validate.js";
import { runHook, resolveHook, type HookResult, type HookSource } from "../../integrations/hooks.js";
import { findRoot, recordBypasses, bypassNote } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export async function cmdStage(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const [name, toRaw] = args.positionals;
  if (!name || !toRaw) {
    return {
      code: 1,
      stdout: "Usage: kf stage <feature> <next-stage>\nStages: brainstorm → planning → backlog → implementation → testing → review → dones",
      stderr: "missing args",
    };
  }
  const to = toRaw as Stage;
  if (!STAGES.includes(to)) {
    return { code: 1, stdout: `Unknown stage '${to}'. Stages: ${STAGES.join(" → ")}`, stderr: "unknown stage" };
  }
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (f.stage === "dones") {
    return { code: 1, stdout: `Feature '${name}' is already archived (dones).`, stderr: "already dones" };
  }

  // A cancelled item has exactly one way back: the stage it was cancelled from.
  let isReopen = false;
  if (f.stage === "cancelled") {
    const from = f.meta?.cancellation?.fromStage;
    if (!from) {
      return { code: 1, stdout: `'${name}' is cancelled but its metadata has no fromStage, so kf cannot tell where it belongs. Re-run with --force to place it anywhere.`, stderr: "cancellation missing" };
    }
    if (to !== from && !(args.options.force as boolean)) {
      return { code: 1, stdout: `Cancelled '${name}' can only be reopened at ${from} (where it was cancelled). Run: kf stage ${name} ${from}`, stderr: "wrong reopen stage" };
    }
    isReopen = to === from;
  }

  const allowed = TRANSITIONS[f.stage];
  if (f.stage !== "cancelled" && !allowed.includes(to)) {
    const desc = allowed.join(", ");
    return {
      code: 1,
      stdout: `Cannot move '${name}' ${f.stage} → ${to}. Allowed: ${desc}.`,
      stderr: "not allowed transition",
    };
  }
  // Reopening into `dones` is putting an item back where it was, not archiving it again. Routing
  // it through archive made `kf cancel`'s own advertised reopen command refuse itself, with no
  // escape: archive rejects a cancelled item before it ever looks at --force. The move happens
  // below, and the archive state it had is restored right after — see the isReopen tail.
  if (to === "dones" && !isReopen) return cmdArchive({ ...args, command: "archive", positionals: [name] }, cwd);

  // Gate: feature must be valid for its CURRENT stage before leaving it.
  const force = Boolean(args.options.force);
  const forcedCodes: string[] = [];
  // Returning to planning is checked against the brainstorm gate: the requirement must still be
  // confirmed. A cancelled item is exempt — pretending it sits in brainstorm walked straight past
  // the `cancelled` shortcut inside validateFeature, so `kf validate` called the item valid while
  // `kf stage` refused the very reopen `kf cancel` prints, and blamed a stage it was not in. The
  // only way through was --force, which stamps a permanent bypass for a gate that should not hold.
  const check = to === "planning" && f.stage !== "brainstorm" && f.stage !== "cancelled"
    ? validateFeature({ ...f, stage: "brainstorm" }, false, false)
    : validateFeature(f);
  if (!check.valid) {
    if (!force) {
      return {
        code: 1,
        stdout: `Gate failed for '${name}' (${f.stage}). Fix validation before moving:\n\n${renderValidateText(check)}\n\nOr re-run with --force.`,
        stderr: "gate failed",
      };
    }
    forcedCodes.push(...check.issues.filter((i) => i.severity === "ERROR").map((i) => i.code));
  }

  // Directional gate: PASS/FAIL/REQUIREMENT_BUG semantics of the reports.
  const direction = checkDirectionGate(f, to);
  if (direction.length > 0) {
    if (!force) {
      const lines = direction.map((i) => `  [${i.severity}] ${i.file}: ${i.message} (${i.code})`).join("\n");
      return {
        code: 1,
        stdout: `Cannot move '${name}' ${f.stage} → ${to} — report status blocks this direction:\n\n${lines}\n\nOr re-run with --force.`,
        stderr: "direction gate failed",
      };
    }
    forcedCodes.push(...direction.map((i) => i.code));
  }

  // Phase hook: run the hook of the stage we are entering (before the move).
  // If it exits non-zero the transition is refused, unless --skip-hooks.
  const skipHooks = Boolean(args.options["skip-hooks"]);
  let hookResult: HookResult | null = null;
  const skippedHook: HookSource | null = skipHooks ? resolveHook(root.root, to) : null;
  if (!skipHooks) {
    hookResult = runHook(root.root, {
      feature: f.name,
      context: f.context,
      dir: f.dir,
      root: root.root,
      from: f.stage,
      to,
      approval: to === "planning" ? "pending" : f.meta?.approval?.status ?? "pending",
    });
    if (hookResult.ran && !hookResult.ok) {
      return {
        code: 1,
        stdout:
          `Hook '${to}' failed (exit ${hookResult.code})${hookResult.hook ? ` [${hookResult.hook.path}]` : ""}.\nTransition refused.\n\n${hookResult.output}\n\nRe-run with --skip-hooks to bypass.`,
        stderr: "hook failed",
      };
    }
  }

  const dest = stageDir(root.root, to);
  const target = join(dest, f.folder);
  if (existsSync(target)) {
    return { code: 1, stdout: `Target already exists: ${target}`, stderr: "target exists" };
  }
  if (!f.meta) return { code: 1, stdout: "Feature metadata is missing.", stderr: "metadata missing" };
  const recorded = recordBypasses(f.stage, to, forcedCodes, skippedHook);
  let metadataUpdated = false;
  try {
    let meta = recorded.length > 0 ? { ...f.meta, bypasses: [...(f.meta.bypasses ?? []), ...recorded] } : f.meta;
    // Putting an item back in `dones` means putting back the state it had there. `status` does
    // not depend on validation, so restore it here rather than leaving it to the doc re-sync,
    // which can legitimately refuse on an item that was never fully valid.
    if (f.stage === "cancelled") meta = { ...meta, cancellation: undefined, status: isReopen && to === "dones" ? "archived" : undefined };
    if (to === "planning") {
      await writeFeatureMeta(f.dir, { ...meta, approval: { status: "pending" }, executionId: undefined });
      metadataUpdated = true;
    } else if (to === "testing" || to === "implementation") {
      await writeFeatureMeta(f.dir, { ...meta, executionId: to === "testing" ? randomUUID() : undefined });
      metadataUpdated = true;
    } else if (recorded.length > 0 || f.stage === "cancelled") {
      await writeFeatureMeta(f.dir, meta);
      metadataUpdated = true;
    }
    await rename(f.dir, target);
  } catch (err) {
    if (metadataUpdated) {
      try {
        await writeFeatureMeta(f.dir, f.meta);
      } catch (rollbackError) {
        throw new AggregateError([err, rollbackError], `Transition failed and metadata rollback was incomplete for '${name}'.`);
      }
    }
    throw err;
  }
  const hookNote = hookResult?.ran ? `\n  Hook '${to}' ran [${hookResult.hook?.source ?? ""}]` : "";
  const moved = `✓ Moved '${name}' ${f.stage} → ${to}\n  ${target}${hookNote}${bypassNote(recorded)}`;

  // An item reopened into `dones` must end up as archived as it was: `status: "archived"` back,
  // and canonical docs re-synced, since `kf cancel --purge-docs` may have deleted them. Archive
  // is idempotent once the item is in `dones`, so hand off rather than duplicate its logic.
  if (isReopen && to === "dones") {
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

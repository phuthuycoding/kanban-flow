import { rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { STAGES, TRANSITIONS, type Stage } from "./schema.js";
import { findWorksRoot, findFeature, stageDir, writeFeatureMeta } from "./features.js";
import { cmdArchive } from "./archive.js";
import { validateFeature, checkDirectionGate, renderValidateText } from "./validate.js";
import { runHook, type HookResult } from "./hooks.js";
import type { ParsedArgs } from "./args.js";
import type { CmdResult } from "./commands.js";

async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) return { root: "", ok: false, err: "No .works found. Run: kf init" };
  return { root, ok: true };
}

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

  const allowed = TRANSITIONS[f.stage];
  if (!allowed.includes(to)) {
    const desc = allowed.join(", ");
    return {
      code: 1,
      stdout: `Cannot move '${name}' ${f.stage} → ${to}. Allowed: ${desc}.`,
      stderr: "not allowed transition",
    };
  }
  if (to === "dones") return cmdArchive({ ...args, command: "archive", positionals: [name] }, cwd);

  // Gate: feature must be valid for its CURRENT stage before leaving it.
  const check = to === "planning" && f.stage !== "brainstorm"
    ? validateFeature({ ...f, stage: "brainstorm" }, false, false)
    : validateFeature(f);
  if (!check.valid && !(args.options.force as boolean)) {
    return {
      code: 1,
      stdout: `Gate failed for '${name}' (${f.stage}). Fix validation before moving:\n\n${renderValidateText(check)}\n\nOr re-run with --force.`,
      stderr: "gate failed",
    };
  }

  // Directional gate: PASS/FAIL/REQUIREMENT_BUG semantics of the reports.
  const direction = checkDirectionGate(f, to);
  if (direction.length > 0 && !(args.options.force as boolean)) {
    const lines = direction.map((i) => `  [${i.severity}] ${i.file}: ${i.message} (${i.code})`).join("\n");
    return {
      code: 1,
      stdout: `Cannot move '${name}' ${f.stage} → ${to} — report status blocks this direction:\n\n${lines}\n\nOr re-run with --force.`,
      stderr: "direction gate failed",
    };
  }

  // Phase hook: run the hook of the stage we are entering (before the move).
  // If it exits non-zero the transition is refused, unless --skip-hooks.
  const skipHooks = Boolean(args.options["skip-hooks"]);
  let hookResult: HookResult | null = null;
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
  let metadataUpdated = false;
  try {
    if (to === "planning") {
      await writeFeatureMeta(f.dir, { ...f.meta, approval: { status: "pending" }, executionId: undefined });
      metadataUpdated = true;
    } else if (to === "testing" || to === "implementation") {
      await writeFeatureMeta(f.dir, { ...f.meta, executionId: to === "testing" ? randomUUID() : undefined });
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
  return {
    code: 0,
    stdout: `✓ Moved '${name}' ${f.stage} → ${to}\n  ${target}${hookNote}`,
  };
}

import { rename, rm } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";

import { findFeature, stageDir, writeFeatureMeta } from "../../workflow/features.js";
import { findSecretLike } from "../../workflow/validate.js";
import { runningRun } from "../../harness/run.js";
import { runHook, resolveHook, type HookSource } from "../../integrations/hooks.js";
import { readProjectConfig } from "../../project/config.js";
import { selectOption } from "../../project/bootstrap.js";
import { nowTimestamp } from "../../shared/time.js";
import { canonicalDocPaths } from "./archive.js";
import { findRoot, recordBypasses, bypassNote } from "./helpers.js";
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
  const reason = typeof args.options.reason === "string" ? args.options.reason.trim() : "";
  if (!reason) {
    return { code: 1, stdout: 'Cancelling needs a reason: kf cancel ' + name + ' --reason "<why it is being dropped>"', stderr: "missing reason" };
  }
  const secrets = findSecretLike(reason);
  if (secrets.length > 0) {
    return { code: 1, stdout: "The reason looks like it contains a credential; rewrite it without the secret.", stderr: "secret in reason" };
  }
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (f.stage === "cancelled") {
    return { code: 1, stdout: `'${name}' is already cancelled (${f.meta?.cancellation?.reason ?? "no reason recorded"}).`, stderr: "already cancelled" };
  }
  if (!f.meta) return { code: 1, stdout: "Feature metadata is missing.", stderr: "metadata missing" };

  const force = Boolean(args.options.force);
  const forcedCodes: string[] = [];
  const active = runningRun(f);
  if (active) {
    if (!force) {
      return { code: 1, stdout: `Run ${active.id} (${active.role} @ ${active.stage}) is still running for '${name}'. Wait for it, or re-run with --force.`, stderr: "run in progress" };
    }
    forcedCodes.push("run_in_progress");
  }

  const skipHooks = Boolean(args.options["skip-hooks"]);
  const skippedHook: HookSource | null = skipHooks ? resolveHook(root.root, "cancelled") : null;
  if (!skipHooks) {
    const hook = runHook(root.root, {
      feature: f.name, context: f.context, dir: f.dir, root: root.root,
      from: f.stage, to: "cancelled", approval: f.meta.approval?.status ?? "pending",
    });
    if (hook.ran && !hook.ok) {
      return {
        code: 1,
        stdout: `Hook 'cancelled' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\nCancel refused.\n\n${hook.output}\n\nRe-run with --skip-hooks to bypass.`,
        stderr: "hook failed",
      };
    }
  }

  const docs = f.stage === "dones" ? canonicalDocPaths(root.root, f) : [];
  const purge = Boolean(args.options["purge-docs"]);
  let purgeApproved = false;
  if (purge && docs.length > 0) {
    if (force) {
      purgeApproved = true;
    } else if (!process.stdin.isTTY) {
      return {
        code: 1,
        stdout: `Refusing to delete canonical docs without confirmation:\n${docs.map((d) => `  ${relative(root.root, d)}`).join("\n")}\nRe-run with --force.`,
        stderr: "purge requires interactive confirmation or --force",
      };
    } else {
      const pick = await selectOption(
        `Delete these canonical docs of '${name}'? (↑/↓ + Enter)\n${docs.map((d) => `  ${relative(root.root, d)}`).join("\n")}`,
        ["Keep them — only cancel the work item", "Delete them"],
      );
      if (pick !== 1) {
        return { code: 0, stdout: `Cancelled nothing. Re-run without --purge-docs to drop the work item and keep the docs.` };
      }
      purgeApproved = true;
    }
  }

  const by = typeof args.options.by === "string" && args.options.by.trim()
    ? args.options.by.trim()
    : readProjectConfig(root.root).reviewer ?? "human";
  const recorded = recordBypasses(f.stage, "cancelled", forcedCodes, skippedHook);
  const cancellation = { at: nowTimestamp(), by, reason, fromStage: f.stage };
  const dest = stageDir(root.root, "cancelled");
  mkdirSync(dest, { recursive: true });
  const target = join(dest, f.folder);
  await writeFeatureMeta(f.dir, {
    ...f.meta,
    status: "cancelled",
    cancellation,
    ...(recorded.length > 0 ? { bypasses: [...(f.meta.bypasses ?? []), ...recorded] } : {}),
  });
  try {
    await rename(f.dir, target);
  } catch (err) {
    try {
      await writeFeatureMeta(f.dir, f.meta);
    } catch (rollbackError) {
      throw new AggregateError([err, rollbackError], `Cancel failed and metadata rollback was incomplete for '${name}'.`);
    }
    throw err;
  }

  // Deleting docs cannot be undone, so it happens only after the move succeeded.
  let purged = false;
  if (purgeApproved) {
    for (const doc of docs) await rm(doc, { recursive: true, force: true });
    purged = true;
  }

  const docsNote = docs.length === 0
    ? ""
    : purged
      ? `\n  Deleted canonical docs:\n${docs.map((d) => `    ${relative(root.root, d)}`).join("\n")}`
      : `\n  Canonical docs left in place (use --purge-docs to delete them):\n${docs.map((d) => `    ${relative(root.root, d)}`).join("\n")}`;
  return {
    code: 0,
    stdout: `✓ Cancelled '${name}' (was ${cancellation.fromStage}) by ${by}\n  Reason: ${reason.split("\n")[0]}\n  ${target}${docsNote}\n  Reopen with: kf stage ${name} ${cancellation.fromStage}${bypassNote(recorded)}`,
  };
}

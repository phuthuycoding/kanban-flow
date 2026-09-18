import { findWorksRoot, findFeature, writeFeatureMeta, executionContractHash } from "./features.js";
import { validateFeature, renderValidateText } from "./validate.js";
import { readProjectConfig } from "./config.js";
import type { ParsedArgs } from "./args.js";
import type { CmdResult } from "./commands.js";

async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) return { root: "", ok: false, err: "No .works found. Run: kf init" };
  return { root, ok: true };
}

function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Human-in-the-Loop gate for Phase 2: the execution contract (implementation
 * plan + use cases + test cases) must be approved before autonomous execution.
 */
export async function cmdApprove(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf approve <feature> [--by <name>]", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };

  if (f.stage !== "planning") {
    return {
      code: 1,
      stdout: `Cannot approve '${name}': feature is in stage "${f.stage}". Approval only applies during Phase 2 (planning).`,
      stderr: "wrong stage",
    };
  }

  const check = validateFeature(f, false, false);
  if (!check.valid) {
    return { code: 1, stdout: `Cannot approve an incomplete execution contract:\n${renderValidateText(check)}`, stderr: "invalid contract" };
  }
  const contractHash = executionContractHash(f.dir, f.meta?.kind === "bug" ? "bug" : "feature");
  if (!contractHash || !f.meta) return { code: 1, stdout: "Execution contract or metadata is missing.", stderr: "invalid contract" };
  const cfg = readProjectConfig(root.root);
  const by = typeof args.options.by === "string" ? args.options.by : (cfg.reviewer ?? "human");
  if (!by.trim()) return { code: 1, stdout: "Approver name must not be empty.", stderr: "missing approver" };
  const approval = { status: "approved" as const, by, at: nowTimestamp(), contractHash };
  await writeFeatureMeta(f.dir, { ...f.meta, approval, executionId: undefined });
  return {
    code: 0,
    stdout: `✓ Approved '${name}' (by ${by} at ${approval.at})\n  Execution contract is now the binding scope for autonomous phases.`,
  };
}

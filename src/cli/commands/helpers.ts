import { findWorksRoot, findFeature, type Feature } from "../../workflow/features.js";
import type { GhResult } from "../../integrations/github.js";
import type { CmdResult } from "../result.js";

export async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) {
    return { root: "", ok: false, err: "No .works found. Run: kf init" };
  }
  return { root, ok: true };
}

export async function resolveItem(
  cwd: string,
  name: string,
): Promise<{ ok: true; root: string; item: Feature } | { ok: false; refusal: CmdResult }> {
  const root = await findRoot(cwd);
  if (!root.ok) return { ok: false, refusal: { code: 1, stdout: root.err!, stderr: "no works" } };
  const item = findFeature(root.root, name);
  if (!item) return { ok: false, refusal: { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" } };
  return { ok: true, root: root.root, item };
}

export function ghFailure(res: GhResult, what: string): CmdResult {
  if (res.missing) return { code: 1, stdout: `gh CLI not found — install it and run gh auth login to ${what}.`, stderr: "gh missing" };
  return { code: 1, stdout: `gh failed to ${what}:\n${res.stderr.trim() || res.stdout.trim()}`, stderr: "gh failed" };
}

export function noRepository(): CmdResult {
  return {
    code: 1,
    stdout: 'No repository configured. Set "repository": "owner/name" in .kf/config.json (kf init detects it from the origin remote).',
    stderr: "no repository",
  };
}

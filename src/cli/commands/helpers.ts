import { findWorksRoot } from "../../workflow/features.js";
import type { GhResult } from "../../integrations/github.js";
import type { CmdResult } from "../result.js";

// cli/commands/ship.ts still imports gh from here; it is outside this change's scope.
export { gh } from "../../integrations/github.js";

export async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) {
    return { root: "", ok: false, err: "No .works found. Run: kf init" };
  }
  return { root, ok: true };
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

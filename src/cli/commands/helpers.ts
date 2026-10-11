import { spawnSync } from "node:child_process";

import { findWorksRoot, type Bypass } from "../../workflow/features.js";
import type { Stage } from "../../workflow/schema.js";
import type { HookSource } from "../../integrations/hooks.js";
import { nowTimestamp } from "../../shared/time.js";
import type { CmdResult } from "../result.js";

export async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) {
    return { root: "", ok: false, err: "No .works found. Run: kf init" };
  }
  return { root, ok: true };
}

/** Build the audit records for this transition: only bypasses that actually skipped something are recorded. */
export function recordBypasses(
  from: Stage | null,
  to: Stage,
  forcedCodes: string[],
  skippedHook: HookSource | null,
): Bypass[] {
  const at = nowTimestamp();
  const records: Bypass[] = [];
  if (forcedCodes.length > 0) records.push({ at, from, to, flag: "force", codes: [...new Set(forcedCodes)] });
  if (skippedHook) records.push({ at, from, to, flag: "skip-hooks", codes: [`hook:${skippedHook.path}`] });
  return records;
}

export function bypassNote(recorded: Bypass[]): string {
  return recorded.map((b) => `\n  ⚠ Bypass recorded: --${b.flag} (${b.codes.join(", ")})`).join("");
}

export interface GhResult {
  ok: boolean;
  missing: boolean;
  stdout: string;
  stderr: string;
}

/** `gh` is an optional dependency — surfaces only when a repository is configured and used. */
export function gh(args: string[]): GhResult {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  const missing = res.error !== undefined && "code" in res.error && res.error.code === "ENOENT";
  return {
    ok: res.status === 0,
    missing,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
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

/**
 * The merge gate shared by `kf archive` and `kf sync`: a recorded PR must be verifiably
 * MERGED. Anything else — OPEN, CLOSED, a gh failure, a missing repository, unparseable
 * output — is unverifiable, and unverifiable is not merged: refuse before any side effect.
 * There is deliberately no --force escape (unlike the AC gate's force semantics).
 * Returns null when the gate passes or no PR is recorded; a refusal CmdResult otherwise.
 */
export function checkMergeGate(
  feature: { name: string; meta?: { pr?: string } | null },
  repo: string | undefined,
): CmdResult | null {
  const pr = feature.meta?.pr;
  if (!pr) return null;
  if (!repo) {
    return {
      code: 1,
      stdout: `Cannot archive '${feature.name}': PR ${pr} is recorded but no "repository" is configured to verify it. Set one in .kf/config.json or archive after removing the pr link.`,
      stderr: "no repository",
    };
  }
  const res = gh(["pr", "view", pr, "-R", repo, "--json", "state"]);
  if (!res.ok) {
    return {
      code: 1,
      stdout: `Cannot archive '${feature.name}': could not verify merge state of ${pr} — unverifiable is not merged.\n${res.missing ? "gh CLI not found — install it and run gh auth login." : res.stderr.trim() || res.stdout.trim()}`,
      stderr: "pr unverifiable",
    };
  }
  let state = "UNKNOWN";
  try {
    state = ((JSON.parse(res.stdout) as { state?: string }).state ?? "UNKNOWN").toUpperCase();
  } catch {
    return {
      code: 1,
      stdout: `Cannot archive '${feature.name}': gh pr view ${pr} returned unexpected output:\n${res.stdout.trim()}`,
      stderr: "pr view parse",
    };
  }
  if (state !== "MERGED") {
    return {
      code: 1,
      stdout: `Cannot archive '${feature.name}': PR ${pr} is not merged (state: ${state}) — merge it first, then archive.`,
      stderr: "pr not merged",
    };
  }
  return null;
}

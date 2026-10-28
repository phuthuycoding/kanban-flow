import { spawnSync } from "node:child_process";

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

/** Why a recorded PR cannot be treated as merged. Callers render the text. */
export type MergeGateFailure =
  | { reason: "no-repository"; pr: string }
  | { reason: "unverifiable"; pr: string; detail: string }
  | { reason: "parse"; pr: string; output: string }
  | { reason: "not-merged"; pr: string; state: string };

/**
 * The merge gate shared by `kf archive` and `kf sync`: a recorded PR must be verifiably
 * MERGED. Anything else — OPEN, CLOSED, a gh failure, a missing repository, unparseable
 * output — is unverifiable, and unverifiable is not merged: refuse before any side effect.
 * There is deliberately no --force escape (unlike the AC gate's force semantics).
 * Returns null when the gate passes or no PR is recorded.
 */
export function checkMergeGate(
  feature: { meta?: { pr?: string } | null },
  repo: string | undefined,
): MergeGateFailure | null {
  const pr = feature.meta?.pr;
  if (!pr) return null;
  if (!repo) return { reason: "no-repository", pr };
  const res = gh(["pr", "view", pr, "-R", repo, "--json", "state"]);
  if (!res.ok) {
    return {
      reason: "unverifiable",
      pr,
      detail: res.missing ? "gh CLI not found — install it and run gh auth login." : res.stderr.trim() || res.stdout.trim(),
    };
  }
  let state = "UNKNOWN";
  try {
    state = ((JSON.parse(res.stdout) as { state?: string }).state ?? "UNKNOWN").toUpperCase();
  } catch {
    return { reason: "parse", pr, output: res.stdout.trim() };
  }
  if (state !== "MERGED") return { reason: "not-merged", pr, state };
  return null;
}

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

/** A recorded PR that is verifiably MERGED, with the head it merged — what a branch delete proves against. */
export interface MergedPr {
  pr: string;
  headRefName: string;
  headRefOid: string;
}

export type MergeGateResult =
  | { kind: "no-pr" }
  | ({ kind: "merged" } & MergedPr)
  | { kind: "failed"; failure: MergeGateFailure };

/**
 * The merge gate shared by `kf archive` and `kf sync`: a recorded PR must be verifiably
 * MERGED. Anything else — OPEN, CLOSED, a gh failure, a missing repository, unparseable
 * output — is unverifiable, and unverifiable is not merged: refuse before any side effect.
 * There is deliberately no --force escape (unlike the AC gate's force semantics).
 * A merged PR comes back with its head branch and head commit: deleting the item branch is
 * safe only for the commits that PR merged. A MERGED answer without them is a parse failure.
 */
export function checkMergeGate(
  feature: { meta?: { pr?: string } | null },
  repo: string | undefined,
): MergeGateResult {
  const pr = feature.meta?.pr;
  if (!pr) return { kind: "no-pr" };
  if (!repo) return { kind: "failed", failure: { reason: "no-repository", pr } };
  const res = gh(["pr", "view", pr, "-R", repo, "--json", "state,headRefName,headRefOid"]);
  if (!res.ok) {
    return {
      kind: "failed",
      failure: {
        reason: "unverifiable",
        pr,
        detail: res.missing ? "gh CLI not found — install it and run gh auth login." : res.stderr.trim() || res.stdout.trim(),
      },
    };
  }
  let view: { state?: string; headRefName?: unknown; headRefOid?: unknown };
  try {
    view = JSON.parse(res.stdout) as typeof view;
  } catch {
    return { kind: "failed", failure: { reason: "parse", pr, output: res.stdout.trim() } };
  }
  const state = (view.state ?? "UNKNOWN").toUpperCase();
  if (state !== "MERGED") return { kind: "failed", failure: { reason: "not-merged", pr, state } };
  if (typeof view.headRefName !== "string" || !view.headRefName || typeof view.headRefOid !== "string" || !view.headRefOid) {
    return { kind: "failed", failure: { reason: "parse", pr, output: res.stdout.trim() } };
  }
  return { kind: "merged", pr, headRefName: view.headRefName, headRefOid: view.headRefOid };
}

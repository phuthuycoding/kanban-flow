import { spawnSync } from "node:child_process";

export interface GhResult {
  ok: boolean;
  missing: boolean;
  /** The call outlived `timeoutMs` and was killed. */
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** How long a gh lookup that kf status, kf sync or doctor waits on may run before it counts as failed. */
export const GH_LOOKUP_TIMEOUT_MS = 15_000;

/**
 * `gh` is an optional dependency — surfaces only when a repository is configured and used.
 * With `timeoutMs`, a call still running then is killed and reported as a failure.
 */
export function gh(args: string[], options: { timeoutMs?: number } = {}): GhResult {
  const res = spawnSync("gh", args, { encoding: "utf8", timeout: options.timeoutMs });
  const code = res.error !== undefined && "code" in res.error ? res.error.code : undefined;
  const missing = code === "ENOENT";
  const timedOut = code === "ETIMEDOUT";
  return {
    ok: res.status === 0 && !timedOut,
    missing,
    timedOut,
    stdout: res.stdout ?? "",
    stderr: timedOut ? `gh ${args.slice(0, 2).join(" ")} timed out after ${options.timeoutMs} ms` : res.stderr ?? "",
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
/** Why `pr` cannot replace a closed PR, or null: it must be open on this repository and, when known, on the item's branch. */
export function replacementRefusal(pr: string, repo: string, branch: string | undefined): string | null {
  if (!pr.includes(`/${repo}/pull/`)) return `${pr} is not a pull request of ${repo}`;
  const res = gh(["pr", "view", pr, "-R", repo, "--json", "state,headRefName"]);
  if (!res.ok) return `${pr} could not be verified: ${res.missing ? "gh CLI not found" : res.stderr.trim() || res.stdout.trim()}`;
  let view: { state?: string; headRefName?: string };
  try {
    view = JSON.parse(res.stdout) as typeof view;
  } catch (err) {
    return `${pr} could not be verified: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (view.state?.toUpperCase() !== "OPEN") return `${pr} is ${view.state ?? "in an unknown state"}, not open`;
  if (branch && view.headRefName !== branch) return `${pr} is on ${view.headRefName ?? "an unknown branch"}, not ${branch}`;
  return null;
}

export function checkMergeGate(
  feature: { meta?: { pr?: string } | null },
  repo: string | undefined,
  timeoutMs = GH_LOOKUP_TIMEOUT_MS,
): MergeGateResult {
  const pr = feature.meta?.pr;
  if (!pr) return { kind: "no-pr" };
  if (!repo) return { kind: "failed", failure: { reason: "no-repository", pr } };
  const res = gh(["pr", "view", pr, "-R", repo, "--json", "state,headRefName,headRefOid"], { timeoutMs });
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

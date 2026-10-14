import { execFileSync } from "node:child_process";

const FETCH_TIMEOUT_MS = 15_000;

function git(root: string, args: string[], timeoutMs?: number): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
  }).trim();
}

function tryGit(root: string, args: string[], timeoutMs?: number): string | null {
  try {
    return git(root, args, timeoutMs) || null;
  } catch {
    return null;
  }
}

/** Exit-status check for commands whose success produces no stdout (e.g. `fetch --quiet`). */
function gitOk(root: string, args: string[], timeoutMs?: number): boolean {
  try {
    execFileSync("git", ["-C", root, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

export interface BaseSyncResult {
  /**
   * synced  — fetched and fast-forwarded to the upstream tip.
   * clean   — upstream reachable and HEAD already at the tip.
   * dirty   — behind upstream but the tree is not clean; nothing was touched.
   * diverged— local branch is ahead/non-ff vs upstream; nothing was touched.
   * noRemote— no upstream and no origin/HEAD; nothing to measure.
   * fetchFailed — remote unreachable/timeout; nothing was touched.
   * detached— HEAD is detached; no branch to fast-forward.
   */
  status: "synced" | "clean" | "dirty" | "diverged" | "noRemote" | "fetchFailed" | "detached";
  /** Commits behind upstream when known. */
  behind: number;
  /** Printable note line (synced/clean) — undefined when nothing worth printing. */
  note?: string;
  /** Printable warning line for degraded outcomes — callers prefix `⚠`. */
  warning?: string;
}

/**
 * Keep the checkout kf would branch from current with its upstream before the
 * pipeline surveys code or cuts a `kf/<feature>` branch. Fast-forwards only a
 * clean, behind-only branch — anything else degrades to a warning rather than
 * mutating the user's tree. Throws when `git merge --ff-only` itself refuses
 * (e.g. untracked files the pull would overwrite) — that error must propagate.
 */
export function syncBase(root: string): BaseSyncResult {
  if (!tryGit(root, ["rev-parse", "--verify", "HEAD"])) return { status: "noRemote", behind: 0 };
  if (!tryGit(root, ["symbolic-ref", "-q", "--short", "HEAD"])) {
    return { status: "detached", behind: 0, warning: "detached HEAD — base sync skipped" };
  }

  const upstream =
    tryGit(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]) ??
    tryGit(root, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (!upstream) return { status: "noRemote", behind: 0 };

  if (!tryGit(root, ["rev-parse", "--verify", upstream])) return { status: "noRemote", behind: 0 };

  const remote = upstream.split("/")[0];
  const fetched = gitOk(root, ["fetch", "--quiet", remote], FETCH_TIMEOUT_MS);
  const behind = Number.parseInt(tryGit(root, ["rev-list", "--count", `HEAD..${upstream}`]) ?? "0", 10) || 0;
  const ahead = Number.parseInt(tryGit(root, ["rev-list", "--count", `${upstream}..HEAD`]) ?? "0", 10) || 0;
  if (!fetched) {
    return {
      status: "fetchFailed",
      behind,
      warning: `could not reach remote '${remote}' — continuing on the local checkout (last known: ${behind} commit(s) behind ${upstream})`,
    };
  }
  if (behind === 0) return { status: "clean", behind: 0 };
  if (ahead > 0) {
    return {
      status: "diverged",
      behind,
      warning: `base is ${behind} commit(s) behind ${upstream} but has ${ahead} unpushed local commit(s) — reconcile, then re-run`,
    };
  }
  if (git(root, ["status", "--porcelain"])) {
    return {
      status: "dirty",
      behind,
      warning: `base is ${behind} commit(s) behind ${upstream} and the working tree has uncommitted changes — reconcile, then re-run`,
    };
  }

  // Clean + behind-only + on a branch: fast-forward is safe; let a refusal propagate.
  git(root, ["merge", "--ff-only", upstream]);
  return { status: "synced", behind, note: `↻ synced base: fast-forwarded ${behind} commit(s) to ${upstream}` };
}

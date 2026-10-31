import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  timeoutMs?: number;
  input?: string;
}

export interface ChangedPath {
  status: string;
  path: string;
  oldPath?: string;
}

export type CommitResult = { ok: true; sha: string } | { ok: false; error: string };

export type MergeResult =
  | { ok: true; sha: string }
  | { ok: false; conflicts: string[]; error: string };

const MAX_BUFFER = 64 * 1024 * 1024;

/** A value starting with "-" would be parsed by git as an option. */
function assertSafeArg(kind: string, value: string): void {
  if (!value || value.startsWith("-")) {
    throw new Error(`Refusing unsafe git ${kind}: ${JSON.stringify(value)}`);
  }
}

/**
 * Runs git without a shell. Non-zero exits are returned, not thrown; only a failure to
 * spawn git at all (or a timeout) throws.
 */
export function runGit(dir: string, args: string[], opts: GitOptions = {}): GitResult {
  const res = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
  });
  if (res.error) {
    throw new Error(`git ${args.join(" ")} could not run in ${dir}: ${res.error.message}`, { cause: res.error });
  }
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function gitRaw(dir: string, args: string[], opts: GitOptions = {}): string {
  const res = runGit(dir, args, opts);
  if (res.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
  }
  return res.stdout;
}

/** Like runGit but throws on a non-zero exit (stderr in the message) and returns trimmed stdout. */
export function git(dir: string, args: string[], opts: GitOptions = {}): string {
  return gitRaw(dir, args, opts).trim();
}

const splitZ = (out: string): string[] => out.split("\0").filter(Boolean);

export function revParse(dir: string, ref: string): string | null {
  assertSafeArg("ref", ref);
  const res = runGit(dir, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

/** Branch name, or null when HEAD is detached. */
export function currentBranch(dir: string): string | null {
  const res = runGit(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

/** Modified or staged tracked files; untracked files are not reported. */
export function trackedChanges(dir: string): string[] {
  const out = gitRaw(dir, ["status", "--porcelain", "-z", "--untracked-files=no"]);
  const entries = splitZ(out);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    paths.push(entry.slice(3));
    // Renames/copies carry the origin path as an extra NUL-separated field.
    if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") i++;
  }
  return paths;
}

export function untrackedFiles(dir: string): string[] {
  return splitZ(gitRaw(dir, ["ls-files", "--others", "--exclude-standard", "-z"]));
}

/** Committed, staged and unstaged changes against baseSha, plus untracked files as `A`. */
export function changedPathsSince(dir: string, baseSha: string): ChangedPath[] {
  assertSafeArg("ref", baseSha);
  const tokens = splitZ(gitRaw(dir, ["diff", "--name-status", "-z", "-M", baseSha]));
  const changes: ChangedPath[] = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++];
    if (status[0] === "R" || status[0] === "C") {
      const oldPath = tokens[i++];
      changes.push({ status: status[0], path: tokens[i++], oldPath });
    } else {
      changes.push({ status: status[0], path: tokens[i++] });
    }
  }
  for (const path of untrackedFiles(dir)) changes.push({ status: "A", path });
  return changes;
}

/** Stages everything and commits with the message passed via file; hooks and signing run as configured. */
export function commitAll(dir: string, message: string, opts: { timeoutMs?: number } = {}): CommitResult {
  const add = runGit(dir, ["add", "-A"], opts);
  if (add.code !== 0) return { ok: false, error: add.stderr.trim() || add.stdout.trim() };
  const tmp = mkdtempSync(join(tmpdir(), "kf-commit-"));
  try {
    const file = join(tmp, "message");
    writeFileSync(file, message);
    const commit = runGit(dir, ["commit", "-F", file], opts);
    if (commit.code !== 0) {
      return { ok: false, error: commit.stderr.trim() || commit.stdout.trim() };
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: true, sha: git(dir, ["rev-parse", "HEAD"]) };
}

export function mergeNoFf(dir: string, branch: string, message: string): MergeResult {
  assertSafeArg("branch", branch);
  const res = runGit(dir, ["merge", "--no-ff", "--no-edit", "-m", message, branch]);
  if (res.code === 0) return { ok: true, sha: git(dir, ["rev-parse", "HEAD"]) };
  const conflicts = splitZ(runGit(dir, ["diff", "--name-only", "--diff-filter=U", "-z"]).stdout);
  return { ok: false, conflicts, error: res.stderr.trim() || res.stdout.trim() };
}

export function mergeAbort(dir: string): void {
  git(dir, ["merge", "--abort"]);
}

export function mergeInProgress(dir: string): boolean {
  return runGit(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).code === 0;
}

export function resetHard(dir: string, sha: string): void {
  assertSafeArg("ref", sha);
  git(dir, ["reset", "--hard", sha]);
}

export function addWorktree(root: string, path: string, branch: string, startRef: string): void {
  assertSafeArg("branch", branch);
  assertSafeArg("path", path);
  assertSafeArg("ref", startRef);
  git(root, ["worktree", "add", "-b", branch, path, startRef]);
}

export function removeWorktree(root: string, path: string, opts: { force?: boolean } = {}): void {
  assertSafeArg("path", path);
  git(root, ["worktree", "remove", ...(opts.force ? ["--force"] : []), path]);
}

export function deleteBranch(root: string, branch: string): void {
  assertSafeArg("branch", branch);
  git(root, ["branch", "-D", branch]);
}

export function pruneWorktrees(root: string): void {
  git(root, ["worktree", "prune"]);
}

const REMOTE_TIMEOUT_MS = 30_000;

/** True when `dir` is inside a git work tree; false outside one. */
export function insideWorkTree(dir: string): boolean {
  const res = runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
  return res.code === 0 && res.stdout.trim() === "true";
}

export function hasRemote(dir: string, remote: string): boolean {
  assertSafeArg("remote", remote);
  return runGit(dir, ["remote", "get-url", remote]).code === 0;
}

/** `origin/<default>` from `refs/remotes/origin/HEAD`, or null when origin/HEAD is not set. */
export function originDefaultRef(dir: string): string | null {
  const res = runGit(dir, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (res.code === 0) return res.stdout.trim() || null;
  // -q makes "not a symbolic ref / no such ref" exit 1 silently; anything else is a real failure.
  if (res.code === 1) return null;
  throw new Error(`git symbolic-ref refs/remotes/origin/HEAD failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
}

/** Fetch one branch of a remote so its remote-tracking ref is current; returns git's result. */
export function fetchBranch(dir: string, remote: string, branch: string): GitResult {
  assertSafeArg("remote", remote);
  assertSafeArg("branch", branch);
  return runGit(dir, ["fetch", "--quiet", remote, branch], { timeoutMs: REMOTE_TIMEOUT_MS });
}

/** Commits reachable from `to` but not from `from`. */
export function countCommits(dir: string, from: string, to: string): number {
  assertSafeArg("ref", from);
  assertSafeArg("ref", to);
  return Number(git(dir, ["rev-list", "--count", `${from}..${to}`])) || 0;
}

/** Path of `dir` relative to the repository top level ("" at the top, else ending in "/"). */
export function repoPrefix(dir: string): string {
  return git(dir, ["rev-parse", "--show-prefix"]);
}

export type RemoteBranchDeletion =
  | { kind: "deleted" }
  /** The branch is not on the remote: never pushed, or already deleted (e.g. by the merge). */
  | { kind: "absent" }
  | { kind: "no-remote" }
  /** The remote refused or could not be reached (protected branch, no access, offline). Never forced. */
  | { kind: "refused"; detail: string };

/** `git push <remote> --delete <branch>` when the branch is on the remote; nothing is forced. */
export function deleteRemoteBranch(dir: string, remote: string, branch: string): RemoteBranchDeletion {
  assertSafeArg("branch", branch);
  if (!hasRemote(dir, remote)) return { kind: "no-remote" };
  const probe = runGit(dir, ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`], { timeoutMs: REMOTE_TIMEOUT_MS });
  // --exit-code: 2 means the ref is not there.
  if (probe.code === 2) return { kind: "absent" };
  if (probe.code !== 0) return { kind: "refused", detail: probe.stderr.trim() || `git ls-remote exited ${probe.code}` };
  const push = runGit(dir, ["push", "--quiet", remote, "--delete", branch], { timeoutMs: REMOTE_TIMEOUT_MS });
  if (push.code !== 0) return { kind: "refused", detail: push.stderr.trim() || `git push exited ${push.code}` };
  return { kind: "deleted" };
}

/**
 * Whether a local branch has reached `remote`: a remote-tracking ref of the same name exists
 * (`git push [-u] <remote> <branch>` writes one). A configured upstream alone does not count —
 * it may point at another branch. Null when the local branch no longer exists.
 */
export function branchPushed(dir: string, remote: string, branch: string): boolean | null {
  assertSafeArg("branch", branch);
  if (runGit(dir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).code !== 0) return null;
  return runGit(dir, ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`]).code === 0;
}

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GH_LOOKUP_TIMEOUT_MS, gh } from "../integrations/github.js";
import { ProjectConfigError, readProjectConfig } from "../project/config.js";
import { detectRepository } from "../project/repository.js";

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
/**
 * True for the errors the git helpers here and in workflow/living-docs.ts throw on a failed git call
 * (message prefixed "git …") or a refused ref ("Refusing unsafe …"). Callers turn only these into a
 * docs_git_failed finding and rethrow anything else, so a programming bug still crashes with its stack.
 */
export function isGitFailure(err: unknown): err is Error {
  return err instanceof Error && err.constructor === Error && /^(git |Refusing unsafe )/.test(err.message);
}

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

/** Stages everything and commits with the message passed via file; hooks and signing run as configured unless `noVerify` skips the hooks. */
export function commitAll(dir: string, message: string, opts: { timeoutMs?: number; noVerify?: boolean } = {}): CommitResult {
  const add = runGit(dir, ["add", "-A"], opts);
  if (add.code !== 0) return { ok: false, error: add.stderr.trim() || add.stdout.trim() };
  const tmp = mkdtempSync(join(tmpdir(), "kf-commit-"));
  try {
    const file = join(tmp, "message");
    writeFileSync(file, message);
    const commit = runGit(dir, ["commit", ...(opts.noVerify ? ["--no-verify"] : []), "-F", file], opts);
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

export function addDetachedWorktree(repoDir: string, path: string, sha: string): void {
  assertSafeArg("path", path);
  assertSafeArg("ref", sha);
  git(repoDir, ["worktree", "add", "--detach", path, sha]);
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

/**
 * runGit against a remote, bounded by REMOTE_TIMEOUT_MS. A timeout comes back as a failed
 * result (code -1, the reason in stderr), so callers past irreversible steps report an
 * unreachable remote instead of throwing; a git that cannot spawn at all still throws.
 */
export function runRemoteGit(dir: string, args: string[]): GitResult {
  try {
    return runGit(dir, args, { timeoutMs: REMOTE_TIMEOUT_MS });
  } catch (err) {
    const code = err instanceof Error && err.cause instanceof Error ? (err.cause as NodeJS.ErrnoException).code : undefined;
    if (code !== "ETIMEDOUT") throw err;
    return { code: -1, stdout: "", stderr: `git ${args[0]} timed out after ${REMOTE_TIMEOUT_MS / 1000}s` };
  }
}

/** True when `dir` is inside a git work tree; false outside one. */
export function insideWorkTree(dir: string): boolean {
  const res = runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
  return res.code === 0 && res.stdout.trim() === "true";
}

export function hasRemote(dir: string, remote: string): boolean {
  assertSafeArg("remote", remote);
  // Listing instead of `get-url`: its exit code for a missing remote differs across git versions.
  const res = runGit(dir, ["remote"]);
  if (res.code !== 0) throw new Error(`git remote failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
  return res.stdout.split("\n").some((name) => name.trim() === remote);
}

/** `origin/<default>` from `refs/remotes/origin/HEAD`, or null when origin/HEAD is not set. */
export function originDefaultRef(dir: string): string | null {
  const res = runGit(dir, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (res.code === 0) return res.stdout.trim() || null;
  // -q makes "not a symbolic ref / no such ref" exit 1 silently; anything else is a real failure.
  if (res.code === 1) return null;
  throw new Error(`git symbolic-ref refs/remotes/origin/HEAD failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
}

export type LandedProof =
  /** `content`: every canonical doc is byte-identical on origin/<default> (docsLandedProof). */
  | { landed: true; by: "ancestor" | "merged-pr" | "content" }
  /**
   * Not landed, or a check could not run (no GitHub repository, gh missing, failing or timing
   * out): unproven is not landed. `pushed: false` means nothing records a push of the branch (no
   * upstream configured, no remote-tracking ref or its reflog) and no merged PR was found for it.
   * `gone: true` means the local branch no longer exists and either the merged-PR lookup ran and
   * found no PR that carries these docs, or no docs commit was recorded to look for, or origin or
   * origin/HEAD is missing so no check ran at all (then `remedy` is set): nothing is left to push
   * and nothing proves they landed.
   * `reason` is one line; callers show it only when `pushed` is true.
   * `remedy` is a command the human must run before anything can be proven or re-landed; callers
   * show it as the action when present.
   */
  | { landed: false; pushed: boolean; gone?: true; reason?: string; remedy?: string };

/** State shared by the landedProof calls of one command run. */
export interface LandedRun {
  /** The repository merged PRs are looked up in, resolved on first use. */
  repository?: { repo: string | null } | { error: string };
  /** Set by the first gh lookup that timed out; the run's later lookups are skipped. */
  ghTimedOut?: boolean;
}

const DETAIL_MAX = 200;

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** gh's or the config's own text embedded in a reason: kf's words around it are never cut. */
function detail(text: string): string {
  const line = oneLine(text);
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

function unproven(reason: string): { landed: false; pushed: true; reason: string } {
  return { landed: false, pushed: true, reason: oneLine(reason) };
}

/** The repository merged PRs are looked up in: the configured one, else the origin URL's. */
function landedRepository(root: string): { repo: string | null } | { error: string } {
  try {
    return { repo: readProjectConfig(root).repository ?? detectRepository(root) };
  } catch (err) {
    if (err instanceof ProjectConfigError) return { error: `the project config is invalid (${detail(err.message)})` };
    throw err;
  }
}

/** Merged PRs whose head branch is `branch`, or why they could not be looked up. */
function mergedPrs(root: string, branch: string, run: LandedRun): { prs: unknown[] } | { failure: string } {
  if (run.ghTimedOut) return { failure: "the merged-PR lookup was skipped after a gh timeout in this run" };
  const found = run.repository ??= landedRepository(root);
  if ("error" in found) return { failure: `${found.error}, so a merged PR cannot be checked` };
  const repo = found.repo;
  if (!repo) return { failure: "origin is not a GitHub repository, so a merged PR cannot be checked" };
  const res = gh(["pr", "list", "-R", repo, "--head", branch, "--state", "merged", "--json", "number,headRefOid"], { timeoutMs: GH_LOOKUP_TIMEOUT_MS });
  if (res.missing) return { failure: "gh CLI not found, so a merged PR cannot be checked" };
  if (!res.ok) {
    // One hung gh must not cost every later item its timeout too.
    if (res.timedOut) run.ghTimedOut = true;
    return { failure: `gh pr list failed: ${detail(res.stderr.trim() || res.stdout.trim())}` };
  }
  let prs: unknown;
  try {
    prs = JSON.parse(res.stdout);
  } catch (err) {
    return { failure: `gh pr list returned unparseable output (${detail((err as Error).message)}): ${detail(res.stdout)}` };
  }
  if (!Array.isArray(prs)) return { failure: `gh pr list returned unexpected output: ${detail(res.stdout)}` };
  return { prs };
}

/**
 * Anything here that records a push of `branch` to origin. A push without -u leaves no upstream
 * config, and a prune removes the remote-tracking ref together with its reflog, so a branch
 * without a trace may still have been pushed: the merged-PR lookup runs either way.
 */
function pushTrace(root: string, branch: string): boolean {
  return runGit(root, ["config", "--get", `branch.${branch}.remote`]).code === 0
    || runGit(root, ["reflog", "exists", `refs/remotes/origin/${branch}`]).code === 0
    || revParse(root, `refs/remotes/origin/${branch}`) !== null;
}

/**
 * Whether a local branch's work reached origin's default branch: its tip is an ancestor of
 * origin/<default>, or GitHub has a merged PR whose head is this branch at this tip, or at a
 * local commit the tip is an ancestor of (the squash merge case, where the tip is never an
 * ancestor). A deleted or pruned upstream proves nothing — a PR closed unmerged leaves the same
 * trace. When the local branch is gone, `commit` (the docs commit recorded at close) stands in
 * for the tip. Without either, a merged PR with this head name proves nothing (the name
 * `docs/<context>-<feature>` is reused when an item of that name closes again), so gh is not asked.
 */
export function landedProof(root: string, branch: string, commit?: string, run: LandedRun = {}): LandedProof {
  assertSafeArg("branch", branch);
  const tip = revParse(root, `refs/heads/${branch}`);
  if (!tip) return goneProof(root, branch, commit, run);
  const base = originDefaultRef(root);
  if (base && runGit(root, ["merge-base", "--is-ancestor", tip, base]).code === 0) return { landed: true, by: "ancestor" };
  const proof = mergedPrProof(root, branch, tip, run);
  if (proof.landed || pushTrace(root, branch)) return proof;
  return { ...proof, pushed: false };
}

/** The first half of every gone reason. */
export const goneBranchText = (branch: string): string =>
  `local branch ${branch} is gone and there is no remote-tracking ref for it here, so there is nothing to push`;

function goneProof(root: string, branch: string, commit: string | undefined, run: LandedRun): LandedProof {
  // Without a commit no merged PR can prove anything (the name is reused), so gh is not asked.
  if (!commit) return { ...unproven(`${goneBranchText(branch)}; no docs commit was recorded to tie a merged PR to these docs`), gone: true };
  const base = originDefaultRef(root);
  if (base && isAncestor(root, commit, base)) return { landed: true, by: "ancestor" };
  return goneLookupProof(root, branch, commit, run);
}

export function isAncestor(dir: string, commit: string, ref: string): boolean {
  assertSafeArg("commit", commit);
  assertSafeArg("ref", ref);
  return runGit(dir, ["merge-base", "--is-ancestor", commit, ref]).code === 0;
}

/** The merged-PR half of the proof for a gone branch whose recorded docs commit is not an ancestor of origin/<default>. */
export function goneLookupProof(root: string, branch: string, commit: string, run: LandedRun): LandedProof {
  assertSafeArg("branch", branch);
  assertSafeArg("commit", commit);
  const gone = goneBranchText(branch);
  const lookup = mergedPrs(root, branch, run);
  if ("failure" in lookup) return unproven(`${gone}; ${lookup.failure}`);
  const numbers = lookup.prs
    .map((pr) => (pr as { number?: unknown } | null)?.number)
    .filter((n): n is number => typeof n === "number")
    .map((n) => `#${n}`);
  if (lookup.prs.length === 0) return { ...unproven(`${gone}; no merged PR has ${branch} as its head`), gone: true };
  if (carries(root, commit, prHeads(lookup.prs))) return { landed: true, by: "merged-pr" };
  return { ...unproven(`${gone}; merged PR ${numbers.join(", ") || "(unnumbered)"} for ${branch} does not carry the docs commit ${commit.slice(0, 12)}`), gone: true };
}

function prHeads(prs: unknown[]): string[] {
  return prs
    .map((pr) => (pr as { headRefOid?: unknown } | null)?.headRefOid)
    .filter((oid): oid is string => typeof oid === "string" && /^[0-9a-f]{40,64}$/.test(oid));
}

/** The PR heads whose commit is in this repository. */
function localHeads(root: string, heads: string[]): string[] {
  return heads.filter((oid) => runGit(root, ["cat-file", "-e", `${oid}^{commit}`]).code === 0);
}

/** Whether a merged PR head is `commit` or builds on it. */
function carries(root: string, commit: string, heads: string[]): boolean {
  if (heads.includes(commit)) return true;
  // A commit added to the PR on GitHub before the merge moves its head past the commit; only a head already here can be compared, nothing is fetched.
  return localHeads(root, heads).some((oid) => runGit(root, ["merge-base", "--is-ancestor", commit, oid]).code === 0);
}

function mergedPrProof(root: string, branch: string, tip: string, run: LandedRun): LandedProof {
  const lookup = mergedPrs(root, branch, run);
  if ("failure" in lookup) return unproven(lookup.failure);
  const heads = prHeads(lookup.prs);
  if (carries(root, tip, heads)) return { landed: true, by: "merged-pr" };
  if (heads.length > 0) {
    return unproven(`a merged PR for ${branch} has head ${heads.map((oid) => oid.slice(0, 12)).join(", ")}, not the local tip ${tip.slice(0, 12)}`
      + (localHeads(root, heads).length < heads.length ? " (that head is not available locally to compare; fetch it, or delete the local branch if that PR carried this work)" : ""));
  }
  return unproven(`no merged PR has ${branch} at ${tip.slice(0, 12)} as its head`);
}

/**
 * Blob ids at `ref` of `paths` (relative to `dir`), keyed by the path as given, in one git spawn.
 * A path with no blob there is absent; a `ref` that does not resolve gives an empty map.
 */
export function blobIdsAt(dir: string, ref: string, paths: string[]): Map<string, string> {
  assertSafeArg("ref", ref);
  const ids = new Map<string, string>();
  if (paths.length === 0) return ids;
  const res = runGit(dir, ["ls-tree", "-r", "-z", ref, "--", ...paths]);
  if (res.code !== 0) {
    // Only a dangling ref (e.g. origin/HEAD naming a pruned branch) is "nothing there"; any other failure is real.
    if (revParse(dir, ref) === null) return ids;
    throw new Error(`git ls-tree -r ${ref} failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
  }
  for (const entry of splitZ(res.stdout)) {
    const tab = entry.indexOf("\t");
    const [, type, oid] = entry.slice(0, tab).split(" ");
    if (type === "blob") ids.set(entry.slice(tab + 1), oid);
  }
  return ids;
}

/** The git object id of a blob holding `content`, in the repository's hash (an `oidLength` of 64 is sha256). */
export function blobId(content: Buffer, oidLength: number): string {
  return createHash(oidLength === 64 ? "sha256" : "sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
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
  | { kind: "refused"; detail: string }
  /** The remote branch is not at the commit the caller proved landed — it carries other work, so it is kept. */
  | { kind: "moved"; sha: string };

/**
 * `git push <remote> --delete <branch>` when the branch is on the remote and still points at
 * `expectedSha`, the commit the caller proved landed. The lease makes the remote refuse a
 * branch that moved between the probe and the push; nothing is forced.
 */
export function deleteRemoteBranch(dir: string, remote: string, branch: string, expectedSha: string): RemoteBranchDeletion {
  assertSafeArg("branch", branch);
  assertSafeArg("ref", expectedSha);
  assertSafeArg("remote", remote);
  // The close path reports a failure on either side rather than throwing, so a failing `git remote` is "refused".
  let remoteExists: boolean;
  try {
    remoteExists = hasRemote(dir, remote);
  } catch (err) {
    return { kind: "refused", detail: (err as Error).message };
  }
  if (!remoteExists) return { kind: "no-remote" };
  const probe = runRemoteGit(dir, ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`]);
  // --exit-code: 2 means the ref is not there.
  if (probe.code === 2) return { kind: "absent" };
  if (probe.code !== 0) return { kind: "refused", detail: probe.stderr.trim() || `git ls-remote exited ${probe.code}` };
  const remoteSha = probe.stdout.trim().split(/\s+/)[0] ?? "";
  if (remoteSha !== expectedSha) return { kind: "moved", sha: remoteSha };
  const push = runRemoteGit(dir, ["push", "--quiet", `--force-with-lease=refs/heads/${branch}:${expectedSha}`, remote, "--delete", branch]);
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

/** A count of changed files, or null with the reason it could not be made. The reason names no path or host. */
export type ChangedFileCount = { count: number } | { count: null; reason: string };

/** A git failure's message up to " in <dir>": the reason is recorded in the item, which names no machine-local path. */
function withoutDir(message: string): string {
  const at = message.indexOf(" in ");
  return at === -1 ? message : message.slice(0, at);
}

function changedFiles(root: string, base: string, branch: string): ChangedFileCount {
  if (!branch || branch.startsWith("-")) return { count: null, reason: `branch name ${JSON.stringify(branch)} cannot be passed to git` };
  if (runGit(root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]).code !== 0) {
    return { count: null, reason: `branch ${branch} does not exist` };
  }
  const res = runGit(root, ["diff", "--name-only", `${base}...${branch}`, "--"]);
  if (res.code !== 0) return { count: null, reason: `git diff --name-only ${base}...${branch} failed (exit ${res.code})` };
  return { count: res.stdout.split("\n").filter((l) => l.trim() !== "").length };
}

/**
 * The files `branch` changed since it left its base: origin/<default>, or the checkout's HEAD when origin/HEAD is not
 * set, as commitsAhead resolves it. Never throws for a git failure: the count is null and the reason says why.
 */
export function changedFileCount(root: string, branch: string): ChangedFileCount {
  try {
    if (runGit(root, ["rev-parse", "--git-dir"]).code !== 0) return { count: null, reason: "not a git repository" };
    return changedFiles(root, originDefaultRef(root) ?? "HEAD", branch);
  } catch (err) {
    if (isGitFailure(err)) return { count: null, reason: withoutDir(err.message) };
    throw err;
  }
}

/**
 * The files the checkout's current branch changed against origin/<default>, for an item without a worktree. Without
 * origin/HEAD there is no base apart from the checkout itself, so the count is null and the reason says so.
 */
export function checkoutChangedFileCount(root: string): ChangedFileCount {
  try {
    if (runGit(root, ["rev-parse", "--git-dir"]).code !== 0) return { count: null, reason: "not a git repository" };
    const base = originDefaultRef(root);
    if (base === null) return { count: null, reason: "no worktree branch, and origin/HEAD is not set to count the checkout against" };
    const head = runGit(root, ["symbolic-ref", "-q", "--short", "HEAD"]);
    if (head.code !== 0) return { count: null, reason: "no worktree branch, and the checkout is not on a branch" };
    return changedFiles(root, base, head.stdout.trim());
  } catch (err) {
    if (isGitFailure(err)) return { count: null, reason: withoutDir(err.message) };
    throw err;
  }
}

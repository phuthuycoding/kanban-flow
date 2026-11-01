import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { realpathSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import { nowTimestamp } from "../shared/time.js";
import { runHook } from "../integrations/hooks.js";
import { listFeatures, type Feature, type WorktreeRegistration } from "../workflow/features.js";
import {
  allocatePort,
  branchExists,
  gitWorktreePaths,
  isGitRepo,
  unmergedCommitCount,
  worktreeDirty,
  WorktreeDirtyError,
} from "./manager.js";
import { addRoute, removeRoute, readRoutes } from "./routes.js";
import { deleteRemoteBranch, hasRemote, runGit, runRemoteGit, type RemoteBranchDeletion } from "../shared/git.js";
import { assertTaskWorktreesClean, removeTaskWorktrees } from "./tasks.js";
import { worktreeDir, worktreeDomain, worktreeBranch, type WorktreeConfig } from "./config.js";

/**
 * git stores and reports worktree paths canonicalized (e.g. /var → /private/var on macOS).
 * Every path comparison against `git worktree list` must go through the same normalization
 * or a symlinked tmpdir makes a live worktree look absent.
 */
function real(p: string): string {
  return existsSync(p) ? realpathSync(p) : p;
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr).trim() : "";
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`, { cause: err });
  }
}

/** Ensure the top-level dir containing `wtPath` is ignored at `root` when it lives inside the repo. */
function ensureDirIgnored(root: string, wtPath: string): void {
  const rel = relative(realpathSync(root), wtPath);
  if (rel.startsWith("..") || isAbsolute(rel) || !rel) return;
  const top = rel.split(sep)[0] + "/";                    // e.g. ".worktrees/"
  const gi = join(root, ".gitignore");
  const content = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const covered = content.split("\n").some((l) => {
    const t = l.trim();
    return t === top || t === top.slice(0, -1) || t === `/${top}`;
  });
  if (!covered) {
    const pad = content && !content.endsWith("\n") ? "\n" : "";
    writeFileSync(gi, `${content}${pad}# kanban-flow\n${top}\n`, "utf8");
  }
}

function worktreeHook(root: string, feature: Feature, wt: WorktreeRegistration, name: "worktree-create" | "worktree-remove") {
  return {
    env: {
      feature: feature.name,
      context: feature.context,
      dir: feature.dir,
      root,
      from: feature.stage,
      to: feature.stage,
      approval: feature.meta?.approval?.status ?? "pending",
    },
    opts: {
      hookName: name,
      cwd: wt.path,
      env: {
        KFW_WORKTREE_PATH: wt.path,
        KFW_WORKTREE_PORT: String(wt.port),
        KFW_WORKTREE_DOMAIN: wt.domain,
        KFW_WORKTREE_BRANCH: wt.branch,
      },
    },
  };
}

/**
 * Create the worktree + route + registration for an item, or return the existing one.
 * Idempotent: a registered worktree that still exists is reused as-is; one whose
 * directory was deleted is rebuilt from its branch.
 */
export async function ensureWorktree(
  root: string,
  feature: Feature,
  cfg: WorktreeConfig,
): Promise<WorktreeRegistration> {
  const existing = feature.meta?.worktree;
  if (existing && gitWorktreePaths(root).includes(real(existing.path))) {
    // Route may have been lost while the worktree survived — re-register rather than
    // leave the item with a domain that answers nothing.
    await addRoute(cfg.routesFile, existing.domain, {
      port: existing.port,
      repo: root,
      item: feature.name,
      createdAt: existing.createdAt ?? nowTimestamp(),
    });
    return existing;
  }

  if (!isGitRepo(root)) {
    throw new Error(`Cannot create a worktree: ${root} is not a git repository.`);
  }
  const branch = worktreeBranch(cfg, feature.name);
  const domain = worktreeDomain(cfg, feature.name);

  // A leftover directory or admin file must not be mistaken for a live worktree.
  try {
    execFileSync("git", ["-C", root, "worktree", "prune"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    /* prune is best-effort; add below reports a real blockage */
  }

  const rawPath = worktreeDir(cfg, feature.name);
  await mkdir(dirname(rawPath), { recursive: true });
  const path = join(realpathSync(dirname(rawPath)), basename(rawPath));

  // A worktree living inside the repo must be gitignored before the branch is
  // cut — otherwise the main checkout reads dirty on every status. Lazily
  // covers repos initialized before the `.worktrees/` convention existed.
  try {
    ensureDirIgnored(root, path);
  } catch {
    /* ignore-write is best-effort; the worktree still works unignored */
  }

  const createdBranch = !branchExists(root, branch);
  if (createdBranch) {
    git(root, ["worktree", "add", "-b", branch, path]);
  } else {
    if (!existing) {
      throw new Error(
        `Branch '${branch}' exists but is not managed by this work item — refusing to silently adopt it. ` +
        `Remove it (git branch -D ${branch}) or attach it by hand (git worktree add ${path} ${branch}).`,
      );
    }
    // Rebuild after a manual `rm -rf`: the branch carries earlier commits, reuse it.
    git(root, ["worktree", "add", path, branch]);
  }

  const port = existing?.port && !portsTaken(root, cfg, existing.port, feature.name) ? existing.port : allocatePort(root, cfg);
  const registration: WorktreeRegistration = {
    path,
    branch,
    domain,
    port,
    createdAt: existing?.createdAt ?? nowTimestamp(),
  };

  // worktree-create hook: provision the fresh checkout — install deps, seed .env, boot the
  // dev server on $KFW_WORKTREE_PORT. It runs inside the worktree. A failing hook leaves a
  // half-provisioned tree, so the worktree is removed again and the error propagates; the
  // next create/transition starts clean instead of skipping the hook on reuse.
  const { env, opts } = worktreeHook(root, feature, registration, "worktree-create");
  const hook = runHook(root, env, opts);
  if (hook.ran && !hook.ok) {
    try {
      git(root, ["worktree", "remove", "--force", path]);
      if (createdBranch) git(root, ["branch", "-D", branch]);
    } catch {
      /* rollback is best-effort — the hook failure is the error that matters */
    }
    throw new Error(
      `worktree-create hook failed (exit ${hook.code})${hook.output ? `:\n${hook.output}` : ""}`,
    );
  }

  await addRoute(cfg.routesFile, domain, { port, repo: root, item: feature.name, createdAt: registration.createdAt ?? nowTimestamp() });
  return registration;
}

function portsTaken(root: string, cfg: WorktreeConfig, port: number, selfItem: string): boolean {
  for (const f of listFeatures(root)) {
    const wt = f.meta?.worktree;
    if (wt && f.name !== selfItem && wt.port === port) return true;
  }
  for (const entry of Object.values(readRoutesSafe(cfg.routesFile).routes)) {
    if (entry.port === port && !(entry.repo === root && entry.item === selfItem)) return true;
  }
  return false;
}

/** Missing routes file → empty set; a corrupt one must propagate — do not paper over it. */
function readRoutesSafe(file: string) {
  if (!existsSync(file)) return { version: 1 as const, routes: {} };
  return readRoutes(file);
}

export interface TeardownResult {
  removed: boolean;
  /** Commits on kf/<feature> not reachable from HEAD — caller prints the warning. */
  unmergedCommits: number;
  branch: string | null;
  /** Task branches kept after their worktrees were removed. */
  taskBranches: string[];
  /** Non-fatal warnings (e.g. a worktree-remove hook that failed) — callers surface them. */
  warnings: string[];
}

/** worktree-remove hook: cleanup inside the still-present tree (kill dev server, compose
 *  down). Runs before `git worktree remove`; failure is a warning, never a blocker. */
function runRemoveHook(root: string, feature: Feature, wt: WorktreeRegistration, wtPath: string): string[] {
  const { env, opts } = worktreeHook(root, feature, { ...wt, path: wtPath }, "worktree-remove");
  const hook = runHook(root, env, opts);
  return hook.ran && !hook.ok
    ? [`worktree-remove hook failed (exit ${hook.code})${hook.output ? `: ${hook.output}` : ""}`]
    : [];
}

/**
 * Throws when the item worktree or one of its task worktrees holds uncommitted work — the
 * refusal teardown makes, callable before any irreversible step of a close.
 */
export function assertWorktreeClean(root: string, feature: Feature, cfg: WorktreeConfig): void {
  const wt = feature.meta?.worktree;
  if (!wt) return;
  const wtPath = real(wt.path);
  if (gitWorktreePaths(root).includes(wtPath) && worktreeDirty(wtPath)) {
    throw new WorktreeDirtyError(
      `Worktree for '${feature.name}' has uncommitted changes (${wt.path}). ` +
      `Commit them inside the worktree, or discard deliberately: kf worktree remove ${feature.name} --force`,
    );
  }
  assertTaskWorktreesClean(root, feature.name, cfg);
}

export interface BranchDeletion {
  branch: string;
  local: { kind: "deleted" } | { kind: "absent" } | { kind: "kept"; detail: string } | { kind: "failed"; detail: string };
  remote: RemoteBranchDeletion | { kind: "kept"; detail: string };
}

/**
 * What proves the branch's commits landed: the head commit of the merged PR, or the tip the
 * landing rule counted 0 commits ahead of its base. `none` (e.g. a forced close with nothing
 * proven) keeps the branch on both sides.
 */
export type LandedProof =
  | { kind: "merged-head"; sha: string }
  | { kind: "base-tip"; sha: string }
  | { kind: "none"; detail: string };

function localTip(root: string, branch: string): string | null {
  const res = runGit(root, ["rev-parse", "-q", "--verify", `refs/heads/${branch}^{commit}`]);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

function commitsPastHead(count: number): string {
  return count === 0 ? "it is behind the merged head, so deleting it by hand is safe" : `${count} commits after the merged head`;
}

/** "N commits after the merged head", or why the tip cannot be placed relative to it. */
function keptDetail(root: string, branch: string, proof: Exclude<LandedProof, { kind: "none" }>): string {
  if (proof.kind === "base-tip") return `it moved since its commits were counted (tip was ${proof.sha.slice(0, 12)})`;
  const ahead = runGit(root, ["rev-list", "--count", `${proof.sha}..refs/heads/${branch}`]);
  return ahead.code === 0
    ? commitsPastHead(Number(ahead.stdout.trim()) || 0)
    : `its tip is not the merged head ${proof.sha.slice(0, 12)}`;
}

/** A branch kept without proof is "kept" on origin only when it is there; a read-only probe says so. */
function keptRemote(root: string, branch: string, detail: string): BranchDeletion["remote"] {
  let remoteExists: boolean;
  try {
    remoteExists = hasRemote(root, "origin");
  } catch (err) {
    // Reported like a failed probe below: the branch is kept either way, and the close must not throw.
    return { kind: "kept", detail: `${detail} (origin could not be probed: ${(err as Error).message})` };
  }
  if (!remoteExists) return { kind: "no-remote" };
  const probe = runRemoteGit(root, ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`]);
  // --exit-code: 2 means the ref is not there.
  if (probe.code === 2) return { kind: "absent" };
  return { kind: "kept", detail: probe.code === 0 ? detail : `${detail} (origin could not be probed: ${probe.stderr.trim() || `git ls-remote exited ${probe.code}`})` };
}

/**
 * Delete a closed item's branch locally, then on origin — each side only while it still points
 * at the commit `proof` names, so no commit that did not land is deleted. A branch that moved
 * is kept and reported; a failure on either side is reported, never forced, and does not stop
 * the other side. The worktree must already be gone.
 */
export function deleteItemBranch(root: string, branch: string, proof: LandedProof): BranchDeletion {
  if (proof.kind === "none") {
    return {
      branch,
      local: branchExists(root, branch) ? { kind: "kept", detail: proof.detail } : { kind: "absent" },
      remote: keptRemote(root, branch, proof.detail),
    };
  }
  let local: BranchDeletion["local"] = { kind: "absent" };
  const tip = localTip(root, branch);
  if (tip !== null && tip !== proof.sha) {
    local = { kind: "kept", detail: keptDetail(root, branch, proof) };
  } else if (tip !== null) {
    // -D, not -d: a squash or rebase merge leaves the tip unreachable from the default branch,
    // so -d would refuse a branch that did land. The tip check above is the proof -d lacks.
    const res = runGit(root, ["branch", "-D", branch]);
    local = res.code === 0 ? { kind: "deleted" } : { kind: "failed", detail: res.stderr.trim() || `git branch -D exited ${res.code}` };
  }
  return { branch, local, remote: deleteRemoteBranch(root, "origin", branch, proof.sha) };
}

/**
 * Remove worktree + route for an item that is closing. Refuses on a dirty worktree —
 * uncommitted work must be committed or deliberately discarded via `worktree remove --force`.
 */
export async function teardownWorktree(
  root: string,
  feature: Feature,
  cfg: WorktreeConfig,
): Promise<TeardownResult> {
  const wt = feature.meta?.worktree;
  if (!wt) return { removed: false, unmergedCommits: 0, branch: null, taskBranches: [], warnings: [] };

  const wtPath = real(wt.path);
  const missing = !gitWorktreePaths(root).includes(wtPath);
  // Checked before anything is removed so a refusal leaves everything in place.
  assertWorktreeClean(root, feature, cfg);

  const warnings = missing ? [] : runRemoveHook(root, feature, wt, wtPath);
  if (!missing) git(root, ["worktree", "remove", wtPath]);
  const taskBranches = removeTaskWorktrees(root, feature.name, cfg);
  await removeRoute(cfg.routesFile, wt.domain);

  const unmergedCommits = branchExists(root, wt.branch) ? unmergedCommitCount(root, wt.branch) : 0;
  return { removed: !missing, unmergedCommits, branch: wt.branch, taskBranches, warnings };
}

/** Force-remove a worktree regardless of dirty state; the branch always survives. */
export async function forceRemoveWorktree(
  root: string,
  feature: Feature,
  cfg: WorktreeConfig,
): Promise<TeardownResult> {
  const wt = feature.meta?.worktree;
  if (!wt) return { removed: false, unmergedCommits: 0, branch: null, taskBranches: [], warnings: [] };
  const wtPath = real(wt.path);
  const missing = !gitWorktreePaths(root).includes(wtPath);
  const warnings = missing ? [] : runRemoveHook(root, feature, wt, wtPath);
  const taskBranches = removeTaskWorktrees(root, feature.name, cfg, { force: true });
  if (!missing) git(root, ["worktree", "remove", "--force", wtPath]);
  await removeRoute(cfg.routesFile, wt.domain);
  const unmergedCommits = branchExists(root, wt.branch) ? unmergedCommitCount(root, wt.branch) : 0;
  return { removed: !missing, unmergedCommits, branch: wt.branch, taskBranches, warnings };
}

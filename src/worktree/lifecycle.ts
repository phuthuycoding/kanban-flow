import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
} from "./manager.js";
import { addRoute, removeRoute, readRoutes } from "./routes.js";
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
    throw new Error(`Cannot create a worktree: ${root} is not a git repository. Set "worktree.enabled": false in .kf/config.json to opt out.`);
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
 * Remove worktree + route for an item that is closing. Refuses on a dirty worktree —
 * uncommitted work must be committed or deliberately discarded via `worktree remove --force`.
 */
export async function teardownWorktree(
  root: string,
  feature: Feature,
  cfg: WorktreeConfig,
): Promise<TeardownResult> {
  const wt = feature.meta?.worktree;
  if (!wt) return { removed: false, unmergedCommits: 0, branch: null, warnings: [] };

  const wtPath = real(wt.path);
  const missing = !gitWorktreePaths(root).includes(wtPath);
  if (!missing && worktreeDirty(wtPath)) {
    throw new Error(
      `Worktree for '${feature.name}' has uncommitted changes (${wt.path}). ` +
      `Commit them inside the worktree, or discard deliberately: kf worktree remove ${feature.name} --force`,
    );
  }

  const warnings = missing ? [] : runRemoveHook(root, feature, wt, wtPath);
  if (!missing) git(root, ["worktree", "remove", wtPath]);
  await removeRoute(cfg.routesFile, wt.domain);

  const unmergedCommits = branchExists(root, wt.branch) ? unmergedCommitCount(root, wt.branch) : 0;
  return { removed: !missing, unmergedCommits, branch: wt.branch, warnings };
}

/** Force-remove a worktree regardless of dirty state; the branch always survives. */
export async function forceRemoveWorktree(
  root: string,
  feature: Feature,
  cfg: WorktreeConfig,
): Promise<TeardownResult> {
  const wt = feature.meta?.worktree;
  if (!wt) return { removed: false, unmergedCommits: 0, branch: null, warnings: [] };
  const wtPath = real(wt.path);
  const missing = !gitWorktreePaths(root).includes(wtPath);
  const warnings = missing ? [] : runRemoveHook(root, feature, wt, wtPath);
  if (!missing) git(root, ["worktree", "remove", "--force", wtPath]);
  await removeRoute(cfg.routesFile, wt.domain);
  const unmergedCommits = branchExists(root, wt.branch) ? unmergedCommitCount(root, wt.branch) : 0;
  return { removed: !missing, unmergedCommits, branch: wt.branch, warnings };
}

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

import { listFeatures } from "../workflow/features.js";
import { portsInUse, readRoutes } from "./routes.js";
import type { WorktreeConfig } from "./config.js";

export type { WorktreeRegistration } from "../workflow/features.js";

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr).trim() : "";
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`, { cause: err });
  }
}

export function isGitRepo(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--git-dir"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function branchExists(root: string, branch: string): boolean {
  try {
    execFileSync("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/** Paths git currently knows as worktrees (main checkout first). */
export function gitWorktreePaths(root: string): string[] {
  return gitWorktreeEntries(root).map((e) => e.path);
}

interface GitWorktreeEntry {
  path: string;
  branch: string | null;
}

function gitWorktreeEntries(root: string): GitWorktreeEntry[] {
  const out = git(root, ["worktree", "list", "--porcelain"]);
  const entries: GitWorktreeEntry[] = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) entries.push({ path: line.slice(9), branch: null });
    else if (line.startsWith("branch ") && entries.length > 0) {
      entries[entries.length - 1].branch = line.slice(7).replace(/^refs\/heads\//, "");
    }
  }
  return entries;
}

/** Uncommitted or untracked content → teardown must refuse, never silently drop it. */
export function worktreeDirty(path: string): boolean {
  const status = git(path, ["status", "--porcelain"]);
  return status.length > 0;
}

/** Commits on `branch` not yet reachable from the main checkout's HEAD. */
export function unmergedCommitCount(root: string, branch: string): number {
  const n = git(root, ["rev-list", "--count", `HEAD..${branch}`]);
  return Number(n) || 0;
}

/** Ports claimed by item registries under this `.works/` — union with routes file callers add. */
export function registryPortsInUse(root: string): Set<number> {
  const inUse = new Set<number>();
  for (const f of listFeatures(root)) {
    const port = f.meta?.worktree?.port;
    if (typeof port === "number") inUse.add(port);
  }
  return inUse;
}

export function allocatePort(root: string, cfg: WorktreeConfig): number {
  const used = registryPortsInUse(root);
  for (const p of portsInUse(cfg.routesFile)) used.add(p);
  let port = cfg.portBase;
  while (used.has(port)) port += 1;
  if (port > 65000) throw new Error(`worktree port range exhausted (from ${cfg.portBase})`);
  return port;
}

export interface WorktreeListRow {
  item: string;
  stage: string;
  path: string;
  branch: string;
  domain: string;
  port: number;
  dirty: boolean | null;
  /** Item registry points at a path git no longer tracks. */
  missing: boolean;
}

export interface Orphan {
  kind: "missing-worktree" | "unmanaged-worktree" | "stale-route";
  detail: string;
}

export function listWorktrees(root: string, cfg: WorktreeConfig): { items: WorktreeListRow[]; orphans: Orphan[] } {
  // git reports canonicalized paths (/var → /private/var on macOS); normalize before comparing.
  const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);
  const realRoot = real(root);
  const gitPaths = isGitRepo(root) ? gitWorktreePaths(root) : [];
  const items: WorktreeListRow[] = [];
  const orphans: Orphan[] = [];
  const managedPaths = new Set<string>();

  for (const f of listFeatures(root)) {
    const wt = f.meta?.worktree;
    if (!wt) continue;
    const wtPath = real(wt.path);
    managedPaths.add(wtPath);
    const missing = !gitPaths.includes(wtPath);
    items.push({
      item: f.name,
      stage: f.stage,
      path: wt.path,
      branch: wt.branch,
      domain: wt.domain,
      port: wt.port,
      dirty: missing || !existsSync(wt.path) ? null : worktreeDirty(wtPath),
      missing,
    });
    if (missing) orphans.push({ kind: "missing-worktree", detail: `${f.name}: registry path ${wt.path} is not a git worktree` });
  }

  for (const entry of gitWorktreeEntries(root)) {
    if (entry.path === realRoot || managedPaths.has(entry.path)) continue;
    if (entry.branch?.startsWith(cfg.branchPrefix)) {
      orphans.push({ kind: "unmanaged-worktree", detail: `${entry.path} (${entry.branch}) is a git worktree with no .works registry entry` });
    }
  }

  for (const [domain, entry] of Object.entries(readRoutes(cfg.routesFile).routes)) {
    if (real(entry.repo) === realRoot) {
      const stillThere = listFeatures(root).some((f) => f.name === entry.item && f.meta?.worktree?.domain === domain);
      if (!stillThere) orphans.push({ kind: "stale-route", detail: `${domain} → :${entry.port} (item '${entry.item}' has no registry)` });
    }
  }

  return { items, orphans };
}

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { Stage, ApprovalStatus } from "../workflow/schema.js";
import { findWorksRoot } from "../workflow/features.js";
import { readProjectConfig } from "../project/config.js";
import { PKG_ROOT, USER_KABAN_DIR } from "../shared/paths.js";

const PKG_HOOKS_DIR = join(PKG_ROOT, "kanban-flow", "hooks");

export interface HookSource {
  name: string;
  path: string;
  source: "project" | "user" | "package";
}

export interface HookEnv {
  feature: string;
  context: string | null;
  dir: string;
  root: string;
  from: Stage | null;
  to: Stage;
  approval: ApprovalStatus;
}

export interface HookResult {
  hook: HookSource | null;
  ran: boolean;
  ok: boolean;
  code: number;
  output: string;
}

/**
 * Resolve a per-phase hook script. Precedence: project → user → package.
 * Hook file layout: {kanban-dir}/hooks/{phase}.sh — `phase` is a stage name or a
 * named event (e.g. `worktree-create`, `worktree-remove`).
 */
export function resolveHook(
  cwd: string,
  phase: string,
): HookSource | null {
  const candidates: Array<[HookSource["source"], string]> = [
    ["project", join(findWorksRoot(cwd) ?? cwd, ".kf", "hooks", `${phase}.sh`)],
    ["user", join(USER_KABAN_DIR, "hooks", `${phase}.sh`)],
    ["package", join(PKG_HOOKS_DIR, `${phase}.sh`)],
  ];
  for (const [source, path] of candidates) {
    if (existsSync(path)) return { name: phase, path, source };
  }
  return null;
}

/**
 * Run the hook for the phase the feature is about to ENTER.
 * Returns { ok:false } when the hook script exits non-zero — the caller must
 * then refuse the transition (or honor --skip-hooks).
 */
export interface HookRunOpts {
  /** Resolve `<hookName>.sh` instead of `<env.to>.sh`; sent as KFW_EVENT. */
  hookName?: string;
  /** Working directory for the script; defaults to env.dir (the work item's folder). */
  cwd?: string;
  /** Extra environment merged over the standard KFW_* set. */
  env?: Record<string, string>;
}

export function runHook(
  cwd: string,
  env: HookEnv,
  opts: HookRunOpts = {},
): HookResult {
  const hook = resolveHook(cwd, opts.hookName ?? env.to);
  if (!hook) {
    return { hook: null, ran: false, ok: true, code: 0, output: "" };
  }
  const isSh = hook.path.endsWith(".sh");
  const isJs = hook.path.endsWith(".js") || hook.path.endsWith(".mjs") || hook.path.endsWith(".cjs");
  const cmd = isSh ? "bash" : isJs ? "node" : hook.path;
  const args = isSh || isJs ? [hook.path] : [];
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts.cwd ?? env.dir,
    env: {
      ...process.env,
      KFW_FEATURE: env.feature,
      KFW_CONTEXT: env.context ?? "",
      KFW_FEATURE_DIR: env.dir,
      KFW_WORK_ROOT: env.root,
      KFW_FROM_STAGE: env.from ?? "",
      KFW_TO_STAGE: env.to,
      KFW_APPROVAL: env.approval,
      KFW_REPOSITORY: readProjectConfig(env.root).repository ?? "",
      ...(opts.hookName ? { KFW_EVENT: opts.hookName } : {}),
      ...opts.env,
    },
    timeout: 120_000,
  });
  return {
    hook,
    ran: true,
    ok: res.status === 0,
    code: res.status ?? 1,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}${res.error ? `\n${res.error.message}` : ""}${res.signal ? `\nTerminated by ${res.signal}` : ""}`.trim(),
  };
}

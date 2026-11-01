import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { STAGES } from "../workflow/schema.js";
import { PKG_GITHUB_HOOKS_DIR } from "../shared/paths.js";
import type { DoctorFinding } from "./doctor-types.js";

/**
 * Hooks named after stages that no longer exist. resolveHook looks a hook up by the target stage,
 * so shipping.sh never runs again, and dones.sh runs for done only while done.sh is missing.
 * Renaming dones.sh to done.sh keeps it working: done hooks still get the `dones` status name its
 * board move reads.
 */
const ORPHANED_STAGE_HOOKS: Array<{ file: string; action: string; fallbackFor?: string; fallbackAction?: string }> = [
  {
    file: "dones.sh",
    fallbackFor: "done.sh",
    fallbackAction: "kf doctor --fix (renames dones.sh to done.sh, keeping its content), or rename it by hand",
    action: "port any local edits from .kf/hooks/dones.sh into done.sh, then delete dones.sh",
  },
  { file: "shipping.sh", action: "delete .kf/hooks/shipping.sh (the shipping stage is gone; review opens the PR)" },
];

export function checkOrphanedHooks(root: string): DoctorFinding[] {
  const dir = join(root, ".kf", "hooks");
  return ORPHANED_STAGE_HOOKS
    .filter(({ file }) => existsSync(join(dir, file)))
    .map(({ file, action, fallbackFor, fallbackAction }) => {
      const fallback = fallbackFor !== undefined && !existsSync(join(dir, fallbackFor));
      return {
        level: "WARNING" as const,
        area: ".kf/hooks",
        message: fallback
          ? `.kf/hooks/${file} is a legacy hook: it runs for done only because ${fallbackFor} is missing.`
          : `.kf/hooks/${file} is an orphaned legacy hook: no stage runs it any more.`,
        action: fallback ? fallbackAction ?? action : action,
      };
    });
}

/** Pack file names shipped in kanban-flow/hooks/ — the lib plus one hook per stage. */
const GITHUB_HOOK_PACK = ["lib-github.sh", ...STAGES.map((s) => `${s}.sh`)];

/** A shell line that sources the pack's lib; a comment that merely names it does not count. */
const SOURCES_HOOK_LIB = /^\s*(source|\.)\s+.*lib-github\.sh/m;

interface HookPackScan {
  optedIn: boolean;
  /** Contents of the pack files present as regular files and readable. */
  texts: Map<string, string>;
  /** Pack-named entries that are not a readable file, with the cause; doctor reports them instead of crashing. */
  unreadable: Array<{ file: string; cause: string }>;
}

/**
 * Opted in = the pack's lib is there, or a stage hook sources it. A stage-named hook alone is not
 * enough: a project's own done.sh (or a renamed 0.13 dones.sh) must not pull the whole pack in.
 */
function scanHookPack(dir: string): HookPackScan {
  const texts = new Map<string, string>();
  const unreadable: HookPackScan["unreadable"] = [];
  for (const file of GITHUB_HOOK_PACK) {
    const path = join(dir, file);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isFile()) {
      unreadable.push({ file, cause: "not a regular file" });
      continue;
    }
    try {
      texts.set(file, readFileSync(path, "utf8"));
    } catch (err) {
      if (!(err instanceof Error && "code" in err)) throw err;
      unreadable.push({ file, cause: err.message });
    }
  }
  const optedIn = existsSync(join(dir, "lib-github.sh"))
    || STAGES.some((s) => SOURCES_HOOK_LIB.test(texts.get(`${s}.sh`) ?? ""));
  return { optedIn, texts, unreadable };
}

/**
 * The hook pack is opt-in, so its state is only checked once a project opted in (scanHookPack). Missing files get restored by --fix; divergent files are
 * only reported, because a hook the project edited is project-owned and must not be clobbered.
 */
export function checkGithubHooks(root: string): DoctorFinding[] {
  const dir = join(root, ".kf", "hooks");
  const scan = scanHookPack(dir);
  const findings: DoctorFinding[] = scan.unreadable.map(({ file, cause }) => ({
    level: "WARNING" as const,
    area: ".kf/hooks",
    message: `.kf/hooks/${file} cannot be read: ${cause}.`,
    action: `replace .kf/hooks/${file} with a readable hook file, or remove it`,
  }));
  if (!scan.optedIn) return findings;
  const present = GITHUB_HOOK_PACK.filter((f) => existsSync(join(dir, f)));
  const missing = GITHUB_HOOK_PACK.filter((f) => !present.includes(f));
  if (missing.length > 0) {
    findings.push({
      level: "WARNING",
      area: ".kf/hooks",
      message: `GitHub hook pack incomplete: ${missing.join(", ")} missing.`,
      action: "kf doctor --fix",
    });
  }
  for (const f of present) {
    const pkg = join(PKG_GITHUB_HOOKS_DIR, f);
    const text = scan.texts.get(f);
    if (text !== undefined && existsSync(pkg) && readFileSync(pkg, "utf8") !== text) {
      findings.push({
        level: "WARNING",
        area: ".kf/hooks",
        message: `${f} differs from the packaged version.`,
        action: "project-owned — review the diff and refresh by hand if the change is stale",
      });
    }
  }
  return findings;
}

/** The hook repairs of `kf doctor --fix`: the dones.sh rename and the opted-in pack's missing files. */
export function repairHooks(root: string, fixed: string[]): void {
  const hooksDir = join(root, ".kf", "hooks");
  const optedIn = scanHookPack(hooksDir).optedIn;
  // A dones.sh standing in for done.sh is the project's own gate: it is renamed, never replaced by the
  // pack's done.sh, which the restore below would otherwise copy in and so silence it.
  if (existsSync(join(hooksDir, "dones.sh")) && !existsSync(join(hooksDir, "done.sh"))) {
    renameSync(join(hooksDir, "dones.sh"), join(hooksDir, "done.sh"));
    fixed.push("renamed .kf/hooks/dones.sh to done.sh (content kept)");
  }
  // Restore missing pack files only when the project opted in; divergent
  // files stay warnings — a hook the project edited is not ours to overwrite.
  if (optedIn) {
    const missing = GITHUB_HOOK_PACK.filter((f) => !existsSync(join(hooksDir, f)) && existsSync(join(PKG_GITHUB_HOOKS_DIR, f)));
    for (const f of missing) {
      mkdirSync(hooksDir, { recursive: true });
      spawnSync("cp", [join(PKG_GITHUB_HOOKS_DIR, f), join(hooksDir, f)]);
      fixed.push(`restored .kf/hooks/${f} from the packaged hook pack`);
    }
  }
}

import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { cp, lstat, mkdir, rm, symlink, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { findWorksRoot } from "../workflow/features.js";
import { selectOption } from "../project/bootstrap.js";
import { readProjectConfig } from "../project/config.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { CmdResult } from "../cli/result.js";
import {
  AGENTS,
  DEFAULT_AGENT,
  projectSkillsDir,
  userSkillsDir,
  type AgentId,
  type SkillScope,
} from "./agents.js";

export const MANAGED_SKILLS = [
  "kanban-flow",
  "kanban-bug",
  "kanban-brainstorm",
  "kanban-plan",
  "kanban-implement",
  "kanban-test",
  "kanban-review",
  "kanban-archive",
];

const PKG_SKILLS_DIR = join(PKG_ROOT, "skills");

function assertPackageSkills(): CmdResult | null {
  if (!existsSync(PKG_SKILLS_DIR)) {
    return {
      code: 1,
      stdout: `Package skills dir not found: ${PKG_SKILLS_DIR}`,
      stderr: "skills dir missing",
    };
  }
  for (const name of MANAGED_SKILLS) {
    const from = join(PKG_SKILLS_DIR, name);
    if (!existsSync(join(from, "SKILL.md"))) {
      return {
        code: 1,
        stdout: `Package skill missing: ${from}`,
        stderr: "skill missing",
      };
    }
  }
  return null;
}

/** Copy the managed skills from the package into the given skill dir. */
export async function copySkillsTo(skillsDir: string): Promise<CmdResult> {
  const missing = assertPackageSkills();
  if (missing) return missing;
  await mkdir(skillsDir, { recursive: true });
  const copied: string[] = [];
  for (const name of MANAGED_SKILLS) {
    const from = join(PKG_SKILLS_DIR, name);
    await cp(from, join(skillsDir, name), { recursive: true, force: true });
    copied.push(name);
  }

  return { code: 0, stdout: `${copied.join(", ")} → ${skillsDir}/` };
}

export type InstallMode = "link" | "copy";

export interface SkillInstallResult extends CmdResult {
  /** How the managed skills landed — only meaningful when code is 0. */
  mode?: InstallMode;
}

/** True when the running package sits somewhere that gets purged (npx cache) — links would dangle. */
export function packageIsEphemeral(): boolean {
  return PKG_SKILLS_DIR.split(sep).includes("_npx");
}

/** Link each managed skill to the package, copying instead when linking is impossible. */
export async function linkOrCopySkillsTo(skillsDir: string): Promise<SkillInstallResult> {
  const missing = assertPackageSkills();
  if (missing) return missing;
  if (packageIsEphemeral()) {
    const res = await copySkillsTo(skillsDir);
    return { ...res, mode: "copy" };
  }
  await mkdir(skillsDir, { recursive: true });
  const installed: string[] = [];
  let mode: InstallMode = "link";
  for (const name of MANAGED_SKILLS) {
    const from = join(PKG_SKILLS_DIR, name);
    const to = join(skillsDir, name);
    await rm(to, { recursive: true, force: true });
    try {
      await symlink(from, to, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Symlinks are denied in some environments (Windows without Developer Mode,
      // restricted filesystems); the copy keeps the install correct either way.
      await cp(from, to, { recursive: true, force: true });
      mode = "copy";
    }
    installed.push(name);
  }
  return { code: 0, stdout: `${installed.join(", ")} → ${skillsDir}/`, mode };
}

/** Remove the managed skills from the given skill dir (leaves others intact). */
export async function removeSkillsFrom(skillsDir: string): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  for (const name of MANAGED_SKILLS) {
    const target = join(skillsDir, name);
    let st;
    try {
      // lstat (not existsSync): a managed entry may be a symlink, and a dangling one must
      // still be removed — existsSync follows links and would report it absent.
      st = await lstat(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    // Unlink a symlink itself — rm -rf on the link would risk the packaged target.
    if (st.isSymbolicLink()) await unlink(target);
    else await rm(target, { recursive: true, force: true });
    removed.push(name);
  }
  return { removed };
}

export type SkillEntryState = "linked" | "copied" | "stale" | "broken-link" | "missing";

/** State of one managed skill inside a skills dir. */
export function skillEntryState(dir: string, name: string): SkillEntryState {
  const target = join(dir, name);
  let st;
  try {
    st = lstatSync(target);
  } catch {
    return "missing";
  }
  if (st.isSymbolicLink()) {
    const resolved = resolve(dir, readlinkSync(target));
    return existsSync(resolved) ? "linked" : "broken-link";
  }
  if (!existsSync(join(target, "SKILL.md"))) return "missing";
  return dirsEqual(target, join(PKG_SKILLS_DIR, name)) ? "copied" : "stale";
}

export type AgentSkillsState =
  | "linked"
  | "copied"
  | "mixed"
  | "stale"
  | "broken-link"
  | "partial"
  | "missing";

/** Aggregate state of the managed set in one skills dir. "linked"/"copied"/"mixed" are healthy. */
export function agentSkillsState(dir: string): AgentSkillsState {
  const states = MANAGED_SKILLS.map((s) => skillEntryState(dir, s));
  if (states.every((s) => s === "missing")) return "missing";
  if (states.some((s) => s === "broken-link")) return "broken-link";
  if (states.some((s) => s === "stale")) return "stale";
  if (states.some((s) => s === "missing")) return "partial";
  if (states.every((s) => s === "linked")) return "linked";
  if (states.every((s) => s === "copied")) return "copied";
  return "mixed";
}

export function skillsAreHealthy(state: AgentSkillsState): boolean {
  return state === "linked" || state === "copied" || state === "mixed";
}

/** True when at least one managed skill exists (or links) in the dir — catches dangling links too. */
export function hasManagedEntries(dir: string): boolean {
  return MANAGED_SKILLS.some((s) => {
    try {
      lstatSync(join(dir, s));
      return true;
    } catch {
      return false;
    }
  });
}

function dirSnapshot(dir: string, base = dir, out = new Map<string, Buffer>()): Map<string, Buffer> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dirSnapshot(p, base, out);
    else if (e.isFile()) out.set(p.slice(base.length + 1), readFileSync(p));
  }
  return out;
}

/** Byte-for-byte recursive comparison of two skill dirs. */
function dirsEqual(a: string, b: string): boolean {
  const snapA = dirSnapshot(a);
  const snapB = dirSnapshot(b);
  if (snapA.size !== snapB.size) return false;
  for (const [name, bytes] of snapA) {
    const other = snapB.get(name);
    if (!other || !bytes.equals(other)) return false;
  }
  return true;
}

export interface InstallScope {
  cwd?: string;
  /** Explicit `--scope`/`--global`/`--project`; undefined resolves to the configured scope. */
  scope?: SkillScope;
  /** Also delete project data (.works/, .kf/) after confirmation. */
  purge?: boolean;
  /** Skip the interactive purge confirmation (required on non-TTY). */
  force?: boolean;
}

/** Resolve the --scope flag / --global / --project shorthand into a SkillScope. */
export function scopeFromArgs(options: Record<string, unknown>): SkillScope | undefined {
  const scope = typeof options.scope === "string" ? options.scope : undefined;
  const g = Boolean(options.global);
  const p = Boolean(options.project);
  if (g && p) throw new Error("--global and --project cannot be combined");
  const flag = g ? "global" : p ? "project" : scope;
  if (flag !== undefined && flag !== "global" && flag !== "project") {
    throw new Error(`--scope must be "global" or "project", got '${flag}'`);
  }
  if (scope && (g || p) && scope !== flag) {
    throw new Error(`--scope '${scope}' conflicts with ${g ? "--global" : "--project"}`);
  }
  return flag as SkillScope | undefined;
}

const PURGE_DIRS = [".works", ".kf", join("docs", "requirement"), join("docs", "use-cases"), join("docs", "testplan")];

export interface InstallSkillsOptions {
  /** The scope the project declared in config; a "project" declaration is never dismantled. */
  declaredScope?: SkillScope;
}

/**
 * Install the managed skills for each agent at `scope`. Global installs link to the package
 * (copy fallback); project installs always copy. A global install also removes the managed
 * skills from the project's agent dirs — unless the project declared scope "project", where
 * a one-off global install must not dismantle the declared setup.
 */
export async function installSkills(root: string | null, agents: AgentId[], scope: SkillScope, opts: InstallSkillsOptions = {}): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const lines: string[] = [];
  const cleaned: string[] = [];
  let failed = false;
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = scope === "global" ? userSkillsDir(a) : projectSkillsDir(a, root!);
    const res: SkillInstallResult = scope === "global" ? await linkOrCopySkillsTo(dir) : await copySkillsTo(dir);
    failed ||= res.code !== 0;
    const note = scope === "global" && res.code === 0 ? ` (${res.mode === "link" ? "linked" : "copied"})` : "";
    lines.push(res.code === 0 ? `✓ ${a.label}: ${res.stdout}${note}` : `⚠ ${a.label}: ${res.stdout}`);
    // Only clean project copies when the global install actually landed — removing them
    // after a failed install would leave the agent with no skills anywhere.
    if (res.code === 0 && scope === "global" && root && opts.declaredScope !== "project") {
      const projectDir = projectSkillsDir(a, root);
      const { removed } = await removeSkillsFrom(projectDir);
      if (removed.length > 0) cleaned.push(`  ${a.label}: removed ${removed.length} project copies from ${projectDir}/`);
    }
  }
  if (lines.length === 0) {
    return { code: 1, stdout: "No valid agents given for install.", stderr: "no agent" };
  }
  const cleanBlock = cleaned.length > 0 ? `\nCleaned project copies:\n${cleaned.join("\n")}` : "";
  return {
    code: failed ? 1 : 0,
    stderr: failed ? "skill installation failed" : undefined,
    stdout: `Installed kanban skills (${scope}):\n${lines.join("\n")}${cleanBlock}\n\nRestart your AI assistant to detect them.`,
  };
}

/**
 * Install skills at the given scope (default: the project's configured scope, then global).
 * Global installs need no .works/ — outside a project the cleanup step is skipped.
 * Empty/missing agents fall back to the default agent (claude).
 */
export async function cmdInstall(agents: AgentId[] = [DEFAULT_AGENT], opts: InstallScope = {}): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const base = opts.cwd ?? process.cwd();
  const root = findWorksRoot(base);
  const declaredScope = root ? readProjectConfig(root).skills?.scope : undefined;
  const configured = declaredScope ?? "global";
  const scope = opts.scope ?? configured;
  if (scope === "project" && !root) {
    return {
      code: 1,
      stdout: `No kanban project found at ${base} (missing .works/) — run: kf init`,
      stderr: "not a kanban project",
    };
  }
  const res = await installSkills(root, ids, scope, { declaredScope });
  if (res.code !== 0) return res;
  const notes: string[] = [];
  const alsoReads = ids.length === 1 ? AGENTS.find((x) => x.id === ids[0])?.alsoReads.join(", ") ?? "" : "";
  if (alsoReads) notes.push(`Also picked up by: ${alsoReads}`);
  if (opts.scope && opts.scope !== configured) {
    notes.push(`Note: installed at scope "${opts.scope}" while this project declares "${configured}" — both scopes may now hold skills.`);
  }
  return { ...res, stdout: `${res.stdout}${notes.length ? `\n${notes.join("\n")}` : ""}` };
}

/**
 * Remove skills at the given scope (default: the project's configured scope, then global).
 * Resolves the .works root for config and purge; the project-scope dir falls back to cwd so
 * cleanup still works when .works/ was deleted manually. Empty/missing agents fall back to
 * the default agent (claude).
 */
export async function cmdUninstall(agents: AgentId[] = [DEFAULT_AGENT], opts: InstallScope = {}): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const base = opts.cwd ?? process.cwd();
  const foundRoot = findWorksRoot(base);
  const root = foundRoot ?? base;
  const scope = opts.scope ?? (foundRoot ? readProjectConfig(foundRoot).skills?.scope : undefined) ?? "global";
  const purgeTargets = opts.purge ? PURGE_DIRS.filter((d) => existsSync(join(root, d))) : [];
  if (opts.purge && purgeTargets.length > 0 && !opts.force) {
    if (!process.stdin.isTTY) {
      return {
        code: 1,
        stdout: `Refusing to purge project data (${purgeTargets.join(", ")}) in ${root} without confirmation — re-run with --force.`,
        stderr: "purge requires interactive confirmation or --force",
      };
    }
    const pick = await selectOption(
      `Purge permanently deletes in ${root}:\n${purgeTargets.map((d) => `  ${d}/`).join("\n")}\nProceed? (↑/↓ + Enter)`,
      ["Cancel — keep everything", `Purge — delete ${purgeTargets.map((d) => `${d}/`).join(" ")} and project skills`],
    );
    if (pick !== 1) {
      return { code: 0, stdout: "Purge cancelled — nothing removed.\nRun without --purge to remove only skills." };
    }
  }
  const lines: string[] = [];
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = scope === "global" ? userSkillsDir(a) : projectSkillsDir(a, root);
    const { removed } = await removeSkillsFrom(dir);
    lines.push(removed.length > 0 ? `✗ ${a.label}: removed ${removed.length} skills from ${dir}/` : `· ${a.label}: already clean in ${dir}/`);
  }
  if (lines.length === 0) {
    return { code: 1, stdout: "No valid agents given for uninstall.", stderr: "no agent" };
  }
  let purged = "";
  if (opts.purge) {
    if (purgeTargets.length > 0) {
      for (const d of purgeTargets) {
        await rm(join(root, d), { recursive: true, force: true });
      }
      purged = `\nPurged project data: ${purgeTargets.map((d) => `${d}/`).join(" ")}`;
    } else {
      purged = "\nNo project data (.works/, .kf/) found to purge.";
    }
    purged += leftoverIgnoreNote(root);
  }
  const shared = scope === "global" ? "Global skills are shared by every project — other projects lose them too.\n" : "";
  return {
    code: 0,
    stdout: `${shared}${lines.join("\n")}${purged}\n\nCLI still on PATH — unlink with: npm rm -g @phuthuycoding/kanban-flow`,
  };
}

/**
 * `kf init` can add `.works/` to .gitignore. Purge deliberately leaves it: .gitignore belongs to
 * the user and may have been edited by hand. But a command that says it purged the project data
 * has to say what it left behind, or the line only surfaces later, when some unrelated `.works/`
 * is quietly ignored and nobody remembers why.
 */
function leftoverIgnoreNote(root: string): string {
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) return "";
  let body: string;
  try {
    body = readFileSync(gitignore, "utf8");
  } catch {
    // An unreadable .gitignore is not a reason to fail an uninstall that already succeeded.
    return "";
  }
  if (!body.split("\n").some((line) => line.trim() === ".works/")) return "";
  return `\nLeft alone: .gitignore still ignores .works/ — it is your file, so remove that line yourself if you want it gone.`;
}

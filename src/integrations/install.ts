import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { cp, lstat, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { findWorksRoot } from "../workflow/features.js";
import { selectOption } from "../project/bootstrap.js";
import { readProjectConfig } from "../project/config.js";
import { PKG_ROOT } from "../shared/paths.js";
import {
  AGENTS,
  DEFAULT_AGENT,
  projectAgentsDir,
  projectSkillsDir,
  userAgentsDir,
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
  "kanban-ship",
  "kanban-archive",
];

/** Subagent definitions the phase skills dispatch by name; installed only for runtimes with an agent registry. */
export const MANAGED_AGENTS = ["code-reviewer", "scout", "spec-reviewer"];

const PKG_SKILLS_DIR = join(PKG_ROOT, "skills");
/** The agent bodies live inside the kanban-flow skill, so every runtime that has the skill can read them. */
export const PKG_AGENTS_DIR = join(PKG_SKILLS_DIR, "kanban-flow", "agents");

/** Text a caller prints. This module does not depend on the CLI result type. */
export interface InstallReport {
  code: number;
  stdout: string;
  stderr?: string;
}

function assertPackageSkills(): InstallReport | null {
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
export async function copySkillsTo(skillsDir: string): Promise<InstallReport> {
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

export interface SkillInstallResult extends InstallReport {
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

function assertPackageAgents(): InstallReport | null {
  for (const name of MANAGED_AGENTS) {
    const from = join(PKG_AGENTS_DIR, `${name}.md`);
    if (!existsSync(from)) {
      return { code: 1, stdout: `Package agent missing: ${from}`, stderr: "agent missing" };
    }
  }
  return null;
}

export type AgentEntryState = "absent" | "linked" | "copied" | "stale" | "foreign" | "not-file";

/**
 * Sidecar next to the agent files: the sha256 of every copy kanban-flow wrote there. A copy that
 * still hashes to what we wrote is ours even when the package has since moved on ("stale" — the
 * upgrade case); a file that hashes to anything else was edited or created by the user.
 */
const AGENTS_MANIFEST = ".kanban-flow-agents.json";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readAgentsManifest(agentsDir: string): Record<string, string> {
  const path = join(agentsDir, AGENTS_MANIFEST);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch (err) {
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

async function writeAgentsManifest(agentsDir: string, entries: Record<string, string>): Promise<void> {
  await writeFile(join(agentsDir, AGENTS_MANIFEST), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

/**
 * What sits at a managed agent path. The agent names are deliberately unprefixed, so a user's
 * own `code-reviewer.md` is a real possibility: only an entry kanban-flow put there — a symlink
 * into the package, a byte-equal copy of the packaged file, or a copy whose hash the manifest
 * recorded — is ours to replace or remove.
 */
export function agentEntryState(agentsDir: string, name: string): AgentEntryState {
  const target = join(agentsDir, `${name}.md`);
  let st;
  try {
    st = lstatSync(target);
  } catch {
    return "absent";
  }
  const packaged = join(PKG_AGENTS_DIR, `${name}.md`);
  if (st.isSymbolicLink()) {
    const resolved = resolve(agentsDir, readlinkSync(target));
    if (resolved === packaged) return "linked";
    // A link kf made from another install of this package — a different Node version, an
    // npm-link checkout, or a dir that no longer exists — is ours to replace, not the user's.
    const ours = resolved.endsWith(join("kanban-flow", "agents", `${name}.md`));
    return ours || !existsSync(resolved) ? "stale" : "foreign";
  }
  if (!st.isFile()) return "not-file";
  const bytes = readFileSync(target);
  if (existsSync(packaged) && bytes.equals(readFileSync(packaged))) return "copied";
  return readAgentsManifest(agentsDir)[name] === sha256(bytes) ? "stale" : "foreign";
}

export type AgentsState = "linked" | "copied" | "mixed" | "stale" | "partial" | "missing" | "foreign";

/** Aggregate state of the managed agents in one dir. "linked"/"copied"/"mixed" are healthy; "stale" is an outdated copy of ours; "foreign" means a user's file sits at one of the names. */
export function agentsState(agentsDir: string): AgentsState {
  const states = MANAGED_AGENTS.map((a) => agentEntryState(agentsDir, a));
  if (states.some((s) => s === "foreign" || s === "not-file")) return "foreign";
  if (states.every((s) => s === "absent")) return "missing";
  if (states.some((s) => s === "stale")) return "stale";
  if (states.some((s) => s === "absent")) return "partial";
  if (states.every((s) => s === "linked")) return "linked";
  if (states.every((s) => s === "copied")) return "copied";
  return "mixed";
}

export function agentsAreHealthy(state: AgentsState): boolean {
  return state === "linked" || state === "copied" || state === "mixed";
}

const SYMLINK_DENIED = new Set(["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP"]);

/**
 * Link each managed agent file to the package (global), or copy it (project / link denied /
 * ephemeral package). A file kanban-flow does not own is left untouched and named in the result.
 */
export async function installAgentsTo(agentsDir: string, mode: InstallMode): Promise<SkillInstallResult> {
  const missing = assertPackageAgents();
  if (missing) return missing;
  await mkdir(agentsDir, { recursive: true });
  const link = mode === "link" && !packageIsEphemeral();
  let landed: InstallMode = link ? "link" : "copy";
  const installed: string[] = [];
  const skipped: string[] = [];
  const manifest = readAgentsManifest(agentsDir);
  for (const name of MANAGED_AGENTS) {
    const state = agentEntryState(agentsDir, name);
    if (state === "foreign" || state === "not-file") {
      skipped.push(name);
      continue;
    }
    const from = join(PKG_AGENTS_DIR, `${name}.md`);
    const to = join(agentsDir, `${name}.md`);
    await rm(to, { force: true });
    delete manifest[name];
    if (link) {
      try {
        await symlink(from, to, "file");
        installed.push(name);
        continue;
      } catch (err) {
        // A denied symlink (Windows without Developer Mode, restricted filesystems) still gets
        // a correct install by copying; any other error is a real failure and must surface.
        if (!SYMLINK_DENIED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
        landed = "copy";
      }
    }
    await cp(from, to, { force: true });
    manifest[name] = sha256(readFileSync(from));
    installed.push(name);
  }
  await writeAgentsManifest(agentsDir, manifest);
  const skippedNote = skipped.length > 0
    ? `\n  ⚠ left untouched (not kanban-flow's): ${skipped.map((s) => `${s}.md`).join(", ")} in ${agentsDir}/ — the skills will dispatch your file under that name`
    : "";
  return { code: 0, stdout: `${installed.join(", ") || "nothing"} → ${agentsDir}/${skippedNote}`, mode: landed };
}

/** Remove the managed agent files kanban-flow owns from the given dir; a user's own file under a managed name is kept and named. */
export async function removeAgentsFrom(agentsDir: string): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = [];
  const kept: string[] = [];
  const manifest = readAgentsManifest(agentsDir);
  for (const name of MANAGED_AGENTS) {
    const state = agentEntryState(agentsDir, name);
    if (state === "absent") continue;
    if (state === "foreign" || state === "not-file") {
      kept.push(name);
      continue;
    }
    await unlink(join(agentsDir, `${name}.md`));
    delete manifest[name];
    removed.push(name);
  }
  if (removed.length > 0) {
    if (Object.keys(manifest).length > 0) await writeAgentsManifest(agentsDir, manifest);
    else await rm(join(agentsDir, AGENTS_MANIFEST), { force: true });
  }
  return { removed, kept };
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
export async function installSkills(root: string | null, agents: AgentId[], scope: SkillScope, opts: InstallSkillsOptions = {}): Promise<InstallReport> {
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
    // Subagent definitions ride along with the skills, at the same scope, for runtimes that have a registry.
    const agentsDir = scope === "global" ? userAgentsDir(a) : projectAgentsDir(a, root!);
    if (res.code === 0 && agentsDir) {
      const agents = await installAgentsTo(agentsDir, scope === "global" ? "link" : "copy");
      failed ||= agents.code !== 0;
      const agentsNote = scope === "global" && agents.code === 0 ? ` (${agents.mode === "link" ? "linked" : "copied"})` : "";
      lines.push(agents.code === 0 ? `✓ ${a.label} agents: ${agents.stdout}${agentsNote}` : `⚠ ${a.label} agents: ${agents.stdout}`);
      const projectAgents = root ? projectAgentsDir(a, root) : null;
      if (agents.code === 0 && scope === "global" && projectAgents && opts.declaredScope !== "project") {
        const { removed } = await removeAgentsFrom(projectAgents);
        if (removed.length > 0) cleaned.push(`  ${a.label}: removed ${removed.length} project agent copies from ${projectAgents}/`);
      }
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
export async function cmdInstall(agents: AgentId[] = [DEFAULT_AGENT], opts: InstallScope = {}): Promise<InstallReport> {
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
export async function cmdUninstall(agents: AgentId[] = [DEFAULT_AGENT], opts: InstallScope = {}): Promise<InstallReport> {
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
    const agentsDir = scope === "global" ? userAgentsDir(a) : projectAgentsDir(a, root);
    if (agentsDir) {
      const agents = await removeAgentsFrom(agentsDir);
      if (agents.removed.length > 0) lines.push(`✗ ${a.label}: removed ${agents.removed.length} agents from ${agentsDir}/`);
      if (agents.kept.length > 0) lines.push(`· ${a.label}: kept ${agents.kept.map((k) => `${k}.md`).join(", ")} in ${agentsDir}/ — not kanban-flow's`);
    }
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

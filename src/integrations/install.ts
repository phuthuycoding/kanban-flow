import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { cp, lstat, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { findWorksRoot } from "../workflow/features.js";
import { selectOption } from "../project/bootstrap.js";
import { readProjectConfig } from "../project/config.js";
import { isLinkedWorktree, PKG_ROOT } from "../shared/paths.js";
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
import { copyName, MANAGED_AGENTS, MANAGED_SKILLS } from "./managed.js";
import { claudeRunner, ensurePlugin, removePlugin } from "./claude-plugin.js";

export { MANAGED_AGENTS, MANAGED_SKILLS };

/**
 * Skills earlier releases installed that no longer ship. An install removes the leftover entry,
 * but only when kanban-flow demonstrably owns it — a stale skill the agent still loads would keep
 * steering work through a stage that no longer exists.
 */
export const RETIRED_SKILLS = ["kanban-ship"];

/**
 * sha256 of every file each retired skill ever carried (git history of skills/<name>; the
 * released version is the SKILL.md-only one). Project installs copy skills and leave no sidecar,
 * so a directory made only of these files, SKILL.md included, is a leftover copy of ours.
 */
const RETIRED_SKILL_FILES: Record<string, ReadonlySet<string>> = {
  "kanban-ship": new Set([
    "d6b2209dbb677918932c8e1b44cf2ab3c7bbb87875d404f14e2065f8096d6e2c",
    "41cd96b62db45976c1730d7db004dce3a281f9bd80e9b1f55eb9a653db6f3d40",
    "03c9e16efba58a5738f3b95356446d7a5616267790ffcd8cbf5d3ce7eb5b8430",
    "49543bff46f7d245accfce6ed3a42a833e9155dca143be29d47d226bc6dd6fd0",
    "7bad938eb23be4fcfdc3c2f1857352b1f3bd5727b5f448d1ade7285f2dc5cb94",
    "9362ede9d0811015e22882f7016266d23cf7cd2f3038236ed19a4f0939636017",
  ]),
};

/**
 * Managed skills without the kanban- prefix. A user may well have their own skill under such a
 * name, so only an entry kanban-flow put there is replaced or removed: a link into a kanban-flow
 * package, a byte-equal copy of the packaged skill, or a copy whose digest the sidecar recorded.
 */
const UNPREFIXED_SKILLS: ReadonlySet<string> = new Set(["travel"]);

/** Sidecar in the skills dir: the digest of each unprefixed skill copy kanban-flow wrote, so an upgrade still recognises the older copy as ours. */
const SKILLS_MANIFEST = ".kanban-flow-skills.json";

/** The npm package dir name of kanban-flow (the product name), used to recognise links made before the plugin. */
const PRODUCT_PKG_DIR = "kanban-flow";
const PKG_SKILLS_DIR = join(PKG_ROOT, "skills");
/** The agent bodies sit at the plugin root, where Claude Code loads a plugin's agents from. */
export const PKG_AGENTS_DIR = join(PKG_ROOT, "agents");

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

function readSkillsManifest(skillsDir: string): Record<string, string> {
  const path = join(skillsDir, SKILLS_MANIFEST);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch (err) {
    // A corrupt sidecar only means no copy is recognised by digest; the byte-equal check still applies.
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

async function writeSkillsManifest(skillsDir: string, entries: Record<string, string>): Promise<void> {
  const path = join(skillsDir, SKILLS_MANIFEST);
  if (Object.keys(entries).length === 0) await rm(path, { force: true });
  else await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

/** Digest of a skill dir's file contents, keyed by relative path. */
function dirDigest(dir: string): string {
  const snap = dirSnapshot(dir);
  const hash = createHash("sha256");
  for (const name of [...snap.keys()].sort()) hash.update(`${name.split(sep).join("/")}\0${sha256(snap.get(name)!)}\n`);
  return hash.digest("hex");
}

/** True when kanban-flow may replace or remove the entry of managed skill <name> in skillsDir (absent counts). Kanban-prefixed entries are always ours. */
export function ownsSkillEntry(skillsDir: string, name: string, manifest: Record<string, string>): boolean {
  const entry = copyName(name);
  if (!UNPREFIXED_SKILLS.has(entry)) return true;
  const target = join(skillsDir, entry);
  let st;
  try {
    st = lstatSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
  if (st.isSymbolicLink()) return isKanbanFlowSkillLink(skillsDir, name, readlinkSync(target));
  if (!st.isDirectory()) return false;
  if (dirsEqual(target, join(PKG_SKILLS_DIR, name))) return true;
  return manifest[entry] !== undefined && manifest[entry] === dirDigest(target);
}

function untouchedNote(skillsDir: string, skipped: string[]): string {
  return skipped.length > 0
    ? `\n  ⚠ left untouched (not kanban-flow's): ${skipped.join(", ")} in ${skillsDir}/ — move it aside and re-run to install kanban-flow's`
    : "";
}

/** Copy the managed skills from the package into the given skill dir; an unprefixed skill the user owns is skipped and named. */
export async function copySkillsTo(skillsDir: string): Promise<InstallReport> {
  const missing = assertPackageSkills();
  if (missing) return missing;
  await mkdir(skillsDir, { recursive: true });
  const copied: string[] = [];
  const skipped: string[] = [];
  const manifest = readSkillsManifest(skillsDir);
  for (const name of MANAGED_SKILLS) {
    const entry = copyName(name);
    if (!ownsSkillEntry(skillsDir, name, manifest)) {
      skipped.push(entry);
      continue;
    }
    const from = join(PKG_SKILLS_DIR, name);
    const to = join(skillsDir, entry);
    // A link of ours must go first: cp onto it would write through into the package it points at.
    if (UNPREFIXED_SKILLS.has(entry) && lstatSync(to, { throwIfNoEntry: false })?.isSymbolicLink()) await unlink(to);
    await cp(from, to, { recursive: true, force: true });
    if (UNPREFIXED_SKILLS.has(entry)) manifest[entry] = dirDigest(to);
    copied.push(entry);
  }
  await writeSkillsManifest(skillsDir, manifest);

  return { code: 0, stdout: `${copied.join(", ")} → ${skillsDir}/${untouchedNote(skillsDir, skipped)}` };
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

/**
 * Why a global link install must not run from this package, or null when it may. A linked git
 * worktree is transient: links from ~/.<agent> into it dangle once the worktree is removed.
 */
export function globalLinkRefusal(): string | null {
  // The test suite runs inside item worktrees and links into a throwaway HOME, so it opts out.
  if (process.env.KF_ALLOW_WORKTREE_LINK === "1") return null;
  let linked: boolean;
  try {
    linked = isLinkedWorktree(PKG_ROOT);
  } catch (err) {
    // An unreadable .git leaves the question open; refusing is the safe answer, and the code says why.
    if (!(err instanceof Error && "code" in err)) throw err;
    const path = "path" in err && typeof err.path === "string" ? err.path : join(PKG_ROOT, ".git");
    return `kf cannot read ${path} (${String(err.code)}) to tell whether it runs from a linked git worktree; a global install would link into it — run it from the primary checkout`;
  }
  if (!linked) return null;
  return `kf runs from a linked git worktree (${PKG_ROOT}); a global install would link into it and dangle once it is removed — run it from the primary checkout`;
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
  const skipped: string[] = [];
  const manifest = readSkillsManifest(skillsDir);
  let mode: InstallMode = "link";
  for (const name of MANAGED_SKILLS) {
    const entry = copyName(name);
    if (!ownsSkillEntry(skillsDir, name, manifest)) {
      skipped.push(entry);
      continue;
    }
    const from = join(PKG_SKILLS_DIR, name);
    const to = join(skillsDir, entry);
    await rm(to, { recursive: true, force: true });
    delete manifest[entry];
    try {
      await symlink(from, to, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Symlinks are denied in some environments (Windows without Developer Mode,
      // restricted filesystems); the copy keeps the install correct either way.
      await cp(from, to, { recursive: true, force: true });
      if (UNPREFIXED_SKILLS.has(entry)) manifest[entry] = dirDigest(to);
      mode = "copy";
    }
    installed.push(entry);
  }
  await writeSkillsManifest(skillsDir, manifest);
  return { code: 0, stdout: `${installed.join(", ")} → ${skillsDir}/${untouchedNote(skillsDir, skipped)}`, mode };
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
/** A kf package root holds `.claude-plugin/plugin.json` naming the `kf` plugin. An unreadable or non-JSON manifest means not ours. */
function isKfPackageRoot(dir: string): boolean {
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) return false;
    throw err;
  }
  return typeof parsed === "object" && parsed !== null && (parsed as { name?: unknown }).name === "kf";
}

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
    // The package is recognised by its content, not its directory name: a checkout may be named anything.
    // The suffix covers a package dir that carries the product name, in both the plugin layout and the pre-plugin flow skill.
    const ours = isKfPackageRoot(resolve(resolved, "..", "..")) || resolved.endsWith(join(PRODUCT_PKG_DIR, "agents", `${name}.md`));
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

/** Remove the managed skills from the given skill dir (leaves others intact); an unprefixed skill the user owns is kept and named. */
export async function removeSkillsFrom(skillsDir: string): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = [];
  const kept: string[] = [];
  const manifest = readSkillsManifest(skillsDir);
  for (const name of MANAGED_SKILLS) {
    const entry = copyName(name);
    const target = join(skillsDir, entry);
    let st;
    try {
      // lstat (not existsSync): a managed entry may be a symlink, and a dangling one must
      // still be removed — existsSync follows links and would report it absent.
      st = await lstat(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (!ownsSkillEntry(skillsDir, name, manifest)) {
      kept.push(entry);
      continue;
    }
    // Unlink a symlink itself — rm -rf on the link would risk the packaged target.
    if (st.isSymbolicLink()) await unlink(target);
    else await rm(target, { recursive: true, force: true });
    delete manifest[entry];
    removed.push(entry);
  }
  if (removed.length > 0) await writeSkillsManifest(skillsDir, manifest);
  return { removed, kept };
}

/** Packaged skills dirs are laid out as <package>/skills/<name>; a link into one is kanban-flow's. */
function isKanbanFlowSkillLink(skillsDir: string, name: string, target: string): boolean {
  const resolved = resolve(skillsDir, target);
  if (resolved === join(PKG_SKILLS_DIR, name)) return true;
  if (resolved.endsWith(join(sep, "skills", name)) && isKfPackageRoot(resolve(resolved, "..", ".."))) return true;
  // A pre-plugin install linked into the npm package dir, which carries the product name; such a
  // target may already be gone, so only its path can identify it.
  return resolved.endsWith(join(sep, PRODUCT_PKG_DIR, "skills", name));
}

/** True when every entry under dir is a regular file whose sha256 is in `known`, SKILL.md among them. */
function isRetiredSkillCopy(dir: string, known: ReadonlySet<string> | undefined): boolean {
  if (!known || !existsSync(join(dir, "SKILL.md"))) return false;
  const walk = (d: string): boolean => readdirSync(d, { withFileTypes: true }).every((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && known.has(sha256(readFileSync(p)));
  });
  return walk(dir);
}

/**
 * Remove retired skills from a skills dir. A symlink into a kanban-flow package is ours (dangling
 * included), and so is a directory made only of files the retired skill shipped; anything else
 * is reported in `kept` and left alone.
 */
export async function removeRetiredSkills(skillsDir: string): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const name of RETIRED_SKILLS) {
    const target = join(skillsDir, name);
    let st;
    try {
      st = await lstat(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (st.isSymbolicLink() && isKanbanFlowSkillLink(skillsDir, name, readlinkSync(target))) {
      await unlink(target);
      removed.push(name);
    } else if (st.isDirectory() && isRetiredSkillCopy(target, RETIRED_SKILL_FILES[name])) {
      await rm(target, { recursive: true, force: true });
      removed.push(name);
    } else {
      kept.push(name);
    }
  }
  return { removed, kept };
}

export type SkillEntryState = "linked" | "copied" | "stale" | "broken-link" | "missing";

/** State of the entry of managed skill <name> inside a skills dir. */
export function skillEntryState(dir: string, name: string): SkillEntryState {
  const target = join(dir, copyName(name));
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

/**
 * Managed skill entries in `dir` held by an entry kanban-flow does not own (a user's own `travel`).
 * The install leaves those alone, so they are neither stale nor something a reinstall repairs.
 */
export function foreignSkills(dir: string): string[] {
  const manifest = readSkillsManifest(dir);
  return MANAGED_SKILLS.filter((s) => !ownsSkillEntry(dir, s, manifest)).map(copyName);
}

/** Managed skill entries in `dir` that are not a healthy link or copy, leaving out the `foreign` entries the user owns. */
export function unhealthySkills(dir: string, foreign: string[]): string[] {
  return MANAGED_SKILLS.filter((s) => !foreign.includes(copyName(s)) && !["linked", "copied"].includes(skillEntryState(dir, s))).map(copyName);
}

/** True when at least one managed skill kanban-flow owns exists (or dangles) in the dir. */
export function hasOwnedEntries(dir: string): boolean {
  const foreign = foreignSkills(dir);
  return MANAGED_SKILLS.some((s) => !foreign.includes(copyName(s)) && lstatSync(join(dir, copyName(s)), { throwIfNoEntry: false }) !== undefined);
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
  const refusal = scope === "global" ? globalLinkRefusal() : null;
  // Exit 1, not 2: this is an install that failed, not a workflow gate refusing a move.
  if (refusal) return { code: 1, stdout: "", stderr: refusal };
  const lines: string[] = [];
  const cleaned: string[] = [];
  let failed = false;
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = scope === "global" ? userSkillsDir(a) : projectSkillsDir(a, root!);
    const res: SkillInstallResult = scope === "global" ? await linkOrCopySkillsTo(dir) : await copySkillsTo(dir);
    failed ||= res.code !== 0;
    if (res.code === 0) {
      const retired = await removeRetiredSkills(dir);
      if (retired.removed.length > 0) cleaned.push(`  ${a.label}: removed retired ${retired.removed.join(", ")} from ${dir}/`);
      for (const name of retired.kept) lines.push(`⚠ ${a.label}: ${name} in ${dir}/ is not kanban-flow's — left untouched; remove it yourself if unwanted`);
    }
    const note = scope === "global" && res.code === 0 ? ` (${res.mode === "link" ? "linked" : "copied"})` : "";
    lines.push(res.code === 0 ? `✓ ${a.label}: ${res.stdout}${note}` : `⚠ ${a.label}: ${res.stdout}`);
    // Only clean project copies when the global install actually landed — removing them
    // after a failed install would leave the agent with no skills anywhere.
    if (res.code === 0 && scope === "global" && root && opts.declaredScope !== "project") {
      const projectDir = projectSkillsDir(a, root);
      const { removed, kept } = await removeSkillsFrom(projectDir);
      if (removed.length > 0) cleaned.push(`  ${a.label}: removed ${removed.length} project copies from ${projectDir}/`);
      if (kept.length > 0) cleaned.push(`  ${a.label}: kept ${kept.join(", ")} in ${projectDir}/ — not kanban-flow's`);
      const retired = await removeRetiredSkills(projectDir);
      if (retired.removed.length > 0) cleaned.push(`  ${a.label}: removed retired ${retired.removed.join(", ")} from ${projectDir}/`);
      for (const name of retired.kept) lines.push(`⚠ ${a.label}: ${name} in ${projectDir}/ is not kanban-flow's — left untouched; remove it yourself if unwanted`);
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
  const wantsPlugin = ids.includes("claude");
  // The marketplace would record this package root, which dangles once a linked worktree is removed.
  const refusal = wantsPlugin && scope === "global" ? globalLinkRefusal() : null;
  if (refusal) return { code: 1, stdout: "", stderr: refusal };
  // Claude Code loads skills and agents from the kf plugin, so nothing is copied for it.
  const plugin = wantsPlugin ? await ensurePlugin(scope, claudeRunner(root ?? base)) : null;
  const copied = ids.filter((id) => id !== "claude");
  const res = copied.length > 0 ? await installSkills(root, copied, scope, { declaredScope }) : null;
  const reports = [plugin, res].filter((r) => r !== null);
  const joined = reports.map((r) => r.stdout).filter(Boolean).join("\n");
  // A failed plugin setup does not keep the other agents from installing; the exit still says it failed.
  const failure = reports.find((r) => r.code !== 0);
  if (failure) return { code: 1, stdout: joined, stderr: failure.stderr };
  // installSkills ends on its own restart hint; a plugin that was only checked needs none.
  const restart = plugin?.changed && !res ? "\n\nRestart Claude Code to load the plugin." : "";
  const body = `${joined}${restart}`;
  const notes: string[] = [];
  // The other runtimes picked up claude's .claude/skills copies; the plugin is read by Claude Code alone.
  const alsoReads = ids.length === 1 && ids[0] !== "claude" ? AGENTS.find((x) => x.id === ids[0])?.alsoReads.join(", ") ?? "" : "";
  if (alsoReads) notes.push(`Also picked up by: ${alsoReads}`);
  if (opts.scope && opts.scope !== configured) {
    notes.push(`Note: installed at scope "${opts.scope}" while this project declares "${configured}" — both scopes may now hold skills.`);
  }
  return { code: 0, stdout: `${body}${notes.length ? `\n${notes.join("\n")}` : ""}` };
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
  let pluginFailed = false;
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    if (id === "claude") {
      const plugin = await removePlugin(scope, claudeRunner(root));
      pluginFailed = plugin.code !== 0;
      lines.push(plugin.stdout);
      continue;
    }
    const dir = scope === "global" ? userSkillsDir(a) : projectSkillsDir(a, root);
    const { removed, kept } = await removeSkillsFrom(dir);
    lines.push(removed.length > 0 ? `✗ ${a.label}: removed ${removed.length} skills from ${dir}/` : `· ${a.label}: already clean in ${dir}/`);
    if (kept.length > 0) lines.push(`· ${a.label}: kept ${kept.join(", ")} in ${dir}/ — not kanban-flow's`);
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
    code: pluginFailed ? 1 : 0,
    ...(pluginFailed ? { stderr: "claude plugin removal failed" } : {}),
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

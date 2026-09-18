import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { findWorksRoot } from "../workflow/features.js";
import { selectOption } from "../project/bootstrap.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { CmdResult } from "../cli/result.js";
import {
  AGENTS,
  DEFAULT_AGENT,
  projectSkillsDir,
  userSkillsDir,
  type AgentId,
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

/** Copy the managed skills from the package into the given skill dir. */
export async function copySkillsTo(skillsDir: string): Promise<CmdResult> {
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
  await mkdir(skillsDir, { recursive: true });
  const copied: string[] = [];
  for (const name of MANAGED_SKILLS) {
    const from = join(PKG_SKILLS_DIR, name);
    await cp(from, join(skillsDir, name), { recursive: true, force: true });
    copied.push(name);
  }

  return { code: 0, stdout: `${copied.join(", ")} → ${skillsDir}/` };
}

/** Remove the managed skills from the given skill dir (leaves others intact). */
export async function removeSkillsFrom(skillsDir: string): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  for (const name of MANAGED_SKILLS) {
    const target = join(skillsDir, name);
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return { removed };
}

export interface InstallScope {
  cwd?: string;
  /** Operate on project-level dirs ({root}/.claude/skills, ...) instead of user-level. */
  project?: boolean;
  /** Operate on both user and project scopes. */
  all?: boolean;
  /** Also delete project data (.works/, .kf/) after confirmation; implies project scope. */
  purge?: boolean;
  /** Skip the interactive purge confirmation (required on non-TTY). */
  force?: boolean;
}

const PURGE_DIRS = [".works", ".kf", join("docs", "requirement"), join("docs", "use-cases"), join("docs", "testplan")];

function scopesFor(opts: InstallScope): Array<"user" | "project"> {
  if (opts.all) return ["user", "project"];
  if (opts.project || opts.purge) return ["project"];
  return ["user"];
}

function projectRoot(cwd: string | undefined): string {
  const base = cwd ?? process.cwd();
  return findWorksRoot(base) ?? base;
}

/**
 * Install skills into each agent's skill dir for the chosen scope.
 * Empty/missing agents fall back to the default agent (claude).
 */
export async function cmdInstall(agents: AgentId[] = [DEFAULT_AGENT], opts: InstallScope = {}): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const scopes = scopesFor(opts);
  const root = projectRoot(opts.cwd);
  const sections: string[] = [];
  let failed = false;
  for (const scope of scopes) {
    const lines: string[] = [];
    for (const id of ids) {
      const a = AGENTS.find((x) => x.id === id);
      if (!a) continue;
      const dir = scope === "user" ? userSkillsDir(a) : projectSkillsDir(a, root);
      const res = await copySkillsTo(dir);
      failed ||= res.code !== 0;
      lines.push(res.code === 0 ? `✓ ${a.label}: ${res.stdout}` : `⚠ ${a.label}: ${res.stdout}`);
    }
    if (lines.length > 0) {
      sections.push(scopes.length > 1 ? `${scope === "user" ? "User" : "Project"} scope:\n${lines.join("\n")}` : lines.join("\n"));
    }
  }
  if (sections.length === 0) {
    return { code: 1, stdout: "No valid agents given for install.", stderr: "no agent" };
  }
  const alsoReads = ids.length === 1 ? AGENTS.find((x) => x.id === ids[0])?.alsoReads.join(", ") ?? "" : "";
  const note = alsoReads ? `\nAlso picked up by: ${alsoReads}` : "";
  return {
    code: failed ? 1 : 0,
    stdout: `Installed kanban skills:\n${sections.join("\n\n")}${note}\n\nRestart your AI assistant to detect them.`,
    stderr: failed ? "skill installation failed" : undefined,
  };
}

/**
 * Remove skills from each agent's skill dir for the chosen scope.
 * Empty/missing agents fall back to the default agent (claude).
 */
export async function cmdUninstall(agents: AgentId[] = [DEFAULT_AGENT], opts: InstallScope = {}): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const scopes = scopesFor(opts);
  const root = projectRoot(opts.cwd);
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
  const sections: string[] = [];
  for (const scope of scopes) {
    const lines: string[] = [];
    for (const id of ids) {
      const a = AGENTS.find((x) => x.id === id);
      if (!a) continue;
      const dir = scope === "user" ? userSkillsDir(a) : projectSkillsDir(a, root);
      const { removed } = await removeSkillsFrom(dir);
      lines.push(removed.length > 0 ? `✗ ${a.label}: removed ${removed.length} skills from ${dir}/` : `· ${a.label}: already clean in ${dir}/`);
    }
    if (lines.length > 0) {
      sections.push(scopes.length > 1 ? `${scope === "user" ? "User" : "Project"} scope:\n${lines.join("\n")}` : lines.join("\n"));
    }
  }
  if (sections.length === 0) {
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
  }
  const leftovers = scopes.length === 1 && scopes[0] === "user" ? projectLeftovers(ids, root) : [];
  const hint = leftovers.length > 0 ? `\nProject-level skills remain in ${leftovers.join(", ")} — remove with: kf uninstall --project` : "";
  return {
    code: 0,
    stdout: `${sections.join("\n\n")}${hint}${purged}\n\nCLI still on PATH — unlink with: npm rm -g kaban-flow`,
  };
}

function projectLeftovers(ids: AgentId[], root: string): string[] {
  const dirs: string[] = [];
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = projectSkillsDir(a, root);
    if (MANAGED_SKILLS.some((name) => existsSync(join(dir, name)))) dirs.push(`${dir}/`);
  }
  return dirs;
}

/** Install the managed kanban skills into each agent's project-level dir (e.g. ./.claude/skills). */
export async function installProjectSkills(root: string, agents: AgentId[] = [DEFAULT_AGENT]): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const lines: string[] = [];
  let failed = false;
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = projectSkillsDir(a, root);
    const res = await copySkillsTo(dir);
    failed ||= res.code !== 0;
    lines.push(res.code === 0 ? `✓ ${a.label}: ${res.stdout}` : `⚠ ${a.label}: ${res.stdout}`);
  }
  return {
    code: failed ? 1 : 0,
    stderr: failed ? "skill installation failed" : undefined,
    stdout: `Installed kanban skills:\n${lines.join("\n")}\n\nRestart your AI assistant to detect them.`,
  };
}

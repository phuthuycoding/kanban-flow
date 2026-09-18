import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

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

function userResult(title: string, lines: string[], agentLabel: string, failed: boolean): CmdResult {
  const head = `${title}:\n${lines.join("\n")}\n`;
  const note = agentLabel
    ? `\nAlso picked up by: ${agentLabel}\n\nRestart your AI assistant to detect them.`
    : "\n\nRestart your AI assistant to detect them.";
  return { code: failed ? 1 : 0, stdout: head + note, stderr: failed ? "skill installation failed" : undefined };
}

/**
 * Install skills into each agent's user-level skill dir. Empty/missing agents
 * fall back to the default agent (claude).
 */
export async function cmdInstall(agents: AgentId[] = [DEFAULT_AGENT]): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const lines: string[] = [];
  let failed = false;
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = userSkillsDir(a);
    const res = await copySkillsTo(dir);
    failed ||= res.code !== 0;
    lines.push(res.code === 0 ? `✓ ${a.label}: ${res.stdout}` : `⚠ ${a.label}: ${res.stdout}`);
  }
  if (lines.length === 0) {
    return { code: 1, stdout: "No valid agents given for install.", stderr: "no agent" };
  }
  return userResult("Installed kanban skills", lines, ids.length === 1 ? AGENTS.find((x) => x.id === ids[0])?.alsoReads.join(", ") ?? "" : "", failed);
}

/**
 * Remove skills from each agent's user-level skill dir. Empty/missing agents
 * fall back to the default agent (claude).
 */
export async function cmdUninstall(agents: AgentId[] = [DEFAULT_AGENT]): Promise<CmdResult> {
  const ids = agents.length > 0 ? agents : [DEFAULT_AGENT];
  const lines: string[] = [];
  for (const id of ids) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    const dir = userSkillsDir(a);
    const { removed } = await removeSkillsFrom(dir);
    lines.push(removed.length > 0 ? `✗ ${a.label}: removed ${removed.length} skills from ${dir}/` : `· ${a.label}: already clean in ${dir}/`);
  }
  if (lines.length === 0) {
    return { code: 1, stdout: "No valid agents given for uninstall.", stderr: "no agent" };
  }
  return {
    code: 0,
    stdout: `${lines.join("\n")}\n\nCLI still on PATH — unlink with: npm rm -g kaban-flow`,
  };
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

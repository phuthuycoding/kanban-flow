import { homedir } from "node:os";
import { join, win32 } from "node:path";

import { copyName } from "./managed.js";
import { renderAgentProfile } from "./skill-render.js";
import type { AgentTarget } from "./install.js";

export type AgentId = "claude" | "codex" | "gemini" | "kiro" | "cursor" | "opencode" | "devin";

/** Where managed skills are installed: the user's home (default) or the project. */
export type SkillScope = "global" | "project";
export const SKILL_SCOPES: readonly SkillScope[] = ["global", "project"];

export interface AgentAdapter {
  id: AgentId;
  label: string;
  /** Path relative to a project root where project-level skills live. */
  projectRel: string;
  /** Path relative to the user's home dir where user-level (global) skills live. */
  userRel: string;
  /** Other agents that also discover this agent's directory (open standard). */
  alsoReads: AgentId[];
  /** Project-relative dir for subagent definitions; only runtimes with an agent registry declare one. */
  agentsRel?: string;
  /** Home-relative dir for user-level subagent definitions. */
  userAgentsRel?: string;
  /** Dir relative to %APPDATA% where user-level subagent definitions live on win32; POSIX uses userAgentsRel. */
  userAgentsAppDataRel?: string;
  /** How the runtime's registry takes the managed seats; absent is the default target — `<seat>.md` packaged bytes, links allowed. */
  agentTarget?: AgentTarget;
}

export const AGENTS: AgentAdapter[] = [
  {
    id: "claude",
    label: "Claude Code",
    projectRel: ".claude/skills",
    userRel: ".claude/skills",
    alsoReads: ["cursor", "opencode", "devin"],
    agentsRel: ".claude/agents",
    userAgentsRel: ".claude/agents",
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    projectRel: ".agents/skills",
    userRel: ".agents/skills",
    alsoReads: ["gemini", "cursor", "opencode", "devin"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    projectRel: ".agents/skills",
    userRel: ".agents/skills",
    alsoReads: ["codex", "cursor", "opencode", "devin"],
  },
  {
    id: "kiro",
    label: "Kiro",
    projectRel: ".kiro/skills",
    userRel: ".kiro/skills",
    alsoReads: [],
  },
  {
    id: "cursor",
    label: "Cursor",
    projectRel: ".agents/skills",
    userRel: ".agents/skills",
    alsoReads: ["codex", "gemini", "opencode", "devin"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    projectRel: ".agents/skills",
    userRel: ".agents/skills",
    alsoReads: ["codex", "gemini", "cursor", "devin"],
  },
  {
    id: "devin",
    label: "Devin",
    projectRel: ".agents/skills",
    userRel: ".agents/skills",
    alsoReads: ["codex", "gemini", "cursor", "opencode"],
    agentsRel: ".devin/agents",
    userAgentsRel: ".config/devin/agents",
    userAgentsAppDataRel: "devin/agents",
    agentTarget: {
      managedName: copyName,
      expectedBytes: renderAgentProfile,
      linkAllowed: false,
    },
  },
];

/** Default agent used when the user does not pick one (non-interactive). */
export const DEFAULT_AGENT: AgentId = "claude";

export function agentById(id: string): AgentAdapter | null {
  return AGENTS.find((a) => a.id === id) ?? null;
}

export function projectSkillsDir(agent: AgentAdapter, root: string): string {
  return join(root, agent.projectRel);
}

/** The agent's user-level (global) skills dir under `home` — homedir() by default. */
export function userSkillsDir(agent: AgentAdapter, home: string = homedir()): string {
  return join(home, agent.userRel);
}

/** The agent's project-level subagent dir, or null when the runtime has no agent registry. */
export function projectAgentsDir(agent: AgentAdapter, root: string): string | null {
  return agent.agentsRel ? join(root, agent.agentsRel) : null;
}

/**
 * The agent's user-level subagent dir under `home`, or null when the runtime has none. `platform`
 * is injectable so the win32 branch — a dir under %APPDATA% — is testable on POSIX.
 */
export function userAgentsDir(agent: AgentAdapter, home: string = homedir(), platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "win32" && agent.userAgentsAppDataRel) {
    const appData = process.env.APPDATA ?? win32.join(home, "AppData", "Roaming");
    return win32.join(appData, agent.userAgentsAppDataRel);
  }
  return agent.userAgentsRel ? join(home, agent.userAgentsRel) : null;
}

/** Normalize raw CLI option values into a de-duped list of known agent ids. */
export function parseAgentIds(raw: unknown): AgentId[] {
  const vals = Array.isArray(raw) ? raw.map(String) : raw != null ? [String(raw)] : [];
  const seen = new Set<AgentId>();
  for (const v of vals) {
    const a = agentById(v);
    if (!a) throw new Error(`Unknown agent '${v}'. Supported agents: ${AGENTS.map((x) => x.id).join(", ")}.`);
    seen.add(a.id);
  }
  return [...seen];
}

/** Skills dir for any agent name: the adapter's dir when known, else the open `.agents/skills` standard. */
export function skillsDirFor(name: string, root: string): string {
  const adapter = agentById(name);
  return join(root, adapter ? adapter.projectRel : ".agents/skills");
}

export function agentLabel(id: string): string {
  return agentById(id)?.label ?? id;
}

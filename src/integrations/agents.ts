import { homedir } from "node:os";
import { join } from "node:path";

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
}

export const AGENTS: AgentAdapter[] = [
  {
    id: "claude",
    label: "Claude Code",
    projectRel: ".claude/skills",
    userRel: ".claude/skills",
    alsoReads: ["cursor", "opencode", "devin"],
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
    projectRel: ".gemini/skills",
    userRel: ".gemini/skills",
    alsoReads: ["codex", "cursor", "opencode"],
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
    projectRel: ".cursor/skills",
    userRel: ".cursor/skills",
    alsoReads: ["codex", "gemini", "opencode", "devin"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    projectRel: ".opencode/skills",
    // OpenCode's documented global dir lives under XDG config, not ~/.opencode.
    userRel: ".config/opencode/skills",
    alsoReads: ["codex", "gemini", "cursor"],
  },
  {
    id: "devin",
    label: "Devin",
    projectRel: ".devin/skills",
    // Devin reads the open-standard dir at user level (~/.agents/skills).
    userRel: ".agents/skills",
    alsoReads: [],
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

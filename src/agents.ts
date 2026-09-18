import { homedir } from "node:os";
import { join } from "node:path";

export type AgentId = "claude" | "codex" | "gemini" | "kiro" | "cursor" | "opencode";

export interface AgentAdapter {
  id: AgentId;
  label: string;
  /** Path relative to $HOME where user-level skills live. */
  userRel: string;
  /** Path relative to a project root where project-level skills live. */
  projectRel: string;
  /** Other agents that also discover this agent's directory (open standard). */
  alsoReads: AgentId[];
}

export const AGENTS: AgentAdapter[] = [
  {
    id: "claude",
    label: "Claude Code",
    userRel: ".claude/skills",
    projectRel: ".claude/skills",
    alsoReads: ["cursor", "opencode"],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    userRel: ".agents/skills",
    projectRel: ".agents/skills",
    alsoReads: ["gemini", "cursor", "opencode"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    userRel: ".gemini/skills",
    projectRel: ".gemini/skills",
    alsoReads: ["codex", "cursor", "opencode"],
  },
  {
    id: "kiro",
    label: "Kiro",
    userRel: ".kiro/skills",
    projectRel: ".kiro/skills",
    alsoReads: [],
  },
  {
    id: "cursor",
    label: "Cursor",
    userRel: ".cursor/skills",
    projectRel: ".cursor/skills",
    alsoReads: ["codex", "gemini", "opencode"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    userRel: ".config/opencode/skills",
    projectRel: ".opencode/skills",
    alsoReads: ["codex", "gemini", "cursor"],
  },
];

/** Default agent used when the user does not pick one (non-interactive). */
export const DEFAULT_AGENT: AgentId = "claude";

export function agentById(id: string): AgentAdapter | null {
  return AGENTS.find((a) => a.id === id) ?? null;
}

export function userSkillsDir(agent: AgentAdapter): string {
  return join(homedir(), agent.userRel);
}

export function projectSkillsDir(agent: AgentAdapter, root: string): string {
  return join(root, agent.projectRel);
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

export function agentLabel(id: string): string {
  return agentById(id)?.label ?? id;
}

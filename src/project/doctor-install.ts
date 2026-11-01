import { readProjectConfig, effectiveSkillsScope, ProjectConfigError } from "./config.js";
import { AGENTS, DEFAULT_AGENT, projectAgentsDir, projectSkillsDir, userAgentsDir, userSkillsDir, parseAgentIds, type AgentId, type SkillScope } from "../integrations/agents.js";
import { agentSkillsState, agentsAreHealthy, agentsState, globalLinkRefusal, installAgentsTo, installSkills, MANAGED_AGENTS, agentEntryState, foreignSkills, hasOwnedEntries, unhealthySkills } from "../integrations/install.js";
import type { DoctorFinding } from "./doctor-types.js";

/** Skills can be installed and then deleted or drift stale; nothing notices until a worker has no instructions. */
export function checkSkills(root: string, agents: AgentId[], scope: SkillScope): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  // From a linked worktree the suggested repair would itself be refused; the refusal says where to run it.
  let refusal: string | null | undefined;
  const repairAction = (fallback: string): string => {
    if (scope !== "global") return fallback;
    if (refusal === undefined) refusal = globalLinkRefusal();
    return refusal ?? fallback;
  };
  for (const id of agents) {
    const adapter = AGENTS.find((a) => a.id === id);
    if (!adapter) continue;
    const dir = scope === "global" ? userSkillsDir(adapter) : projectSkillsDir(adapter, root);
    const foreign = foreignSkills(dir);
    if (foreign.length > 0) {
      findings.push({
        level: "WARNING",
        area: dir,
        message: `your own skill sits at a managed skill name: ${foreign.join(", ")} — kf install leaves it alone, and it runs instead of kanban-flow's`,
        action: "keep it and accept the substitution, or move it aside and run kf install",
      });
    }
    const bad = unhealthySkills(dir, foreign);
    if (bad.length === 0) continue;
    // The aggregate state counts a user's own entry as stale; name it only when there is none.
    const state = foreign.length > 0 ? "incomplete" : agentSkillsState(dir);
    findings.push({
      level: "ERROR",
      area: dir,
      message: `skills ${state} (scope: ${scope}): ${bad.join(", ")}`,
      action: repairAction(`kf install --agent ${id} --scope ${scope}, or kf doctor --fix`),
    });
  }
  // The skills dispatch agents by name; an upgrade that relinks the skills without the agents
  // leaves every dispatch on a stand-in. A user's own file under a managed name is theirs.
  for (const id of agents) {
    const adapter = AGENTS.find((a) => a.id === id);
    if (!adapter) continue;
    const agentsDir = scope === "global" ? userAgentsDir(adapter) : projectAgentsDir(adapter, root);
    if (!agentsDir) continue;
    const state = agentsState(agentsDir);
    if (agentsAreHealthy(state)) continue;
    const entries = MANAGED_AGENTS.map((a) => [a, agentEntryState(agentsDir, a)] as const);
    const theirs = entries.filter(([, s]) => s === "foreign" || s === "not-file").map(([a]) => a);
    const missing = entries.filter(([, s]) => s === "absent" || s === "stale").map(([a]) => a);
    if (theirs.length > 0) {
      findings.push({
        level: "WARNING",
        area: agentsDir,
        message: `your own file sits at a managed agent name: ${theirs.map((a) => `${a}.md`).join(", ")} — the skills will dispatch it instead of kanban-flow's`,
        action: "rename or remove your file, then kf install; or keep it and accept the substitution",
      });
    }
    // A user's file under one name must not hide the agents missing or outdated next to it.
    if (missing.length > 0) {
      findings.push({
        level: "ERROR",
        area: agentsDir,
        message: `agents ${theirs.length > 0 ? "partial" : state} (scope: ${scope}): ${missing.join(", ")}`,
        action: repairAction(`kf install --agent ${id} --scope ${scope}, or kf doctor --fix`),
      });
    }
  }
  // At global scope the project copies shadow the shared install — they are duplicates, not skills.
  if (scope === "global") {
    const dupes = agents
      .map((id) => AGENTS.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .filter((a) => hasOwnedEntries(projectSkillsDir(a, root)));
    if (dupes.length > 0) {
      findings.push({
        level: "WARNING",
        area: "skills",
        message: `Project-scope copies shadow global skills: ${dupes.map((a) => a.id).join(", ")}.`,
        action: "kf install (cleans project copies), or kf uninstall --scope project",
      });
    }
  }
  return findings;
}

/** The skills and agents repair of `kf doctor --fix`; a global link from a linked worktree is a failure, not a repair. */
export async function repairSkills(root: string, fixed: string[], failures: DoctorFinding[]): Promise<void> {
  let cfg: ReturnType<typeof readProjectConfig>;
  try {
    cfg = readProjectConfig(root);
  } catch (err) {
    // runDoctor reports the broken or unreadable config as an ERROR; without it the scope is unknown, so nothing is installed.
    if (err instanceof ProjectConfigError || (err instanceof Error && "code" in err)) return;
    throw err;
  }
  const parsed = cfg.agents ? parseAgentIds(cfg.agents) : [DEFAULT_AGENT];
  const agents = parsed.length > 0 ? parsed : [DEFAULT_AGENT];
  const scope = effectiveSkillsScope(cfg);
  const declaredScope = cfg.skills?.scope;
  const refusalFinding = (message: string): DoctorFinding => ({ level: "ERROR", area: "skills", message, action: "run kf doctor --fix from the primary checkout's kf" });
  const missingFor = agents.filter((id) => {
    const adapter = AGENTS.find((a) => a.id === id);
    if (!adapter) return false;
    const dir = scope === "global" ? userSkillsDir(adapter) : projectSkillsDir(adapter, root);
    return unhealthySkills(dir, foreignSkills(dir)).length > 0;
  });
  const refusal = missingFor.length > 0 && scope === "global" ? globalLinkRefusal() : null;
  if (refusal) {
    failures.push(refusalFinding(refusal));
    return;
  }
  if (missingFor.length > 0) {
    const res = await installSkills(root, missingFor, scope, { declaredScope });
    if (res.code === 0) fixed.push(`installed kanban skills for ${missingFor.join(", ")} (scope: ${scope})`);
    else fixed.push(`skill install reported a problem: ${res.stdout}`);
  }
  // installSkills carries the agents along for the agents it (re)installed; the others may still
  // be missing theirs (an npm upgrade relinks skills, not agents). A foreign file is not repaired.
  for (const id of agents) {
    if (missingFor.includes(id)) continue;
    const adapter = AGENTS.find((a) => a.id === id);
    if (!adapter) continue;
    const agentsDir = scope === "global" ? userAgentsDir(adapter) : projectAgentsDir(adapter, root);
    if (!agentsDir) continue;
    // installAgentsTo skips a user's file on its own, so a foreign entry never blocks the repair
    // of the absent or stale ones beside it.
    const needsRepair = MANAGED_AGENTS.some((a) => ["absent", "stale"].includes(agentEntryState(agentsDir, a)));
    if (!needsRepair) continue;
    const agentsRefusal = scope === "global" ? globalLinkRefusal() : null;
    if (agentsRefusal) {
      failures.push(refusalFinding(agentsRefusal));
      break;
    }
    const res = await installAgentsTo(agentsDir, scope === "global" ? "link" : "copy");
    if (res.code === 0) fixed.push(`installed kanban agents for ${id} (scope: ${scope})`);
    else fixed.push(`agent install reported a problem: ${res.stdout}`);
  }
}

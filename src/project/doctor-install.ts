import { join } from "node:path";

import { readProjectConfig, effectiveSkillsScope, ProjectConfigError } from "./config.js";
import { AGENTS, DEFAULT_AGENT, projectAgentsDir, projectSkillsDir, userAgentsDir, userSkillsDir, parseAgentIds, SKILL_SCOPES, type AgentId, type SkillScope } from "../integrations/agents.js";
import { agentSkillsState, agentsAreHealthy, agentsState, globalLinkRefusal, installAgentsTo, installSkills, MANAGED_AGENTS, agentEntryState, foreignSkills, hasOwnedEntries, legacyEntries, removeLegacy, RETIRED_SKILLS, unhealthySkills } from "../integrations/install.js";
import { ClaudePluginError, claudeRunner, claudeScope, ensurePlugin, pluginState, PLUGIN_ID } from "../integrations/claude-plugin.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { DoctorFinding } from "./doctor-types.js";

/** Skills can be installed and then deleted or drift stale; nothing notices until a worker has no instructions. */
export function checkSkills(root: string, configured: AgentId[], scope: SkillScope): DoctorFinding[] {
  const findings: DoctorFinding[] = checkLegacy(root);
  // Claude Code loads the kf plugin, not copies; checkPlugin covers it.
  const agents = configured.filter((id) => id !== "claude");
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

/**
 * Entries kf wrote before the plugin, at both scopes: a project-scope setup may still hold a
 * pre-plugin global install, and the reverse. An unowned kanban-* entry is named and left;
 * an unowned bare name (travel, an agent file) is the user's and is not flagged.
 */
function checkLegacy(root: string): DoctorFinding[] {
  const byDir = new Map<string, string[]>();
  const findings: DoctorFinding[] = [];
  for (const e of SKILL_SCOPES.flatMap((scope) => legacyEntries(root, scope))) {
    if (e.owned) byDir.set(e.dir, [...(byDir.get(e.dir) ?? []), e.name]);
    else if (e.name.startsWith("kanban-") && !RETIRED_SKILLS.includes(e.name)) {
      findings.push({
        level: "WARNING",
        area: e.dir,
        message: `not owned by kf, left alone: ${join(e.dir, e.name)} — the runtime still loads it`,
        action: "remove it yourself if it is a leftover",
      });
    }
  }
  for (const [dir, names] of byDir) {
    findings.push({
      level: "WARNING",
      area: dir,
      message: `legacy kanban-flow entries left from before the kf plugin: ${names.join(", ")} — the runtime still loads them`,
      action: "kf doctor --fix",
    });
  }
  return findings;
}

/** The configured agents and scope, or null when the config cannot be read (runDoctor reports that as an ERROR). */
function configuredAgents(root: string): { agents: AgentId[]; scope: SkillScope } | null {
  let cfg: ReturnType<typeof readProjectConfig>;
  try {
    cfg = readProjectConfig(root);
  } catch (err) {
    if (err instanceof ProjectConfigError || (err instanceof Error && "code" in err)) return null;
    throw err;
  }
  const parsed = cfg.agents ? parseAgentIds(cfg.agents) : [DEFAULT_AGENT];
  return { agents: parsed.length > 0 ? parsed : [DEFAULT_AGENT], scope: effectiveSkillsScope(cfg) };
}

/** Why a plugin probe failed: a claude that is absent or answered badly. Anything else is a bug and propagates. */
function probeFailure(err: unknown): string {
  if (err instanceof ClaudePluginError) return `kf plugin state unknown: ${err.message}`;
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return "cannot check kf plugin: the `claude` CLI was not found on PATH";
  throw err;
}

const PLUGIN_AREA = "Claude Code plugin";

/** The kf plugin's state for a project that configures claude: missing, disabled or stale is an ERROR; a failed probe is said, never skipped. */
const UNKNOWN_SOURCE = "kf plugin source unknown";

export async function checkPlugin(root: string): Promise<DoctorFinding[]> {
  const cfg = configuredAgents(root);
  if (!cfg || !cfg.agents.includes("claude")) return [];
  // From a linked worktree the install would be refused; the refusal says where to run it.
  const action = (cfg.scope === "global" ? globalLinkRefusal() : null) ?? `kf install --agent claude --scope ${cfg.scope}, or kf doctor --fix`;
  let state: Awaited<ReturnType<typeof pluginState>>;
  try {
    state = await pluginState(claudeRunner(root), cfg.scope);
  } catch (err) {
    return [{ level: "WARNING", area: PLUGIN_AREA, message: probeFailure(err), action: "check that the claude CLI is on PATH and answers `claude plugin list --json`, then re-run kf doctor" }];
  }
  const target = claudeScope(cfg.scope);
  switch (state.status) {
    case "current":
      return [];
    case "missing":
      return [{ level: "ERROR", area: PLUGIN_AREA, message: `plugin ${PLUGIN_ID} is missing (scope: ${target}) — Claude Code has no kf skills or agents`, action }];
    case "disabled":
      return [{ level: "ERROR", area: PLUGIN_AREA, message: `plugin ${PLUGIN_ID} is disabled (scope: ${state.scope})`, action }];
    case "stale":
      return [{
        level: "ERROR",
        area: PLUGIN_AREA,
        message: `plugin ${PLUGIN_ID} path is stale: registered at ${state.readFromFolder || "an unknown folder"}, this kf runs from ${PKG_ROOT} — the plugin fails to load (cache-miss)`,
        action,
      }];
    case "unknown":
      return [{ level: "WARNING", area: PLUGIN_AREA, message: `${UNKNOWN_SOURCE} — claude does not report the folder plugin ${PLUGIN_ID} reads from, so kf cannot tell whether it matches ${PKG_ROOT}`, action: `check claude plugin list --json; if kf does not load from ${PKG_ROOT}, run claude plugin marketplace add ${PKG_ROOT}` }];
  }
}

/** The plugin repair of `kf doctor --fix`: the install steps when claude answers, otherwise the manual commands as a failure. */
async function repairPlugin(root: string, scope: SkillScope, fixed: string[], failures: DoctorFinding[]): Promise<void> {
  // The marketplace would record this package root, which dangles once a linked worktree is removed.
  const refusal = scope === "global" ? globalLinkRefusal() : null;
  if (refusal) {
    // An unknown source is installed and nothing ensurePlugin would change, so it is no refused repair; a failed probe still is, so the legacy cleanup waits.
    if ((await checkPlugin(root)).some((f) => !f.message.startsWith(UNKNOWN_SOURCE))) failures.push({ level: "ERROR", area: PLUGIN_AREA, message: refusal, action: "run kf doctor --fix from the primary checkout's kf" });
    return;
  }
  const res = await ensurePlugin(scope, claudeRunner(root));
  if (res.code !== 0) failures.push({ level: "ERROR", area: PLUGIN_AREA, message: res.stdout });
  else if (res.changed) fixed.push(res.stdout.replace(/^✓ /, ""));
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
  const configured = parsed.length > 0 ? parsed : [DEFAULT_AGENT];
  const scope = effectiveSkillsScope(cfg);
  const declaredScope = cfg.skills?.scope;
  const failuresBefore = failures.length;
  if (configured.includes("claude")) await repairPlugin(root, scope, fixed, failures);
  const copiesOk = await repairCopies(root, configured, scope, declaredScope, fixed, failures);
  // As in kf install: removing the old entries before the plugin and copies landed would leave the runtime with none.
  if (!copiesOk || failures.length > failuresBefore) return;
  // An entry kf does not own stays; checkLegacy names it.
  for (const scopeToClean of SKILL_SCOPES) {
    for (const r of await removeLegacy(root, scopeToClean)) {
      if (r.removed.length > 0) fixed.push(`removed legacy ${r.removed.join(", ")} from ${r.dir}/`);
    }
  }
}

/** The kf-* copy repair for the agents other than claude; false when an install reported a problem or was refused. */
async function repairCopies(root: string, configured: AgentId[], scope: SkillScope, declaredScope: SkillScope | undefined, fixed: string[], failures: DoctorFinding[]): Promise<boolean> {
  // Claude Code loads the kf plugin, so only the other agents get copies.
  const agents = configured.filter((id) => id !== "claude");
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
    return false;
  }
  let ok = true;
  if (missingFor.length > 0) {
    const res = await installSkills(root, missingFor, scope, { declaredScope });
    ok &&= res.code === 0;
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
      return false;
    }
    const res = await installAgentsTo(agentsDir, scope === "global" ? "link" : "copy");
    ok &&= res.code === 0;
    if (res.code === 0) fixed.push(`installed kanban agents for ${id} (scope: ${scope})`);
    else fixed.push(`agent install reported a problem: ${res.stdout}`);
  }
  return ok;
}

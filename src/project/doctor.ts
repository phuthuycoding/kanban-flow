import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { STAGES } from "../workflow/schema.js";
import { listFeatures, readFeatureMeta } from "../workflow/features.js";
import { validateFeature } from "../workflow/validate.js";
import { readProjectConfig, configPath } from "./config.js";
import { AGENTS, DEFAULT_AGENT, projectSkillsDir, parseAgentIds, type AgentId } from "../integrations/agents.js";
import { MANAGED_SKILLS } from "../integrations/install.js";

export interface DoctorFinding {
  level: "ERROR" | "WARNING";
  area: string;
  message: string;
  /** A command the user runs themselves. Doctor never fixes anything. */
  action?: string;
}

export interface DoctorReport {
  root: string;
  findings: DoctorFinding[];
  invalidItems: number;
  totalItems: number;
  ok: boolean;
}

/** Every stage needs its directory; a file sitting where one belongs counts as missing. */
function checkStageDirs(root: string): DoctorFinding[] {
  const missing = STAGES.filter((stage) => {
    const dir = join(root, ".works", stage);
    if (!existsSync(dir)) return true;
    try {
      return !statSync(dir).isDirectory();
    } catch {
      // Unreadable is as unusable as absent, and saying so beats crashing.
      return true;
    }
  });
  if (missing.length === 0) return [];
  return [{
    level: "ERROR",
    area: ".works/",
    message: `Missing stage ${missing.length === 1 ? "directory" : "directories"}: ${missing.join(", ")}`,
    action: "kf init --minimal (recreates the stage directories; existing work items are left alone)",
  }];
}

/**
 * The config check has to survive a config it cannot read — that is the case it exists for.
 * readProjectConfig throws on bad JSON and on a bad shape, so the throw is caught here and turned
 * into the diagnosis. This is not swallowing: the error becomes the answer the command returns.
 */
function checkConfig(root: string): { findings: DoctorFinding[]; cfg: ReturnType<typeof readProjectConfig> | null } {
  const path = configPath(root);
  if (!existsSync(path)) {
    return {
      findings: [{ level: "WARNING", area: ".kf/config.json", message: "No project config; defaults are in use.", action: "kf init --defaults" }],
      cfg: null,
    };
  }
  try {
    return { findings: [], cfg: readProjectConfig(root) };
  } catch (err) {
    return {
      findings: [{
        level: "ERROR",
        area: ".kf/config.json",
        message: `Cannot read the project config: ${err instanceof Error ? err.message : String(err)}`,
        action: "fix the JSON by hand, or delete .kf/config.json and re-run kf init",
      }],
      cfg: null,
    };
  }
}

/** A work item whose metadata cannot be read is invisible to every other command. */
function checkItemMetadata(root: string): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const f of listFeatures(root)) {
    try {
      readFeatureMeta(f.dir);
    } catch (err) {
      findings.push({
        level: "ERROR",
        area: `${f.stage}/${f.folder}`,
        message: `Unreadable metadata: ${err instanceof Error ? err.message : String(err)}`,
        action: `fix ${join(f.dir, ".kfw.json")} by hand`,
      });
      continue;
    }
    if (!f.meta) {
      findings.push({
        level: "ERROR",
        area: `${f.stage}/${f.folder}`,
        message: "No .kfw.json — the item is invisible to approval and execution tracking.",
        action: `write ${join(f.dir, ".kfw.json")}, or remove the folder if it is not a work item`,
      });
    }
  }
  return findings;
}

/** Skills can be installed and then deleted; nothing notices until a worker has no instructions. */
function checkSkills(root: string, agents: AgentId[]): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const id of agents) {
    const adapter = AGENTS.find((a) => a.id === id);
    if (!adapter) continue;
    const dir = projectSkillsDir(adapter, root);
    const missing = MANAGED_SKILLS.filter((s) => !existsSync(join(dir, s, "SKILL.md")));
    if (missing.length === 0) continue;
    findings.push({
      level: "ERROR",
      area: dir,
      message: `${missing.length} of ${MANAGED_SKILLS.length} skills missing: ${missing.join(", ")}`,
      action: `kf install --agent ${id}`,
    });
  }
  return findings;
}

/** Config fields that still parse but no longer mean what someone reading them would assume. */
function checkLegacyFields(root: string, cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  if (!cfg) return [];
  const findings: DoctorFinding[] = [];
  const raw = readRawConfig(root);
  if (cfg.contexts && cfg.contexts.length > 0 && raw?.defaultContext !== undefined) {
    findings.push({
      level: "WARNING",
      area: ".kf/config.json",
      message: `defaultContext "${String(raw.defaultContext)}" is ignored because contexts is declared; the default is contexts[0] = "${cfg.contexts[0]}".`,
      action: "remove defaultContext, or reorder contexts so the intended default is first",
    });
  }
  if (raw?.stack !== undefined && raw?.stacks !== undefined) {
    findings.push({
      level: "WARNING",
      area: ".kf/config.json",
      message: "Both stack (legacy, singular) and stacks are set; only stacks is read.",
      action: "remove the legacy stack field",
    });
  }
  return findings;
}

/** The file as written, not as normalised by readProjectConfig, which fills stacks in from stack. */
function readRawConfig(root: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(root), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    // checkConfig already reported an unreadable config; a second finding would be noise.
    return null;
  }
}

/** Diagnose a project. Read-only: nothing here writes, moves or deletes. */
export function runDoctor(root: string): DoctorReport {
  const findings: DoctorFinding[] = [];
  findings.push(...checkStageDirs(root));

  const config = checkConfig(root);
  findings.push(...config.findings);
  findings.push(...checkLegacyFields(root, config.cfg));

  const agents = config.cfg?.agents ? parseAgentIds(config.cfg.agents) : [DEFAULT_AGENT];
  findings.push(...checkSkills(root, agents.length > 0 ? agents : [DEFAULT_AGENT]));

  findings.push(...checkItemMetadata(root));

  // Invalid work items are the normal state of a running pipeline, so they are counted and
  // reported but deliberately kept out of `findings` — they must not decide the verdict.
  const items = listFeatures(root);
  const invalidItems = items.filter((f) => !validateFeature(f).valid).length;

  return {
    root,
    findings,
    invalidItems,
    totalItems: items.length,
    ok: findings.every((f) => f.level !== "ERROR"),
  };
}

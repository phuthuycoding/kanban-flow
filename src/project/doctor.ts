import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { STAGES } from "../workflow/schema.js";
import { listFeatures, readFeatureMeta } from "../workflow/features.js";
import { validateFeature } from "../workflow/validate.js";
import { readProjectConfig, configPath } from "./config.js";
import { detectRepository } from "./repository.js";
import { bootstrapDefaults, saveConfig } from "./bootstrap.js";
import { PKG_GITHUB_HOOKS_DIR } from "../shared/paths.js";
import { AGENTS, DEFAULT_AGENT, projectSkillsDir, parseAgentIds, type AgentId } from "../integrations/agents.js";
import { installProjectSkills, MANAGED_SKILLS } from "../integrations/install.js";

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
    action: "kf init --minimal (recreates the stage directories; existing work items are left alone), or kf doctor --fix",
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
      findings: [{ level: "WARNING", area: ".kf/config.json", message: "No project config; defaults are in use.", action: "kf init --defaults, or kf doctor --fix (writes the config part)" }],
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

/** An archived item with a linked issue but no `delivered` flag is pending the human's delivery step. */
function checkUndelivered(root: string): DoctorFinding[] {
  return listFeatures(root)
    .filter((f) => f.stage === "dones" && f.meta?.issue && !f.meta.delivered)
    .map((f) => ({
      level: "WARNING" as const,
      area: `${f.stage}/${f.folder}`,
      message: `archived with a linked issue but not marked delivered.`,
      action: `kf issues done ${f.name} (once the change has landed)`,
    }));
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
      action: `kf install --agent ${id}, or kf doctor --fix`,
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
      action: "remove defaultContext (kf doctor --fix does it), or reorder contexts so the intended default is first",
    });
  }
  if (raw?.stack !== undefined && raw?.stacks !== undefined) {
    findings.push({
      level: "WARNING",
      area: ".kf/config.json",
      message: "Both stack (legacy, singular) and stacks are set; only stacks is read.",
      action: "remove the legacy stack field (kf doctor --fix does it)",
    });
  }
  return findings;
}

/**
 * The repo link is opt-in, so its absence is only worth reporting when a GitHub origin exists
 * to link to — otherwise the warning would nag projects that have nothing to record.
 */
function checkRepository(root: string, cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  if (!cfg || cfg.repository !== undefined) return [];
  const detected = detectRepository(root);
  if (!detected) return [];
  return [{
    level: "WARNING",
    area: ".kf/config.json",
    message: `No repository link; the origin remote points at ${detected}.`,
    action: `set "repository": "${detected}" in .kf/config.json (kf doctor --fix does it)`,
  }];
}

/** Pack file names shipped in kanban-flow/hooks/ — the lib plus one hook per stage. */
const GITHUB_HOOK_PACK = ["lib-github.sh", "delivered.sh", ...STAGES.map((s) => `${s}.sh`)];

/**
 * The hook pack is opt-in, so its state is only checked once a project opted in — detected by
 * any pack file already in .kf/hooks/. Missing files get restored by --fix; divergent files are
 * only reported, because a hook the project edited is project-owned and must not be clobbered.
 */
function checkGithubHooks(root: string): DoctorFinding[] {
  const dir = join(root, ".kf", "hooks");
  const present = GITHUB_HOOK_PACK.filter((f) => existsSync(join(dir, f)));
  if (present.length === 0) return [];
  const findings: DoctorFinding[] = [];
  const missing = GITHUB_HOOK_PACK.filter((f) => !present.includes(f));
  if (missing.length > 0) {
    findings.push({
      level: "WARNING",
      area: ".kf/hooks",
      message: `GitHub hook pack incomplete: ${missing.join(", ")} missing.`,
      action: "kf doctor --fix",
    });
  }
  for (const f of present) {
    const pkg = join(PKG_GITHUB_HOOKS_DIR, f);
    if (existsSync(pkg) && readFileSync(pkg, "utf8") !== readFileSync(join(dir, f), "utf8")) {
      findings.push({
        level: "WARNING",
        area: ".kf/hooks",
        message: `${f} differs from the packaged version.`,
        action: "project-owned — review the diff and refresh by hand if the change is stale",
      });
    }
  }
  return findings;
}

/** A configured board needs `gh project` commands, which need the project scope. */
function checkGhProjectScope(cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  if (!cfg?.project) return [];
  const res = spawnSync("gh", ["auth", "status", "-h", "github.com"], { encoding: "utf8", timeout: 10_000 });
  if (res.error || res.status !== 0) {
    return [{ level: "WARNING", area: "gh", message: "project is configured but gh is not authenticated.", action: "gh auth login (with the project scope)" }];
  }
  const scopes = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (!/(^|')project(,|'|\s|$)/.test(scopes) && !scopes.includes("'project'")) {
    return [{ level: "WARNING", area: "gh", message: "project is configured but the gh token lacks the project scope — board sync will warn and skip.", action: "gh auth refresh -s project" }];
  }
  return [];
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
  findings.push(...checkRepository(root, config.cfg));
  findings.push(...checkGithubHooks(root));
  findings.push(...checkGhProjectScope(config.cfg));

  const agents = config.cfg?.agents ? parseAgentIds(config.cfg.agents) : [DEFAULT_AGENT];
  findings.push(...checkSkills(root, agents.length > 0 ? agents : [DEFAULT_AGENT]));

  findings.push(...checkItemMetadata(root));
  findings.push(...checkUndelivered(root));

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

/**
 * `kf doctor --fix`: apply every repair that needs no human decision, then let the caller
 * re-run runDoctor for the after-state. What is not fixed stays unfixed deliberately —
 * unreadable JSON and unreadable item metadata are judgment calls, and the worktree infra
 * needs sudo.
 */
export async function applyDoctorFixes(root: string): Promise<string[]> {
  const fixed: string[] = [];

  for (const stage of STAGES) {
    const dir = join(root, ".works", stage);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      fixed.push(`created .works/${stage}/`);
    }
  }

  if (!existsSync(configPath(root))) {
    saveConfig(root, bootstrapDefaults(root));
    fixed.push("wrote .kf/config.json defaults (as kf init --defaults does)");
  } else {
    // Field-level repairs on the raw file: keys we do not touch keep their spelling and order.
    const raw = readRawConfig(root);
    if (raw) {
      let changed = false;
      const cfg = checkConfig(root).cfg;
      if (raw.stack !== undefined && raw.stacks !== undefined) {
        delete raw.stack;
        fixed.push('removed legacy "stack" (stacks is already set)');
        changed = true;
      }
      if (raw.defaultContext !== undefined && cfg?.contexts && cfg.contexts.length > 0) {
        delete raw.defaultContext;
        fixed.push(`removed "defaultContext" (ignored; contexts[0] is "${cfg.contexts[0]}")`);
        changed = true;
      }
      if (raw.repository === undefined && cfg) {
        const detected = detectRepository(root);
        if (detected) {
          raw.repository = detected;
          fixed.push(`set "repository": "${detected}" (from the origin remote)`);
          changed = true;
        }
      }
      if (changed) writeFileSync(configPath(root), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    }
  }

  const agents = (() => {
    try {
      const cfg = readProjectConfig(root);
      const parsed = cfg.agents ? parseAgentIds(cfg.agents) : [DEFAULT_AGENT];
      return parsed.length > 0 ? parsed : [DEFAULT_AGENT];
    } catch {
      return [DEFAULT_AGENT];
    }
  })();
  // Restore missing pack files only when the project opted in (some are present); divergent
  // files stay warnings — a hook the project edited is not ours to overwrite.
  const hooksDir = join(root, ".kf", "hooks");
  const optedIn = GITHUB_HOOK_PACK.some((f) => existsSync(join(hooksDir, f)));
  if (optedIn) {
    const missing = GITHUB_HOOK_PACK.filter((f) => !existsSync(join(hooksDir, f)) && existsSync(join(PKG_GITHUB_HOOKS_DIR, f)));
    for (const f of missing) {
      mkdirSync(hooksDir, { recursive: true });
      spawnSync("cp", [join(PKG_GITHUB_HOOKS_DIR, f), join(hooksDir, f)]);
      fixed.push(`restored .kf/hooks/${f} from the packaged hook pack`);
    }
  }

  const missingFor = agents.filter((id) => {
    const adapter = AGENTS.find((a) => a.id === id);
    if (!adapter) return false;
    const dir = projectSkillsDir(adapter, root);
    return MANAGED_SKILLS.some((s) => !existsSync(join(dir, s, "SKILL.md")));
  });
  if (missingFor.length > 0) {
    const res = await installProjectSkills(root, missingFor);
    if (res.code === 0) fixed.push(`installed kanban skills for ${missingFor.join(", ")}`);
    else fixed.push(`skill install reported a problem: ${res.stdout}`);
  }

  return fixed;
}

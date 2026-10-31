import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { ARTIFACTS, STAGES } from "../workflow/schema.js";
import { parseTaskGraph } from "../workflow/tasks.js";
import { isPidAlive } from "../shared/process.js";
import { isGitRepo, taskWorktreeEntries } from "../worktree/manager.js";
import { branchPushed, landedAndPruned } from "../shared/git.js";
import { worktreeConfig, worktreeDir } from "../worktree/config.js";
import { driveLive, listFeatures, readFeatureMeta } from "../workflow/features.js";
import { reportStatus } from "../workflow/status.js";
import { validateFeature } from "../workflow/validate.js";
import { readProjectConfig, configPath, effectiveSkillsScope, hasLegacyShipBlock, type ProjectConfig } from "./config.js";
import { detectRepository } from "./repository.js";
import { bootstrapDefaults, saveConfig } from "./bootstrap.js";
import { PKG_GITHUB_HOOKS_DIR } from "../shared/paths.js";
import { AGENTS, DEFAULT_AGENT, projectAgentsDir, projectSkillsDir, userAgentsDir, userSkillsDir, parseAgentIds, type AgentId, type SkillScope } from "../integrations/agents.js";
import { agentSkillsState, agentsAreHealthy, agentsState, installAgentsTo, installSkills, MANAGED_AGENTS, MANAGED_SKILLS, agentEntryState, ownsSkillEntry, skillEntryState } from "../integrations/install.js";


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
    .filter((f) => f.stage === "done" && f.meta?.issue && !f.meta.delivered)
    .map((f) => ({
      level: "WARNING" as const,
      area: `${f.stage}/${f.folder}`,
      message: `archived with a linked issue but not marked delivered.`,
      action: `kf archive ${f.name} (finalizes delivery — closes the issue, board → done status)`,
    }));
}

/** A review-PASS item with a recorded PR sits in review until the PR merges; the next kf status closes it. */
function checkAwaitingMerge(root: string): DoctorFinding[] {
  return listFeatures(root)
    .filter((f) => f.stage === "review" && f.meta?.pr && reportStatus(f.dir, "review-report") === "PASS")
    .map((f) => ({
      level: "WARNING" as const,
      area: `${f.stage}/${f.folder}`,
      message: `review passed and still in review — awaiting merge of ${f.meta!.pr}.`,
      action: `merge ${f.meta!.pr} on GitHub, then run: kf status --change ${f.name}`,
    }));
}

/** Canonical docs committed to a docs branch at close are not on the default branch until someone pushes and merges it. */
function checkDocsBranches(root: string): DoctorFinding[] {
  return listFeatures(root)
    .filter((f) => f.meta?.docsBranch && branchPushed(root, "origin", f.meta.docsBranch) === false
      && !landedAndPruned(root, f.meta.docsBranch))
    .map((f) => ({
      level: "WARNING" as const,
      area: `${f.stage}/${f.folder}`,
      message: `docs_branch_unpushed: canonical docs for ${f.name} sit on ${f.meta!.docsBranch}, which is not on origin.`,
      action: `git push -u origin ${f.meta!.docsBranch}, then open a PR for it`,
    }));
}

/** statusMap.delivered became inert when archive took over delivery — flag the dead key. */
function checkStatusMap(cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  if (!cfg?.project?.statusMap?.delivered) return [];
  return [{
    level: "WARNING" as const,
    area: ".kf/config.json",
    message: `statusMap.delivered is dead config — archive owns delivery now (recommended: map done to "Done").`,
    action: `remove the "delivered" key from project.statusMap`,
  }];
}

/** A statusMap still keyed by `dones`/`shipping` is read under the new names; the file says otherwise until --fix rewrites it. */
function checkStatusMapLegacy(cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  if (!cfg?.project?.statusMapLegacy) return [];
  return [{
    level: "WARNING" as const,
    area: ".kf/config.json",
    message: `statusmap_legacy: project.statusMap uses the legacy stage keys "dones" (now "done") or "shipping" (removed).`,
    action: "kf doctor --fix (renames dones to done and drops shipping)",
  }];
}

/** Skills can be installed and then deleted or drift stale; nothing notices until a worker has no instructions. */
/**
 * The install's skill sidecar (install.ts SKILLS_MANIFEST), read the way the install reads it, so
 * doctor recognises an older kanban-flow copy of an unprefixed skill as ours, as the install does.
 */
function readSkillsManifest(dir: string): Record<string, string> {
  const path = join(dir, ".kanban-flow-skills.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch (err) {
    // As in the install: a corrupt sidecar only means no copy is recognised by digest.
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

/**
 * Managed skill names in `dir` held by an entry kanban-flow does not own (a user's own `travel`).
 * The install leaves those alone, so they are neither stale nor something a reinstall repairs.
 */
function foreignSkills(dir: string): string[] {
  const manifest = readSkillsManifest(dir);
  return MANAGED_SKILLS.filter((s) => !ownsSkillEntry(dir, s, manifest));
}

/** Managed skills in `dir` that are not a healthy link or copy, leaving out the ones the user owns. */
function unhealthySkills(dir: string, foreign: string[]): string[] {
  return MANAGED_SKILLS.filter((s) => !foreign.includes(s) && !["linked", "copied"].includes(skillEntryState(dir, s)));
}

/** True when at least one managed skill kanban-flow owns exists (or dangles) in the dir. */
function hasOwnedEntries(dir: string): boolean {
  const foreign = foreignSkills(dir);
  return MANAGED_SKILLS.some((s) => !foreign.includes(s) && lstatSync(join(dir, s), { throwIfNoEntry: false }) !== undefined);
}

function checkSkills(root: string, agents: AgentId[], scope: SkillScope): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
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
      action: `kf install --agent ${id} --scope ${scope}, or kf doctor --fix`,
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
        action: `kf install --agent ${id} --scope ${scope}, or kf doctor --fix`,
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
  if (hasLegacyShipBlock(raw?.ship)) {
    findings.push({
      level: "WARNING",
      area: ".kf/config.json",
      message: "The ship block is ignored: kf ship is deprecated (review opens the PR; merge on GitHub; kf status --change <feature> closes the item).",
      action: 'remove the "ship" block from .kf/config.json',
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

/**
 * Hooks named after stages that no longer exist. resolveHook looks a hook up by the target stage,
 * so shipping.sh never runs again, and dones.sh runs for done only while done.sh is missing.
 * dones.sh is not simply renamed: its board move names the `dones` status, which is no longer exported
 * once done.sh resolves.
 */
const ORPHANED_STAGE_HOOKS: Array<{ file: string; action: string; fallbackFor?: string }> = [
  {
    file: "dones.sh",
    fallbackFor: "done.sh",
    action: "replace .kf/hooks/dones.sh with the pack's done.sh (kf doctor --fix restores it when the GitHub hook pack is installed), port any local edits into it, then delete dones.sh — do not rename it: it calls sync_project_status … dones, which no longer moves the board",
  },
  { file: "shipping.sh", action: "delete .kf/hooks/shipping.sh (the shipping stage is gone; review opens the PR)" },
];

function checkOrphanedHooks(root: string): DoctorFinding[] {
  const dir = join(root, ".kf", "hooks");
  return ORPHANED_STAGE_HOOKS
    .filter(({ file }) => existsSync(join(dir, file)))
    .map(({ file, action, fallbackFor }) => ({
      level: "WARNING" as const,
      area: ".kf/hooks",
      message: fallbackFor && !existsSync(join(dir, fallbackFor))
        ? `.kf/hooks/${file} is a legacy hook: it runs for done only because ${fallbackFor} is missing.`
        : `.kf/hooks/${file} is an orphaned legacy hook: no stage runs it any more.`,
      action,
    }));
}

/** Pack file names shipped in kanban-flow/hooks/ — the lib plus one hook per stage. */
const GITHUB_HOOK_PACK = ["lib-github.sh", ...STAGES.map((s) => `${s}.sh`)];

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

/** Roles an open item's plan names that `harness.roles` does not declare. */
function plannedRolesMissing(root: string, roles: Record<string, unknown>): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const f of listFeatures(root).filter((x) => x.stage !== "done")) {
    const planFile = join(f.dir, ARTIFACTS["implementation-plan"].file);
    if (!existsSync(planFile)) continue;
    const missing = new Map<string, string[]>();
    for (const t of parseTaskGraph(readFileSync(planFile, "utf8")).tasks) {
      if (t.role === "-" || t.role in roles) continue;
      missing.set(t.role, [...(missing.get(t.role) ?? []), t.id]);
    }
    for (const [role, ids] of missing) {
      findings.push({
        level: "ERROR",
        area: `${f.stage}/${f.folder}`,
        message: `${f.name}: ${ids.join(", ")} name role "${role}", which is not in harness.roles.`,
        action: `declare harness.roles.${role} in .kf/config.json, or change the Role of ${ids.join(", ")} in the plan`,
      });
    }
  }
  return findings;
}

/** A run is live while its worker or supervisor pid answers; a drive records the same pids. */
function hasLiveRunOrDrive(meta: ReturnType<typeof readFeatureMeta>): boolean {
  if (!meta) return false;
  if ((meta.runs ?? []).some((r) => r.status === "running" && (isPidAlive(r.pid) || isPidAlive(r.supervisorPid)))) return true;
  return driveLive(meta.drive);
}

/** Task worktrees left behind by a drive or run that is no longer alive. */
function staleTaskWorktrees(root: string, cfg: ReturnType<typeof readProjectConfig>): DoctorFinding[] {
  const wt = worktreeConfig(root, cfg.worktree);
  const baseDir = dirname(worktreeDir(wt, "x"));
  const dirs = existsSync(baseDir) ? readdirSync(baseDir).filter((n) => n.endsWith(".tasks")) : [];
  if (dirs.length === 0 || !isGitRepo(root)) return [];
  const items = listFeatures(root);
  const findings: DoctorFinding[] = [];
  for (const dir of dirs) {
    const feature = dir.slice(0, -".tasks".length);
    const item = items.find((i) => i.name === feature && i.stage !== "done");
    if (item && hasLiveRunOrDrive(item.meta)) continue;
    for (const entry of taskWorktreeEntries(root, wt, feature)) {
      findings.push({
        level: "WARNING",
        area: entry.path,
        message: `task worktree of ${feature} has no live run or drive.`,
        action: item ? `kf worktree remove ${feature} --force` : `git worktree remove ${entry.path}`,
      });
    }
  }
  return findings;
}

/** A lock whose holder died is taken over by the next writer, but it keeps showing up until then. */
function deadLocks(root: string): DoctorFinding[] {
  const dir = join(root, ".works", ".locks");
  if (!existsSync(dir)) return [];
  const findings: DoctorFinding[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".lock"))) {
    const path = join(dir, name);
    const holder = readFileSync(path, "utf8").trim();
    if (!/^\d+$/.test(holder) || isPidAlive(Number(holder))) continue;
    findings.push({
      level: "WARNING",
      area: path,
      message: `lock held by pid ${holder}, which is dead.`,
      action: `rm ${path}`,
    });
  }
  return findings;
}

/** Harness readiness; the verify check applies only once a stage is assigned, the rest whenever a harness exists. */
function checkHarness(root: string, cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  const harness = cfg?.harness;
  if (!cfg || !harness) return [];
  const findings: DoctorFinding[] = [];
  const assigned = Object.values(harness.stages).some((chain) => Array.isArray(chain) && chain.length > 0);
  if (assigned && !harness.verify?.stage?.length) {
    findings.push({
      level: "WARNING",
      area: ".kf/config.json",
      message: "harness.verify.stage is not set; kf drive refuses to start without it.",
      action: 'set harness.verify.stage in .kf/config.json, e.g. [["npm", "test"]]',
    });
  }
  findings.push(...plannedRolesMissing(root, harness.roles));
  findings.push(...staleTaskWorktrees(root, cfg));
  findings.push(...deadLocks(root));
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
  findings.push(...checkRepository(root, config.cfg));
  findings.push(...checkGithubHooks(root));
  findings.push(...checkOrphanedHooks(root));
  findings.push(...checkGhProjectScope(config.cfg));

  const agents = config.cfg?.agents ? parseAgentIds(config.cfg.agents) : [DEFAULT_AGENT];
  const scope = effectiveSkillsScope(config.cfg ?? ({} as Partial<ProjectConfig>));
  findings.push(...checkSkills(root, agents.length > 0 ? agents : [DEFAULT_AGENT], scope));

  findings.push(...checkItemMetadata(root));
  findings.push(...checkUndelivered(root));
  findings.push(...checkAwaitingMerge(root));
  findings.push(...checkDocsBranches(root));
  findings.push(...checkStatusMap(config.cfg));
  findings.push(...checkStatusMapLegacy(config.cfg));
  findings.push(...checkHarness(root, config.cfg));

  // Invalid work items are the normal state of a running pipeline, so they are counted and
  // reported but deliberately kept out of `findings` — they must not decide the verdict.
  const items = listFeatures(root);
  const invalidItems = items.filter((f) => !validateFeature(f, false, true, config.cfg?.harness).valid).length;

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
      const project = raw.project as Record<string, unknown> | undefined;
      const statusMap = project?.statusMap as Record<string, unknown> | undefined;
      if (cfg?.project?.statusMapLegacy && statusMap) {
        // An explicit `done` beside the legacy `dones` wins, the same choice the reader makes.
        if (statusMap.dones !== undefined && statusMap.done === undefined) statusMap.done = statusMap.dones;
        delete statusMap.dones;
        delete statusMap.shipping;
        fixed.push("rewrote project.statusMap legacy keys (dones → done, shipping dropped)");
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

  const { agents, scope, declaredScope } = (() => {
    try {
      const cfg = readProjectConfig(root);
      const parsed = cfg.agents ? parseAgentIds(cfg.agents) : [DEFAULT_AGENT];
      return {
        agents: parsed.length > 0 ? parsed : [DEFAULT_AGENT],
        scope: effectiveSkillsScope(cfg),
        declaredScope: cfg.skills?.scope,
      };
    } catch {
      return { agents: [DEFAULT_AGENT], scope: "global" as SkillScope, declaredScope: undefined };
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
    const dir = scope === "global" ? userSkillsDir(adapter) : projectSkillsDir(adapter, root);
    return unhealthySkills(dir, foreignSkills(dir)).length > 0;
  });
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
    const res = await installAgentsTo(agentsDir, scope === "global" ? "link" : "copy");
    if (res.code === 0) fixed.push(`installed kanban agents for ${id} (scope: ${scope})`);
    else fixed.push(`agent install reported a problem: ${res.stdout}`);
  }

  return fixed;
}

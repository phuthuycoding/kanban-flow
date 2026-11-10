import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { LEGACY_STAGE_NAMES, STAGES } from "../workflow/schema.js";
import { isPidAlive } from "../shared/process.js";
import { branchPushed, revParse, type LandedRun } from "../shared/git.js";
import { docsLandedProof } from "../workflow/canonical-docs.js";
import { listFeatures, readFeatureMeta } from "../workflow/features.js";
import { docsLookupRerunDecision, docsNeverLandedDecision, reportStatus } from "../workflow/status.js";
import { validateFeature } from "../workflow/validate.js";
import { isLegacyItemFolder, isOsLitter, legacyFolders } from "../workflow/migrate.js";
import { checkHarnessLegacyKeys, checkLegacyRunState, fixFailure, removeLegacyHarnessKeys, stripLegacyRunState } from "./legacy-migration.js";
import { checkGithubHooks, checkOrphanedHooks, repairHooks } from "./doctor-hooks.js";
import { checkSkills, repairSkills } from "./doctor-install.js";
import type { DoctorFinding, DoctorFixResult, DoctorReport } from "./doctor-types.js";
import { readProjectConfig, configPath, effectiveSkillsScope, hasLegacyShipBlock, jsonIndent, PROJECT_CONFIG_KEYS, type ProjectConfig } from "./config.js";
import { detectRepository } from "./repository.js";
import { appendIgnoreWorks, bootstrapDefaults, ignoreEntriesMissing, saveConfig, TRAVEL_IGNORE_ENTRY } from "./bootstrap.js";
import { writeFileAtomic } from "../shared/paths.js";
import { DEFAULT_AGENT, parseAgentIds } from "../integrations/agents.js";

export type { DoctorFinding, DoctorFixResult, DoctorReport } from "./doctor-types.js";

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

/** Items left in a stage dir of an older release; listFeatures does not see them until kf status migrates them. */
function checkLegacyStageDirs(root: string): DoctorFinding[] {
  return LEGACY_STAGE_NAMES.flatMap((legacy) => {
    const dir = join(root, ".works", legacy);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
    const all = legacyFolders(root, legacy);
    const folders = all.filter((folder) => isLegacyItemFolder(root, legacy, folder));
    // kf status removes a dir left with OS litter only; any other file or a non-item folder is the user's to delete.
    if (folders.length === 0) {
      const strayFiles = readdirSync(dir).filter((f) => !isOsLitter(f) && !all.includes(f)).sort();
      const strayFolders = all.map((f) => `${f}/`);
      if (strayFiles.length + strayFolders.length > 0) {
        return [{
          level: "WARNING" as const,
          area: `.works/${legacy}/`,
          message: `legacy stage folder .works/${legacy}/ holds no work items, only ${[...strayFolders, ...strayFiles].join(", ")}.`,
          action: strayFiles.length === 0
            ? `remove ${strayFolders.map((f) => `.works/${legacy}/${f}`).join(", ")}`
            : `remove .works/${legacy}/`,
        }];
      }
    }
    return [{
      level: "WARNING" as const,
      area: `.works/${legacy}/`,
      message: `legacy stage folder .works/${legacy}/ ${folders.length > 0 ? `holds ${folders.join(", ")}` : "is still present (empty)"} — kf list, view and archive do not see it.`,
      action: "run kf status to migrate them",
    }];
  });
}

/** Only a fresh kf init seeds the travel ledger entry; without it `git add -A` commits the ledger. */
function checkTravelIgnore(root: string): DoctorFinding[] {
  const check = ignoreEntriesMissing(root);
  const findings: DoctorFinding[] = [];
  if (check.gitError) {
    findings.push({
      level: "WARNING",
      area: ".gitignore",
      message: `git could not say whether ${TRAVEL_IGNORE_ENTRY} is ignored (${check.gitError}); only .gitignore lines were matched.`,
      action: "fix git in this checkout (for example: git config --global --add safe.directory <path>), then re-run kf doctor",
    });
  }
  if (!check.missing.includes(TRAVEL_IGNORE_ENTRY)) return findings;
  findings.push({
    level: "WARNING",
    area: ".gitignore",
    message: `${TRAVEL_IGNORE_ENTRY} is not ignored; the travel ledger shows up as untracked files.`,
    action: `kf doctor --fix (adds ${TRAVEL_IGNORE_ENTRY} to .gitignore)`,
  });
  return findings;
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
        // readFeatureMeta wraps the parse error; its cause says where the JSON breaks.
        message: `Unreadable metadata: ${err instanceof Error ? err.message : String(err)}${err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : ""}`,
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
  const run: LandedRun = {};
  return listFeatures(root).flatMap((f) => {
    const branch = f.meta?.docsBranch;
    if (!branch) return [];
    // null: no local branch. It is still pushed work when origin has it; otherwise landedProof says it is gone.
    const pushed = branchPushed(root, "origin", branch);
    if (pushed === true || (pushed === null && revParse(root, `refs/remotes/origin/${branch}`))) return [];
    const proof = docsLandedProof(root, f, run);
    if (proof.landed) return [];
    if (proof.gone) {
      return [{
        level: "WARNING" as const,
        area: `${f.stage}/${f.folder}`,
        message: proof.remedy
          ? `docs_branch_unpushed: canonical docs for ${f.name} were committed to ${branch}, which is gone here, and are not proven landed (${proof.reason}).`
          : `docs_branch_unpushed: canonical docs for ${f.name} were committed to ${branch}, which is gone here, and nothing proves they landed (${proof.reason}).`,
        action: proof.remedy ? `${proof.remedy}, then re-run kf doctor` : docsNeverLandedDecision(f.name),
      }];
    }
    if (pushed === null) {
      return [{
        level: "WARNING" as const,
        area: `${f.stage}/${f.folder}`,
        message: `docs_branch_unpushed: canonical docs for ${f.name} were committed to ${branch}, which is gone here and not proven merged (${proof.reason}).`,
        action: `nothing to push; ${docsLookupRerunDecision(f.name, "kf doctor")}`,
      }];
    }
    return [{
      level: "WARNING" as const,
      area: `${f.stage}/${f.folder}`,
      // pushed: false means nothing records a push and no merged PR was found, so there is no reason to show.
      message: proof.pushed
        ? `docs_branch_unpushed: canonical docs for ${f.name} sit on ${branch}, which is not on origin and not proven merged (${proof.reason}).`
        : `docs_branch_unpushed: canonical docs for ${f.name} sit on ${branch}, which is not on origin.`,
      action: `git push -u origin ${branch}, then open a PR for it`,
    }];
  });
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

// Legacy keys are known so they never warn twice, but kf no longer reads them, so a hint never points at one.
const HINT_EXCLUDED = new Set(["ship", "stack", "defaultContext"]);

/** A top-level config key kf does not read is silently ignored, so a typo turns a setting off; name it, and the key it likely meant. */
function checkUnknownConfigKeys(root: string, cfg: ReturnType<typeof readProjectConfig> | null): DoctorFinding[] {
  if (!cfg) return [];
  const raw = readRawConfig(root);
  if (!raw) return [];
  return Object.keys(raw).filter((key) => !PROJECT_CONFIG_KEYS.has(key)).map((key) => {
    const near = [`${key}s`, key.endsWith("s") ? key.slice(0, -1) : undefined]
      .find((k): k is string => k !== undefined && PROJECT_CONFIG_KEYS.has(k) && !HINT_EXCLUDED.has(k));
    return {
      level: "WARNING" as const,
      area: ".kf/config.json",
      message: `unknown_config_key: "${key}" is not a kf config key and is ignored.`,
      action: near ? `did you mean "${near}"? rename or remove it` : "remove it, or keep it as a note (kf ignores it)",
    };
  });
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

/** The file as written, not as normalised by readProjectConfig, which fills stacks in from stack; with its text, for the indent. */
function readRawConfigText(root: string): { raw: Record<string, unknown>; text: string } | null {
  try {
    const text = readFileSync(configPath(root), "utf8");
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { raw: parsed as Record<string, unknown>, text } : null;
  } catch {
    // checkConfig already reported an unreadable config; a second finding would be noise.
    return null;
  }
}

function readRawConfig(root: string): Record<string, unknown> | null {
  return readRawConfigText(root)?.raw ?? null;
}

/** Diagnose a project. Read-only: nothing here writes, moves or deletes. */
export function runDoctor(root: string): DoctorReport {
  const findings: DoctorFinding[] = [];
  findings.push(...checkStageDirs(root));
  findings.push(...checkLegacyStageDirs(root));
  findings.push(...checkTravelIgnore(root));

  const config = checkConfig(root);
  findings.push(...config.findings);
  findings.push(...checkLegacyFields(root, config.cfg));
  findings.push(...checkUnknownConfigKeys(root, config.cfg));
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
  findings.push(...(config.cfg ? checkHarnessLegacyKeys(readRawConfig(root)) : []));
  findings.push(...checkLegacyRunState(root));
  findings.push(...deadLocks(root));

  // Invalid work items are the normal state of a running pipeline, so they are counted and
  // reported but deliberately kept out of `findings` — they must not decide the verdict.
  const items = listFeatures(root);
  const invalidItems = items.filter((f) => !validateFeature(f, false, true).valid).length;

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
export async function runDoctorFixes(root: string): Promise<DoctorFixResult> {
  const fixed: string[] = [];
  const failures: DoctorFinding[] = [];

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
    const read = readRawConfigText(root);
    if (read) {
      const { raw, text } = read;
      let changed = false;
      const configFixed: string[] = [];
      const cfg = checkConfig(root).cfg;
      if (raw.stack !== undefined && raw.stacks !== undefined) {
        delete raw.stack;
        configFixed.push('removed legacy "stack" (stacks is already set)');
        changed = true;
      }
      if (raw.defaultContext !== undefined && cfg?.contexts && cfg.contexts.length > 0) {
        delete raw.defaultContext;
        configFixed.push(`removed "defaultContext" (ignored; contexts[0] is "${cfg.contexts[0]}")`);
        changed = true;
      }
      const project = raw.project as Record<string, unknown> | undefined;
      const statusMap = project?.statusMap as Record<string, unknown> | undefined;
      if (cfg?.project?.statusMapLegacy && statusMap) {
        // An explicit `done` beside the legacy `dones` wins, the same choice the reader makes.
        if (statusMap.dones !== undefined && statusMap.done === undefined) statusMap.done = statusMap.dones;
        delete statusMap.dones;
        delete statusMap.shipping;
        configFixed.push("rewrote project.statusMap legacy keys (dones → done, shipping dropped)");
        changed = true;
      }
      const harnessFixed = cfg ? removeLegacyHarnessKeys(raw) : null;
      if (harnessFixed) {
        configFixed.push(harnessFixed);
        changed = true;
      }
      if (raw.repository === undefined && cfg) {
        const detected = detectRepository(root);
        if (detected) {
          raw.repository = detected;
          configFixed.push(`set "repository": "${detected}" (from the origin remote)`);
          changed = true;
        }
      }
      if (changed) {
        try {
          await writeFileAtomic(configPath(root), `${JSON.stringify(raw, null, jsonIndent(text))}\n`);
          fixed.push(...configFixed);
        } catch (err) {
          if (!(err instanceof Error && "code" in err)) throw err;
          failures.push(fixFailure(".kf/config.json", err));
        }
      }
    }
  }
  await stripLegacyRunState(root, fixed, failures);

  if (ignoreEntriesMissing(root).missing.includes(TRAVEL_IGNORE_ENTRY)) {
    appendIgnoreWorks(root, [TRAVEL_IGNORE_ENTRY]);
    fixed.push(`added ${TRAVEL_IGNORE_ENTRY} to .gitignore`);
  }

  repairHooks(root, fixed);
  await repairSkills(root, fixed, failures);

  return { fixed, failures };
}

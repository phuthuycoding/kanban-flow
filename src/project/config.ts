import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPathName, type Feature } from "../workflow/features.js";
import { parseAgentIds, type SkillScope } from "../integrations/agents.js";
import { validateHarness, type HarnessConfig } from "../harness/config.js";
import { normalizeContext } from "./contexts.js";
import { normalizeRepository } from "./repository.js";
import { STAGES, LEGACY_STAGE_NAMES, type Stage, type LegacyStageName } from "../workflow/schema.js";
import { parseWorktreeConfig, type WorktreeConfig } from "../worktree/config.js";
import { runGit } from "../shared/git.js";

export interface ProjectConfig {
  schema: string;
  /** Declared context list. Absent means unrestricted, as before. First entry is the default. */
  contexts?: string[];
  /** GitHub `owner/name` the project mirrors work items to; normalized on read from any repo URL form. */
  repository?: string;
  /** GitHub Projects board the hooks update on stage moves; only meaningful with `repository`. */
  project?: GitHubProject;
  /** @deprecated superseded by `contexts[0]`; still read for projects that predate `contexts` */
  defaultContext?: string;
  stacks?: string[];
  /** @deprecated legacy single-stack field — migrated to `stacks` on read */
  stack?: string | null;
  reviewer?: string;
  agents?: string[];
  /** Where `kf install`/`kf init` put managed skills. Absent means "global" (user-level). */
  skills?: SkillsConfig;
  harness?: HarnessConfig;
  worktree?: Partial<WorktreeConfig>;
  created: string;
}

/**
 * The `ship` block configured the removed `kf ship` pipeline. Configs written by earlier releases
 * still carry it, so any shape is accepted and dropped rather than refused; `kf doctor` reports it.
 * Returns whether a leftover block was present.
 */
export function hasLegacyShipBlock(raw: unknown): boolean {
  return raw !== undefined;
}

export interface SkillsConfig {
  scope: SkillScope;
}

/** The scope every consumer resolves through — absent `skills.scope` means "global". */
export function effectiveSkillsScope(cfg: Partial<ProjectConfig>): SkillScope {
  return cfg.skills?.scope ?? "global";
}

/** A GitHub Projects board the sync hooks mirror stages to; IDs are resolved per run from names. */
export interface GitHubProject {
  owner: string;
  number: number;
  /** kf stage → the board's Status option name. Option names, never IDs — a recreated board keeps working. */
  statusMap?: Partial<Record<string, string>>;
  /** The done hook gates on ticked acceptance criteria unless explicitly false. Default true. */
  acGate?: boolean;
  /**
   * Set on read when the file still keys `statusMap` by the legacy `dones` (read as `done`) or
   * `shipping` (dropped) names. The file itself is untouched; `kf doctor --fix` rewrites it.
   */
  statusMapLegacy?: boolean;
}

export const CONFIG_FILE = "config.json";

/** Stack ids that have a shipped review rule pack (kanban-flow/review/stacks/{id}.md). */
export const STACK_IDS = ["node", "go", "rust", "python", "php", "ruby", "java"] as const;
export type StackId = (typeof STACK_IDS)[number];

export function projectKabanDir(root: string): string {
  return join(root, ".kf");
}

export function configPath(root: string): string {
  return join(projectKabanDir(root), CONFIG_FILE);
}

function parseProjectBlock(value: unknown, file: string): GitHubProject | undefined {
  if (value === undefined) return undefined;
  const bad = () => new Error(`Invalid project config: ${file} — project must be {owner, number, statusMap?, acGate?}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  const p = value as Partial<GitHubProject>;
  if (typeof p.owner !== "string" || p.owner === ""
    || typeof p.number !== "number" || !Number.isInteger(p.number) || p.number < 1
    || (p.acGate !== undefined && typeof p.acGate !== "boolean")) throw bad();
  if (p.statusMap !== undefined) {
    if (typeof p.statusMap !== "object" || p.statusMap === null || Array.isArray(p.statusMap)) throw bad();
    const statusMap: Partial<Record<string, string>> = {};
    let legacy = false;
    for (const [stage, option] of Object.entries(p.statusMap)) {
      // `delivered` used to be a pseudo-stage (kf issues done, ≤0.8.0). It stays parseable
      // so old configs don't break — the key is inert: archive owns delivery now.
      const known = STAGES.includes(stage as Stage) || LEGACY_STAGE_NAMES.includes(stage as LegacyStageName) || stage === "delivered";
      if (!known || typeof option !== "string") throw bad();
      if (LEGACY_STAGE_NAMES.includes(stage as LegacyStageName)) {
        legacy = true;
        // `dones` is the old spelling of `done`; an explicit `done` beside it wins. `shipping` has no
        // stage left to map to, so the board option is dropped.
        if (stage === "dones" && p.statusMap.done === undefined) statusMap.done = option;
        continue;
      }
      statusMap[stage] = option;
    }
    return { ...p, statusMap, ...(legacy ? { statusMapLegacy: true } : {}) } as GitHubProject;
  }
  return p as GitHubProject;
}

function parseSkillsBlock(value: unknown, file: string): SkillsConfig | undefined {
  if (value === undefined) return undefined;
  const bad = () => new Error(`Invalid project config: ${file} — skills.scope must be "global" or "project"`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  const s = value as Partial<SkillsConfig>;
  if (s.scope !== "global" && s.scope !== "project") throw bad();
  return s as SkillsConfig;
}

/** Read the project config; missing config uses defaults, invalid config is an error. */
export function readProjectConfig(root: string): Partial<ProjectConfig> {
  const f = configPath(root);
  if (!existsSync(f)) return {};
  return parseProjectConfig(readFileSync(f, "utf8"), f);
}

/** The config text is not valid JSON or fails validation; a git or file-system failure is never one of these. */
export class ProjectConfigError extends Error {}

/** Validate and normalise config text read from anywhere (a file or a git ref); `f` names the source in errors. */
export function parseProjectConfig(text: string, f: string): Partial<ProjectConfig> {
  try {
    return parseConfigText(text, f);
  } catch (err) {
    if (err instanceof Error) throw new ProjectConfigError(err.message, { cause: err });
    throw err;
  }
}

function parseConfigText(text: string, f: string): Partial<ProjectConfig> {
  let cfg: Partial<ProjectConfig> | null;
  try {
    cfg = JSON.parse(text) as Partial<ProjectConfig> | null;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Invalid JSON in project config: ${f}`, { cause: err });
    throw err;
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)
    || (cfg.defaultContext !== undefined && typeof cfg.defaultContext !== "string")
    || (cfg.repository !== undefined && typeof cfg.repository !== "string")
    || (cfg.reviewer !== undefined && typeof cfg.reviewer !== "string")
    || (cfg.created !== undefined && typeof cfg.created !== "string")
    || (cfg.schema !== undefined && cfg.schema !== "kanban-flow")
    || (cfg.stack !== undefined && cfg.stack !== null && typeof cfg.stack !== "string")
    || (cfg.stacks !== undefined && (!Array.isArray(cfg.stacks) || !cfg.stacks.every((s) => typeof s === "string")))
    || (cfg.agents !== undefined && (!Array.isArray(cfg.agents) || !cfg.agents.every((a) => typeof a === "string")))) {
    throw new Error(`Invalid project config: ${f}`);
  }
  if (cfg.contexts !== undefined) {
    if (!Array.isArray(cfg.contexts) || cfg.contexts.length === 0 || !cfg.contexts.every((c) => typeof c === "string")) {
      throw new Error(`Invalid project config: ${f} — contexts must be a non-empty array of strings`);
    }
    for (const c of cfg.contexts) assertPathName(c, "context");
    const seen = new Set<string>();
    for (const c of cfg.contexts) {
      const key = normalizeContext(c);
      if (seen.has(key)) throw new Error(`Invalid project config: ${f} — contexts lists "${c}" twice (names are compared case-insensitively)`);
      seen.add(key);
    }
  }
  if (cfg.stacks === undefined && typeof cfg.stack === "string") cfg.stacks = [cfg.stack];
  if (cfg.defaultContext !== undefined) assertPathName(cfg.defaultContext, "context");
  if (cfg.repository !== undefined) {
    const repo = normalizeRepository(cfg.repository);
    if (!repo) {
      throw new Error(`Invalid project config: ${f} — repository must be a GitHub repo, "owner/name" or a github.com URL`);
    }
    cfg.repository = repo;
  }
  if (cfg.agents) parseAgentIds(cfg.agents);
  if (cfg.harness !== undefined) cfg.harness = validateHarness(cfg.harness, f);
  if (cfg.worktree !== undefined) cfg.worktree = parseWorktreeConfig(cfg.worktree, f);
  const { ship: _legacyShip, ...current } = cfg as Partial<ProjectConfig> & { ship?: unknown };
  cfg = current;
  cfg.skills = parseSkillsBlock(cfg.skills, f);
  cfg.project = parseProjectBlock(cfg.project, f);
  return cfg;
}

export type DriveConfigSource = "worktree" | "origin" | "primary";

export interface DriveConfig {
  cfg: Partial<ProjectConfig>;
  source: DriveConfigSource;
  /** Where the config was read: a file path, or `<ref>:.kf/config.json`. */
  file: string;
  /** Every place looked, in resolution order. */
  looked: string[];
}

/** `ref` is origin's default branch (null when origin/HEAD is not set); `text` is null when that ref has no config. */
export interface OriginConfig {
  ref: string | null;
  text: string | null;
}

export type OriginConfigReader = (root: string) => OriginConfig;

const ORIGIN_CONFIG_PATH = "./.kf/config.json";

/**
 * `git show <origin default>:.kf/config.json` from the primary repo. A missing origin, origin/HEAD, ref or file is
 * "no config there"; any other git failure throws with git's stderr.
 */
export function readOriginConfig(root: string): OriginConfig {
  const head = runGit(root, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code !== 0) {
    // -q makes "not a symbolic ref / no such ref" exit 1 silently; a project outside git has no origin either.
    if (head.code === 1 || /not a git repository/i.test(head.stderr)) return { ref: null, text: null };
    throw new Error(`git symbolic-ref refs/remotes/origin/HEAD failed (exit ${head.code}) in ${root}: ${head.stderr.trim()}`);
  }
  const ref = head.stdout.trim();
  // `./` resolves the path against `-C root`, so a project in a subdirectory of the repository reads its own config.
  const show = runGit(root, ["show", `${ref}:${ORIGIN_CONFIG_PATH}`]);
  if (show.code === 0) return { ref, text: show.stdout };
  if (/does not exist in|exists on disk, but not in|invalid object name|bad revision/i.test(show.stderr)) return { ref, text: null };
  throw new Error(`git show ${ref}:${ORIGIN_CONFIG_PATH} failed (exit ${show.code}) in ${root}: ${show.stderr.trim()}`);
}

// The driver resolves the config at every step boundary; one rev-parse per call instead of a symbolic-ref + show pair.
// Keyed on the commit origin/HEAD points at, so a fetch mid-drive is seen (and can raise config_changed).
const originCache = new Map<string, { sha: string; config: OriginConfig }>();
// A root without origin/HEAD would spawn rev-parse + symbolic-ref on every resolve, so the miss is remembered for the
// process. A later `git remote set-head` is seen by the next process only (the next kf drive and its supervisor),
// which also keeps a running drive from switching its config source mid-drive.
const noOriginHead = new Set<string>();

function cachedOriginConfig(root: string): OriginConfig {
  if (noOriginHead.has(root)) return { ref: null, text: null };
  const head = runGit(root, ["rev-parse", "-q", "--verify", "refs/remotes/origin/HEAD^{commit}"]);
  // No origin/HEAD, or no repository: readOriginConfig tells "absent" from a real git failure.
  if (head.code !== 0) {
    const config = readOriginConfig(root);
    if (config.ref === null) noOriginHead.add(root);
    return config;
  }
  const sha = head.stdout.trim();
  const hit = originCache.get(root);
  if (hit?.sha === sha) return hit.config;
  const config = readOriginConfig(root);
  originCache.set(root, { sha, config });
  return config;
}

/**
 * The config a drive or task run of `feature` works with, in a fixed order: the item worktree's `.kf/config.json`,
 * else the one on origin's default branch, else the primary checkout's. The primary can be a stale local `main`;
 * the item worktree is where the work happens. `worktree.baseDir` is not taken from here by callers that locate
 * worktrees: it is read from the primary, which is where the worktrees were created from.
 */
export function resolveDriveConfig(root: string, feature: Pick<Feature, "meta">, readOrigin: OriginConfigReader = cachedOriginConfig): DriveConfig {
  const looked: string[] = [];
  const worktreePath = feature.meta?.worktree?.path;
  if (worktreePath) {
    const file = configPath(worktreePath);
    looked.push(file);
    if (existsSync(file)) return { cfg: readProjectConfig(worktreePath), source: "worktree", file, looked };
  }
  const origin = readOrigin(root);
  const originFile = `${origin.ref ?? "origin/<default>"}:.kf/config.json`;
  looked.push(origin.ref ? originFile : `${originFile} (origin/HEAD is not set)`);
  if (origin.ref && origin.text !== null) return { cfg: parseProjectConfig(origin.text, originFile), source: "origin", file: originFile, looked };
  const file = configPath(root);
  looked.push(file);
  return { cfg: readProjectConfig(root), source: "primary", file, looked };
}

export function writeProjectConfig(root: string, cfg: ProjectConfig): void {
  writeFileSync(configPath(root), `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

const STACK_PROBES: Array<[string, string]> = [
  ["package.json", "node"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["composer.json", "php"],
  ["Gemfile", "ruby"],
  ["pom.xml", "java"],
];

/** Dirs never worth scanning for manifests (deps, VCS, build output). */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  "coverage", ".works", ".kf", "bin", "pkg", "__pycache__",
]);

/** Detect all tech stacks from manifest files at the root and subdirectories (monorepo-aware). */
export function detectStacks(root: string, maxDepth = 2): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number): void => {
    for (const [file, stack] of STACK_PROBES) {
      if (existsSync(join(dir, file)) && !found.includes(stack)) found.push(stack);
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
        visit(join(dir, e.name), depth + 1);
      }
    }
  };
  visit(root, 0);
  return found;
}

/** Detect the primary tech stack — first probe match at the project root only. */
export function detectStack(cwd: string): string | null {
  return detectStacks(cwd, 0)[0] ?? null;
}

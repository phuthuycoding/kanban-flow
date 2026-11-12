import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPathName } from "../workflow/features.js";
import { parseAgentIds, type SkillScope } from "../integrations/agents.js";
import { validateHarness, type HarnessConfig } from "./harness-config.js";
import { normalizeContext } from "./contexts.js";
import { normalizeRepository } from "./repository.js";
import { STAGES, LEGACY_STAGE_NAMES, type Stage, type LegacyStageName } from "../workflow/schema.js";
import { parseWorktreeConfig, type WorktreeConfig } from "../worktree/config.js";
import { writeFileAtomic } from "../shared/paths.js";
import { readConfigLayers } from "./config-layers.js";

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
 * Every top-level key kf reads from `.kf/config.json`, plus the legacy `ship` block `kf doctor` reports on its own.
 * Typed against `ProjectConfig` so a key added there without this list fails the typecheck instead of warning as unknown.
 */
export const PROJECT_CONFIG_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys({
    schema: true, contexts: true, repository: true, project: true, defaultContext: true, stacks: true, stack: true,
    reviewer: true, agents: true, skills: true, harness: true, worktree: true, created: true,
  } satisfies Record<keyof ProjectConfig, true>),
  "ship",
]);

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
  const bad = (detail?: string) => new Error(`Invalid project config: ${file} — project must be {owner, number, statusMap?, acGate?}${detail ? ` (${detail})` : ""}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  // statusMapLegacy is computed on read, never stored: a value in the file is dropped so a cleaned map reads clean.
  const { statusMapLegacy: _stored, ...p } = value as Partial<GitHubProject>;
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
      if (!known) throw bad(`unknown statusMap key "${stage}"`);
      if (typeof option !== "string") throw bad(`statusMap.${stage} must be a string`);
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

export function parseSkillsBlock(value: unknown, file: string): SkillsConfig | undefined {
  if (value === undefined) return undefined;
  const bad = () => new Error(`Invalid project config: ${file} — skills.scope must be "global" or "project"`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  const s = value as Partial<SkillsConfig>;
  if (s.scope !== "global" && s.scope !== "project") throw bad();
  return s as SkillsConfig;
}

/**
 * The effective config: global `~/.kf/config.json`, then the nearest `.kf/workspace.json`, then the project
 * file, each later layer winning. Missing files contribute nothing; an invalid one is an error naming it.
 */
export function readProjectConfig(root: string): Partial<ProjectConfig> {
  return readConfigLayers(root).effective;
}

/** The project's `.kf/config.json` alone — what writers of that file and its doctor checks must read. */
export function readProjectFileConfig(root: string): Partial<ProjectConfig> {
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

export function writeProjectConfig(root: string, cfg: ProjectConfig): void {
  // Callers write back a block they read; the read-time legacy flag must not land in the file.
  const { statusMapLegacy: _legacy, ...project } = cfg.project ?? {};
  const out = cfg.project ? { ...cfg, project } : cfg;
  writeFileSync(configPath(root), `${JSON.stringify(out, null, 2)}\n`, "utf8");
}

/** The indentation a JSON file was written with, so a rewrite changes only the keys it touches. */
export function jsonIndent(text: string): string | number {
  return /^[ \t]+(?=")/m.exec(text)?.[0] ?? 2;
}

/** Set top-level keys on the config file as written: every other key keeps its spelling, order and indent. */
export async function patchProjectConfig(root: string, keys: Record<string, unknown>): Promise<void> {
  const f = configPath(root);
  const text = readFileSync(f, "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  await writeFileAtomic(f, serializeConfigPreserving(text, { ...raw, ...keys }));
}

/**
 * Serialise `next` back over the JSON object text it was read from: a top-level key whose value is unchanged
 * keeps its exact source text, a changed or added key is written as JSON.stringify writes it with the file's
 * indent, and the trailing text after the closing brace is kept. Invalid JSON throws as JSON.parse does.
 */
export function serializeConfigPreserving(originalText: string, next: Record<string, unknown>): string {
  const original: unknown = JSON.parse(originalText);
  const rawIndent = jsonIndent(originalText);
  const indent = typeof rawIndent === "number" ? " ".repeat(rawIndent) : rawIndent;
  const isObject = original !== null && typeof original === "object" && !Array.isArray(original);
  const spans = isObject ? topLevelValueSpans(originalText) : new Map<string, string>();
  const parsed = isObject ? (original as Record<string, unknown>) : {};
  const trailing = /\s*$/.exec(originalText)?.[0] ?? "";
  const members: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const fresh = JSON.stringify(value, null, indent);
    if (fresh === undefined) continue;
    const kept = spans.get(key);
    const unchanged = kept !== undefined && Object.hasOwn(parsed, key) && JSON.stringify(parsed[key]) === JSON.stringify(value);
    members.push(`${indent}${JSON.stringify(key)}: ${unchanged ? kept : fresh.replace(/\n/g, `\n${indent}`)}`);
  }
  const body = members.length === 0 ? "{}" : `{\n${members.join(",\n")}\n}`;
  return `${body}${trailing}`;
}

/** The source text of each top-level member value of a valid JSON object text, keyed by member name. */
function topLevelValueSpans(text: string): Map<string, string> {
  const spans = new Map<string, string>();
  let i = text.indexOf("{") + 1;
  const skipWs = () => { while (/\s/.test(text[i] ?? "")) i++; };
  const skipString = () => {
    i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
  };
  const skipValue = () => {
    if (text[i] === '"') return skipString();
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { skipString(); continue; }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (depth === 0) return;
        depth--;
        if (depth === 0) { i++; return; }
      } else if (depth === 0 && (c === "," || /\s/.test(c))) return;
      i++;
    }
  };
  for (;;) {
    skipWs();
    if (text[i] !== '"') return spans;
    const keyStart = i;
    skipString();
    const key = JSON.parse(text.slice(keyStart, i)) as string;
    skipWs();
    i++;
    skipWs();
    const valueStart = i;
    skipValue();
    spans.set(key, text.slice(valueStart, i));
    skipWs();
    if (text[i] === ",") i++;
  }
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

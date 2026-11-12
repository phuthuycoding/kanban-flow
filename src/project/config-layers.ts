import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseAgentIds } from "../integrations/agents.js";
import { configPath, parseSkillsBlock, ProjectConfigError, readProjectFileConfig, type ProjectConfig } from "./config.js";

/**
 * Config layers: global `~/.kf/config.json`, the nearest ancestor `.kf/workspace.json`, and the project
 * `.kf/config.json`. Only person-level keys apply above the project; repository-bound keys would
 * mis-target every repo that inherited them.
 */
export type ConfigLayer = "global" | "workspace" | "project";

const ALL: readonly ConfigLayer[] = ["global", "workspace", "project"];
const PROJECT: readonly ConfigLayer[] = ["project"];

/**
 * The layers each top-level key applies at — the one table the reader, `kf config set` and `kf doctor` share.
 * A literal rather than derived from PROJECT_CONFIG_KEYS: config.ts imports this module, so a value read
 * from it at load time would hit the import cycle; `satisfies` keeps the list in step with ProjectConfig.
 */
export const KEY_LAYERS: Readonly<Record<string, readonly ConfigLayer[]>> = {
  reviewer: ALL, agents: ALL, skills: ALL,
  schema: PROJECT, contexts: PROJECT, repository: PROJECT, project: PROJECT, defaultContext: PROJECT,
  stacks: PROJECT, stack: PROJECT, harness: PROJECT, worktree: PROJECT, created: PROJECT, ship: PROJECT,
} satisfies Record<keyof ProjectConfig | "ship", readonly ConfigLayer[]>;

export function keyAppliesAt(key: string, layer: ConfigLayer): boolean {
  return Object.hasOwn(KEY_LAYERS, key) ? KEY_LAYERS[key].includes(layer) : layer === "project";
}

/** Resolved at call time: the per-test HOME must win over the HOME the process started with. */
export function globalConfigPath(): string {
  return join(homedir(), ".kf", "config.json");
}

export const WORKSPACE_CONFIG_FILE = "workspace.json";

/** The nearest `.kf/workspace.json` above the project root; the home dir holds the global file and is skipped. */
export function findWorkspaceConfigPath(projectRoot: string): string | null {
  const home = resolve(homedir());
  let dir = dirname(resolve(projectRoot));
  for (;;) {
    if (dir !== home) {
      const file = join(dir, ".kf", WORKSPACE_CONFIG_FILE);
      if (existsSync(file)) return file;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface ConfigLayerFile {
  layer: ConfigLayer;
  path: string;
  values: Partial<ProjectConfig>;
  /** Keys present in the file that do not apply at its layer (or that kf does not know). */
  notApplied: string[];
}

export interface ResolvedConfig {
  layers: ConfigLayerFile[];
  effective: Partial<ProjectConfig>;
  /** Dotted leaf path of `effective` → the layer it came from; arrays are leaves. */
  sources: Record<string, ConfigLayer>;
}

function validateLayerValue(key: string, value: unknown, path: string, layer: ConfigLayer): unknown {
  const bad = (detail: string) => new ProjectConfigError(`Invalid ${layer} config: ${path} — ${detail}`);
  switch (key) {
    case "reviewer":
      if (typeof value !== "string") throw bad("reviewer must be a string");
      return value;
    case "agents":
      if (!Array.isArray(value) || !value.every((a) => typeof a === "string")) throw bad("agents must be an array of strings");
      try {
        parseAgentIds(value);
      } catch (err) {
        if (err instanceof Error) throw new ProjectConfigError(`Invalid ${layer} config: ${path} — ${err.message}`, { cause: err });
        throw err;
      }
      return value;
    case "skills":
      try {
        return parseSkillsBlock(value, path);
      } catch (err) {
        if (err instanceof Error) throw new ProjectConfigError(err.message, { cause: err });
        throw err;
      }
    default:
      throw new Error(`no layer validator for key "${key}"`);
  }
}

/** Parse a global or workspace file; keys that do not apply at the layer are listed, never validated. */
export function parseLayerConfig(text: string, path: string, layer: "global" | "workspace"): { values: Partial<ProjectConfig>; notApplied: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) throw new ProjectConfigError(`Invalid JSON in ${layer} config: ${path}`, { cause: err });
    throw err;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProjectConfigError(`Invalid ${layer} config: ${path} — must be a JSON object`);
  const values: Record<string, unknown> = {};
  const notApplied: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!keyAppliesAt(key, layer)) {
      notApplied.push(key);
      continue;
    }
    values[key] = validateLayerValue(key, value, path, layer);
  }
  return { values: values as Partial<ProjectConfig>, notApplied };
}

const warned = new Set<string>();

/** Test seam: forget which files already printed their "not applied" warning. */
export function resetLayerWarnings(): void {
  warned.clear();
}

function readLayerFile(path: string, layer: "global" | "workspace"): ConfigLayerFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`Cannot read ${layer} config: ${path}`, { cause: err });
  }
  const { values, notApplied } = parseLayerConfig(text, path, layer);
  if (notApplied.length > 0 && !warned.has(path)) {
    warned.add(path);
    process.stderr.write(`kf: ${path}: not applied at the ${layer} layer: ${notApplied.join(", ")}\n`);
  }
  return { layer, path, values, notApplied };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = target[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      const copy = { ...current };
      mergeInto(copy, value);
      target[key] = copy;
    } else {
      target[key] = isPlainObject(value) ? mergeConfigLayers(value as Partial<ProjectConfig>) : value;
    }
  }
}

/** Later layers win; plain objects merge key by key, arrays and scalars are replaced whole; `undefined` is not set. */
export function mergeConfigLayers(...layers: Partial<ProjectConfig>[]): Partial<ProjectConfig> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) mergeInto(out, layer as Record<string, unknown>);
  return out as Partial<ProjectConfig>;
}

function recordSources(sources: Record<string, ConfigLayer>, value: Record<string, unknown>, layer: ConfigLayer, prefix: string): void {
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(v)) {
      delete sources[path];
      recordSources(sources, v, layer, path);
    } else {
      for (const k of Object.keys(sources)) if (k.startsWith(`${path}.`)) delete sources[k];
      sources[path] = layer;
    }
  }
}

/** Every layer file that exists for a project root, and the effective config they make. */
export function readConfigLayers(projectRoot: string): ResolvedConfig {
  const layers: ConfigLayerFile[] = [];
  // A project rooted at home owns ~/.kf/config.json as its project file; there is no global layer then.
  if (resolve(projectRoot) !== resolve(homedir())) {
    const global = globalConfigPath();
    if (existsSync(global)) layers.push(readLayerFile(global, "global"));
  }
  const workspace = findWorkspaceConfigPath(projectRoot);
  if (workspace) layers.push(readLayerFile(workspace, "workspace"));
  const projectFile = configPath(projectRoot);
  const projectValues = existsSync(projectFile) ? readProjectFileConfig(projectRoot) : {};
  if (existsSync(projectFile)) layers.push({ layer: "project", path: projectFile, values: projectValues, notApplied: [] });
  const sources: Record<string, ConfigLayer> = {};
  for (const l of layers) recordSources(sources, l.values as Record<string, unknown>, l.layer, "");
  // With no layer file above the project, hand back the project object itself: byte-for-byte as before.
  const effective = layers.every((l) => l.layer === "project")
    ? projectValues
    : mergeConfigLayers(...layers.map((l) => l.values));
  return { layers, effective, sources };
}

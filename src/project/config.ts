import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPathName } from "../workflow/features.js";
import { parseAgentIds } from "../integrations/agents.js";

export interface ProjectConfig {
  schema: string;
  defaultContext?: string;
  stack?: string | null;
  reviewer?: string;
  agents?: string[];
  created: string;
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

/** Read the project config; missing config uses defaults, invalid config is an error. */
export function readProjectConfig(root: string): Partial<ProjectConfig> {
  const f = configPath(root);
  if (!existsSync(f)) return {};
  let cfg: Partial<ProjectConfig> | null;
  try {
    cfg = JSON.parse(readFileSync(f, "utf8")) as Partial<ProjectConfig> | null;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Invalid JSON in project config: ${f}`, { cause: err });
    throw err;
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)
    || (cfg.defaultContext !== undefined && typeof cfg.defaultContext !== "string")
    || (cfg.reviewer !== undefined && typeof cfg.reviewer !== "string")
    || (cfg.created !== undefined && typeof cfg.created !== "string")
    || (cfg.schema !== undefined && cfg.schema !== "kanban-flow")
    || (cfg.stack !== undefined && cfg.stack !== null && typeof cfg.stack !== "string")
    || (cfg.agents !== undefined && (!Array.isArray(cfg.agents) || !cfg.agents.every((a) => typeof a === "string")))) {
    throw new Error(`Invalid project config: ${f}`);
  }
  if (cfg.defaultContext !== undefined) assertPathName(cfg.defaultContext, "context");
  if (cfg.agents) parseAgentIds(cfg.agents);
  return cfg;
}

export function writeProjectConfig(root: string, cfg: ProjectConfig): void {
  writeFileSync(configPath(root), `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

/** Detect the primary tech stack from a project root's manifest files. */
export function detectStack(cwd: string): string | null {
  const probes: Array<[string, string]> = [
    ["package.json", "node"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["composer.json", "php"],
    ["Gemfile", "ruby"],
    ["pom.xml", "java"],
  ];
  for (const [file, stack] of probes) {
    if (existsSync(join(cwd, file))) return stack;
  }
  return null;
}

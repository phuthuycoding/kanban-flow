import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { commandHelp, type ParsedArgs } from "../args.js";
import { configPath, parseProjectConfig, ProjectConfigError, serializeConfigPreserving } from "../../project/config.js";
import {
  findWorkspaceConfigPath,
  globalConfigPath,
  keyAppliesAt,
  parseLayerConfig,
  readConfigLayers,
  WORKSPACE_CONFIG_FILE,
  type ConfigLayer,
} from "../../project/config-layers.js";
import { writeFileAtomic } from "../../shared/paths.js";
import { findWorksRoot } from "../../workflow/features.js";
import type { CmdResult } from "../result.js";

type Scope = "global" | "workspace" | null;

/** One layer file and the rules it is validated by: a project rooted at home owns ~/.kf/config.json as its project file. */
interface LayerTarget {
  layer: ConfigLayer;
  path: string;
  rules: ConfigLayer;
}

type Resolved<T> = { ok: true; value: T } | { ok: false; refusal: CmdResult };

function refuse(stdout: string, stderr: string): { ok: false; refusal: CmdResult } {
  return { ok: false, refusal: { code: 1, stdout, stderr } };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isHome(dir: string): boolean {
  return resolve(dir) === resolve(homedir());
}

function getDotted(obj: unknown, key: string): unknown {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (!isPlainObject(cur) || !Object.hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Leaves of a parsed JSON object by dotted path; arrays are leaves, as in `ResolvedConfig.sources`. */
function leaves(obj: Record<string, unknown>, prefix = ""): { key: string; value: unknown }[] {
  const out: { key: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length > 0) out.push(...leaves(v, key));
    else out.push({ key, value: v });
  }
  return out;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    if (err instanceof SyntaxError) return raw;
    throw err;
  }
}

function parseFile(text: string, target: LayerTarget): { values: Partial<Record<string, unknown>>; notApplied: string[] } {
  if (target.rules === "project") return { values: parseProjectConfig(text, target.path), notApplied: [] };
  return parseLayerConfig(text, target.path, target.rules);
}

function globalTarget(root: string | null): LayerTarget {
  return root !== null && isHome(root)
    ? { layer: "global", path: configPath(root), rules: "project" }
    : { layer: "global", path: globalConfigPath(), rules: "global" };
}

const HOME_ROOT_NOTE = "the project root is the home directory, so ~/.kf/config.json is the project file and is validated as one";

function columns(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i].length))) ?? [];
  return rows.map((r) => `  ${r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ")}`);
}

function showEffective(root: string, json: boolean): CmdResult {
  const resolved = readConfigLayers(root);
  const files = resolved.layers.map((l) => ({ layer: l.layer, path: l.path }));
  if (json) {
    return { code: 0, stdout: JSON.stringify({ files, effective: resolved.effective, sources: resolved.sources }, null, 2) };
  }
  const keys = Object.keys(resolved.sources).sort();
  const lines = ["Layer files:"];
  lines.push(...(files.length === 0 ? ["  none"] : columns(files.map((f) => [f.layer, f.path]))));
  lines.push("", "Effective config:");
  lines.push(...(keys.length === 0
    ? ["  (empty)"]
    : columns(keys.map((k) => [k, JSON.stringify(getDotted(resolved.effective, k)), `(${resolved.sources[k]})`]))));
  return { code: 0, stdout: lines.join("\n") };
}

function showLayer(target: LayerTarget | null, layer: ConfigLayer, root: string | null, json: boolean): CmdResult {
  if (target === null || !existsSync(target.path)) {
    const where = target === null ? `above ${root}` : `at ${target.path}`;
    return { code: 0, stdout: json ? JSON.stringify({ layer, path: target?.path ?? null, values: null }, null, 2) : `No ${layer} config file ${where}.` };
  }
  const text = readFileSync(target.path, "utf8");
  const { notApplied } = parseFile(text, target);
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (json) return { code: 0, stdout: JSON.stringify({ layer, path: target.path, values: raw, notApplied }, null, 2) };
  const rows = leaves(raw).map(({ key, value }) => {
    const row = [key, JSON.stringify(value)];
    if (notApplied.includes(key.split(".")[0])) row.push(`(not applied at the ${layer} layer)`);
    return row;
  });
  const header = `${layer} file: ${target.path}${target.rules === "project" ? `\n(${HOME_ROOT_NOTE})` : ""}`;
  return { code: 0, stdout: [header, ...(rows.length === 0 ? ["  (empty)"] : columns(rows))].join("\n") };
}

function cmdShow(args: ParsedArgs, scope: Scope, root: string | null): CmdResult {
  const json = Boolean(args.options.json);
  if (scope === "global") return showLayer(globalTarget(root), "global", root, json);
  if (root === null) return noProject("show");
  if (scope === "workspace") {
    const path = findWorkspaceConfigPath(root);
    return showLayer(path === null ? null : { layer: "workspace", path, rules: "workspace" }, "workspace", root, json);
  }
  return showEffective(root, json);
}

function cmdGet(args: ParsedArgs, scope: Scope, root: string | null): CmdResult {
  const key = args.positionals[1];
  if (!key || args.positionals.length > 2) return { code: 1, stdout: "Usage: kf config get <key> [--global|--workspace]", stderr: "missing key" };
  if (scope === null) {
    if (root === null) return noProject("get");
    const value = getDotted(readConfigLayers(root).effective, key);
    if (value === undefined) return { code: 1, stdout: `${key} is not set.`, stderr: "not set" };
    return { code: 0, stdout: formatValue(value) };
  }
  if (scope === "workspace" && root === null) return noProject("get");
  const workspacePath = scope === "workspace" && root !== null ? findWorkspaceConfigPath(root) : null;
  const target = scope === "global" ? globalTarget(root) : workspacePath === null ? null : { layer: scope, path: workspacePath, rules: scope };
  if (target === null || !existsSync(target.path)) {
    const where = target === null ? `above ${root}` : `at ${target.path}`;
    return { code: 1, stdout: `${key} is not set: no ${scope} config file ${where}.`, stderr: "not set" };
  }
  const { values, notApplied } = parseFile(readFileSync(target.path, "utf8"), target);
  if (notApplied.includes(key.split(".")[0])) {
    return { code: 1, stdout: `${key} is not set at the ${scope} layer: ${target.path} has it, but it applies at the project layer only.`, stderr: "not set" };
  }
  const value = getDotted(values, key);
  if (value === undefined) return { code: 1, stdout: `${key} is not set in ${target.path}.`, stderr: "not set" };
  return { code: 0, stdout: formatValue(value) };
}

function isStrictAncestor(dir: string, of: string): boolean {
  const rel = relative(resolve(dir), resolve(of));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The workspace file `set --workspace` may write: one kf would read for this project, never one a nearer file shadows. */
function workspaceSetPath(root: string, cwd: string, dirOption: unknown): Resolved<string> {
  const nearest = findWorkspaceConfigPath(root);
  if (typeof dirOption !== "string" && nearest !== null) return { ok: true, value: nearest };
  const dir = typeof dirOption === "string" ? resolve(cwd, dirOption) : dirname(resolve(root));
  if (isHome(dir)) {
    return refuse(
      `${dir} is the home directory: kf does not search it for a workspace file (~/.kf/config.json is the global layer). Use --workspace-dir <dir> with an ancestor of the project below home, or --global.`,
      "home directory",
    );
  }
  if (!isStrictAncestor(dir, root)) {
    return refuse(`${dir} is not an ancestor of the project root ${root}: kf would never read a workspace file there.`, "not an ancestor");
  }
  const path = join(dir, ".kf", WORKSPACE_CONFIG_FILE);
  // The walk stops at the first file from the project up, so only one strictly between dir and the project shadows dir's.
  if (nearest !== null && isStrictAncestor(dir, dirname(dirname(nearest)))) {
    return refuse(`A nearer workspace file ${nearest} shadows ${path}: kf reads the nearest one only. Edit ${nearest} instead.`, "shadowed by a nearer workspace file");
  }
  return { ok: true, value: path };
}

function withValue(obj: Record<string, unknown>, parts: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = parts;
  if (rest.length === 0) return { ...obj, [head]: value };
  const child = obj[head];
  return { ...obj, [head]: withValue(isPlainObject(child) ? child : {}, rest, value) };
}

async function cmdSet(args: ParsedArgs, scope: Scope, root: string | null, cwd: string): Promise<CmdResult> {
  const [, key, rawValue] = args.positionals;
  if (!key || rawValue === undefined || args.positionals.length > 3) {
    return { code: 1, stdout: "Usage: kf config set <key> <value> [--global|--workspace] [--workspace-dir <path>]", stderr: "missing key or value" };
  }
  const parts = key.split(".");
  if (parts.some((p) => p === "")) return { code: 1, stdout: `Invalid key '${key}': expected a dotted path such as worktree.enabled.`, stderr: "invalid key" };
  if (scope === null && root === null) {
    return {
      code: 1,
      stdout: "No kf project here (no .works found): kf config set writes the project file .kf/config.json. Run it inside a project, or use --global to write ~/.kf/config.json.",
      stderr: "no project",
    };
  }
  if (scope === "workspace" && root === null) return noProject("set --workspace");

  const global = scope === "global" ? globalTarget(root) : null;
  const rules: ConfigLayer = scope === null ? "project" : global?.rules ?? scope;
  const top = parts[0];
  if (!keyAppliesAt(top, rules)) {
    return { code: 1, stdout: `"${top}" applies at the project layer only: set it in the project's .kf/config.json (without --${scope}).`, stderr: "key not applied at this layer" };
  }
  let target: LayerTarget;
  if (global !== null) target = global;
  else if (scope === null) target = { layer: "project", path: configPath(root!), rules };
  else {
    const path = workspaceSetPath(root!, cwd, args.options["workspace-dir"]);
    if (!path.ok) return path.refusal;
    target = { layer: "workspace", path: path.value, rules };
  }

  const existed = existsSync(target.path);
  const text = existed ? readFileSync(target.path, "utf8") : null;
  // An invalid file is refused as it stands: rewriting it would silently drop what the user wrote.
  if (text !== null) parseFile(text, target);
  const current = text === null ? {} : (JSON.parse(text) as Record<string, unknown>);
  const blocker = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(".")).find((p) => {
    const v = getDotted(current, p);
    return v !== undefined && !isPlainObject(v);
  });
  if (blocker !== undefined) {
    return { code: 1, stdout: `Cannot set ${key}: ${blocker} in ${target.path} is not an object.`, stderr: "not an object" };
  }
  const value = parseValue(rawValue);
  const next = withValue(current, parts, value);
  parseFile(JSON.stringify(next), target);
  await writeFileAtomic(target.path, text === null ? `${JSON.stringify(next, null, 2)}\n` : serializeConfigPreserving(text, next));
  const lines = [`Set ${key} = ${JSON.stringify(value)} in ${target.path}${existed ? "" : " (created)"}`];
  if (scope === "global" && target.rules === "project") lines.push(`Note: ${HOME_ROOT_NOTE}.`);
  return { code: 0, stdout: lines.join("\n") };
}

function noProject(what: string): CmdResult {
  return { code: 1, stdout: `No kf project here (no .works found): kf config ${what} needs a project. Use --global for the global layer.`, stderr: "no project" };
}

export async function cmdConfig(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const sub = args.positionals[0];
  if (sub !== "show" && sub !== "get" && sub !== "set") {
    return { code: 1, stdout: commandHelp("config"), stderr: "unknown config subcommand" };
  }
  if (args.options.global && args.options.workspace) {
    return { code: 1, stdout: "Use --global or --workspace, not both.", stderr: "conflicting layers" };
  }
  const scope: Scope = args.options.global ? "global" : args.options.workspace ? "workspace" : null;
  if (args.options["workspace-dir"] !== undefined && !(sub === "set" && scope === "workspace")) {
    return { code: 1, stdout: "--workspace-dir goes with kf config set --workspace only.", stderr: "stray --workspace-dir" };
  }
  const root = findWorksRoot(cwd);
  try {
    if (sub === "show") return cmdShow(args, scope, root);
    if (sub === "get") return cmdGet(args, scope, root);
    return await cmdSet(args, scope, root, cwd);
  } catch (err) {
    // An invalid config file (or an invalid result of `set`) is the answer, naming the file; nothing was written.
    if (err instanceof ProjectConfigError) return { code: 1, stdout: err.message, stderr: "invalid config" };
    throw err;
  }
}

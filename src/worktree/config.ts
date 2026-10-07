import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

/**
 * Per-project worktree settings live in `.kf/config.json` (committed — the whole
 * team shares them). Machine settings live in `~/.config/kanban-flow/config.json`
 * (never committed — they describe this machine's DNS/proxy layout).
 */
export interface WorktreeConfig {
  enabled: boolean;
  /** Directory worktrees are created under; default `<repo>-worktrees` next to the repo. */
  baseDir: string;
  branchPrefix: string;
  /** Public suffix of the worktree domain: `<feature>.<baseDomain>`. */
  baseDomain: string;
  portBase: number;
  routesFile: string;
}

/** Machine-level proxy/DNS settings; one proxy serves every project on the machine. */
export interface MachineConfig {
  proxyListen: string;
  domainZone: string;
  /** Unrouted hosts are forwarded here (e.g. a legacy server on 127.0.0.1:80); null → 502. */
  fallbackUpstream: string | null;
  /** Machine-global routing table the proxy reads; project `worktree.routesFile` overrides for tests. */
  routesFile: string;
}

export const MACHINE_CONFIG_DIR = resolve(homedir(), ".config", "kanban-flow");
export const MACHINE_CONFIG_FILE = join(MACHINE_CONFIG_DIR, "config.json");
export const DEFAULT_ROUTES_FILE = join(MACHINE_CONFIG_DIR, "proxy-routes.json");

const DEFAULT_MACHINE: MachineConfig = {
  proxyListen: "127.0.0.2:80",
  domainZone: "test",
  fallbackUpstream: "127.0.0.1:80",
  routesFile: DEFAULT_ROUTES_FILE,
};

/** Lowercase DNS-safe slug for feature/repo names (`[a-z0-9-]` only). */
export function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  if (!slug) throw new Error(`Cannot derive a DNS-safe name from '${value}'.`);
  return slug;
}

export function repoSlug(root: string): string {
  return slugify(basename(root));
}

/** Validate the `worktree` block of `.kf/config.json`; absent block → defaults. */
export function parseWorktreeConfig(raw: unknown, file: string): Partial<WorktreeConfig> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid project config: ${file} — worktree must be an object`);
  }
  const w = raw as Record<string, unknown>;
  if (w.enabled !== undefined && typeof w.enabled !== "boolean")
    throw new Error(`Invalid project config: ${file} — worktree.enabled must be boolean`);
  if (w.baseDir !== undefined && typeof w.baseDir !== "string")
    throw new Error(`Invalid project config: ${file} — worktree.baseDir must be a string`);
  if (w.branchPrefix !== undefined && typeof w.branchPrefix !== "string")
    throw new Error(`Invalid project config: ${file} — worktree.branchPrefix must be a string`);
  if (w.baseDomain !== undefined && (typeof w.baseDomain !== "string" || !/^[a-z0-9.-]+$/.test(w.baseDomain)))
    throw new Error(`Invalid project config: ${file} — worktree.baseDomain must be a DNS suffix like "myrepo.test"`);
  if (w.portBase !== undefined && (typeof w.portBase !== "number" || !Number.isInteger(w.portBase) || w.portBase < 1024 || w.portBase > 65000))
    throw new Error(`Invalid project config: ${file} — worktree.portBase must be an integer 1024–65000`);
  if (w.routesFile !== undefined && typeof w.routesFile !== "string")
    throw new Error(`Invalid project config: ${file} — worktree.routesFile must be a string`);
  return w as Partial<WorktreeConfig>;
}

/** Effective worktree settings for a repo root. */
export function worktreeConfig(root: string, raw: Partial<WorktreeConfig> | undefined): WorktreeConfig {
  return {
    enabled: raw?.enabled ?? true,
    baseDir: raw?.baseDir ?? `${root}-worktrees`,
    branchPrefix: raw?.branchPrefix ?? "kf/",
    baseDomain: raw?.baseDomain ?? `${repoSlug(root)}.test`,
    portBase: raw?.portBase ?? 5100,
    routesFile: raw?.routesFile ?? DEFAULT_ROUTES_FILE,
  };
}

export function worktreeDir(cfg: WorktreeConfig, feature: string): string {
  const dir = isAbsolute(cfg.baseDir) ? cfg.baseDir : resolve(cfg.baseDir);
  return join(dir, feature);
}

export function worktreeDomain(cfg: WorktreeConfig, feature: string): string {
  return `${slugify(feature)}.${cfg.baseDomain}`;
}

export function worktreeBranch(cfg: WorktreeConfig, feature: string): string {
  return `${cfg.branchPrefix}${feature}`;
}

export function readMachineConfig(file = MACHINE_CONFIG_FILE): MachineConfig {
  if (!existsSync(file)) return { ...DEFAULT_MACHINE };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Invalid JSON in machine config: ${file}`, { cause: err });
    throw err;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid machine config: ${file}`);
  const c = raw as Partial<MachineConfig>;
  if ((c.proxyListen !== undefined && typeof c.proxyListen !== "string")
    || (c.domainZone !== undefined && typeof c.domainZone !== "string")
    || (c.routesFile !== undefined && typeof c.routesFile !== "string")
    || (c.fallbackUpstream !== undefined && c.fallbackUpstream !== null && typeof c.fallbackUpstream !== "string")) {
    throw new Error(`Invalid machine config: ${file}`);
  }
  return { ...DEFAULT_MACHINE, ...c };
}

/** Split `host:port`; throws on a malformed value so bad config surfaces early. */
export function splitListen(listen: string): { host: string; port: number } {
  const m = /^(.+):(\d+)$/.exec(listen);
  if (!m) throw new Error(`Invalid listen address '${listen}': expected host:port.`);
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid listen address '${listen}': port out of range.`);
  }
  return { host: m[1], port };
}

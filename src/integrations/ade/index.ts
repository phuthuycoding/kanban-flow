import { readMachineConfig } from "../../worktree/config.js";
import type { AdeAdapter, AdeContext, AdeSyncResult } from "./types.js";
import { orcaAdapter } from "./orca.js";
import { herdrAdapter } from "./herdr.js";

export type { AdeAdapter, AdeContext, AdeSyncResult, AdeTarget } from "./types.js";

/**
 * The single extension point: adding an ADE = one adapter file + one entry here.
 * Order is the order results are reported in.
 */
export const ADE_ADAPTERS: AdeAdapter[] = [herdrAdapter, orcaAdapter];

export interface AdeSyncOpts {
  /** Test seams — default registry and machine config file when omitted. */
  adapters?: AdeAdapter[];
  machineFile?: string;
}

/** Machine-level opt-out — `adeSync: false` in ~/.config/kanban-flow/config.json, or `KF_ADE_SYNC=0|off|false` (CI/test kill-switch). */
export function adeSyncEnabled(machineFile?: string): boolean {
  const env = process.env.KF_ADE_SYNC;
  if (env !== undefined && ["0", "false", "off"].includes(env.toLowerCase())) return false;
  return readMachineConfig(machineFile).adeSync !== false;
}

function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n").slice(0, 3).join("\n");
}

/** Adapters that pass detection right now; detection failures mean "unavailable". */
export function availableAdapters(adapters: AdeAdapter[] = ADE_ADAPTERS): AdeAdapter[] {
  return adapters.filter((a) => {
    try {
      return a.isAvailable();
    } catch {
      return false;
    }
  });
}

/**
 * Attach a worktree into every reachable ADE. Side-effect-only: adapter errors
 * become {ok:false, warning} results — this never throws for adapter failures.
 * Returns [] when adeSync is off or no ADE is reachable.
 */
export function attachWorktreeToAdes(ctx: AdeContext, opts: AdeSyncOpts = {}): AdeSyncResult[] {
  if (!adeSyncEnabled(opts.machineFile)) return [];
  const results: AdeSyncResult[] = [];
  for (const adapter of availableAdapters(opts.adapters)) {
    try {
      results.push(adapter.attach(ctx));
    } catch (err) {
      results.push({ ade: adapter.label, ok: false, warning: shortError(err) });
    }
  }
  return results;
}

/** Detach counterpart for teardown; yields warning strings for callers to surface. */
export function detachWorktreeFromAdes(ctx: AdeContext, opts: AdeSyncOpts = {}): string[] {
  if (!adeSyncEnabled(opts.machineFile)) return [];
  const warnings: string[] = [];
  for (const adapter of availableAdapters(opts.adapters)) {
    if (!adapter.detach) continue;
    try {
      const res = adapter.detach(ctx);
      if (res?.warning) warnings.push(`${adapter.label}: ${res.warning}`);
    } catch (err) {
      warnings.push(`${adapter.label}: ${shortError(err)}`);
    }
  }
  return warnings;
}

/** Render results for CLI stdout — one `  Ade: detail` or `  ⚠ Ade: warning` line each. */
export function renderAdeResults(results: AdeSyncResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.warning) lines.push(`  ⚠ ${r.ade}: ${r.warning}`);
    else if (r.detail) lines.push(`  ${r.ade}: ${r.detail}`);
  }
  return lines.join("\n");
}

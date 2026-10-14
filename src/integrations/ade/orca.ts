import { existsSync, realpathSync } from "node:fs";

import type { AdeAdapter, AdeContext, AdeSyncResult } from "./types.js";
import { runCli, runCliJson } from "./runner.js";

/** ORCA_CLI_COMMAND is exported by Orca for managed sessions; bare `orca` elsewhere. */
const BIN = () => process.env.ORCA_CLI_COMMAND || "orca";

const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);

interface OrcaStatus {
  ok?: boolean;
  result?: { runtime?: { reachable?: boolean; state?: string } };
}

interface OrcaRepo {
  id: string;
  displayName?: string;
  externalWorktreeVisibility?: string;
}

interface OrcaWorktreeList {
  result?: { worktrees?: Array<{ id?: string; path?: string }> };
}

/**
 * Orca cannot adopt an existing checkout through its CLI — `worktree create`
 * only makes Orca-owned checkouts. External git worktrees surface when the repo
 * is registered (`repo add`) and its external-worktree visibility is "show";
 * there is no CLI setter for that flag, so a hidden repo degrades to a warning.
 */
export const orcaAdapter: AdeAdapter = {
  id: "orca",
  label: "Orca",

  isAvailable(): boolean {
    const res = runCli(BIN(), ["status", "--json"]);
    if (res.missing || res.code !== 0) return false;
    try {
      const status = JSON.parse(res.stdout) as OrcaStatus;
      const rt = status.result?.runtime;
      return status.ok === true && (rt?.reachable === true || rt?.state === "ready");
    } catch {
      // e.g. Linux `orca` resolving to the GNOME screen reader — not our runtime.
      return false;
    }
  },

  attach(ctx: AdeContext): AdeSyncResult {
    const added = runCliJson(BIN(), ["repo", "add", "--path", ctx.root, "--json"]) as {
      result?: { repo?: OrcaRepo };
    };
    const repo = added.result?.repo;
    if (!repo?.id) throw new Error("orca repo add returned no repo id");

    const listed = runCliJson(BIN(), ["worktree", "list", "--repo", `id:${repo.id}`, "--json"]) as OrcaWorktreeList;
    const wtPath = real(ctx.target.path);
    const visible = (listed.result?.worktrees ?? []).some(
      (w) => (w.path ? real(w.path) === wtPath : false) || w.id === `${repo.id}::${wtPath}` || w.id?.endsWith(`::${wtPath}`),
    );
    if (visible) {
      return { ade: "Orca", ok: true, detail: `worktree '${ctx.target.label}' visible in repo '${repo.displayName ?? repo.id}'` };
    }
    return {
      ade: "Orca",
      ok: true,
      warning:
        `repo registered, but '${ctx.target.label}' is not listed — in Orca open repo '${repo.displayName ?? repo.id}' ` +
        `settings and enable external worktree visibility`,
    };
  },
};

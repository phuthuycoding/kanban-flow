import { existsSync, realpathSync } from "node:fs";

import type { AdeAdapter, AdeContext, AdeSyncResult } from "./types.js";
import { runCli, runCliJson } from "./runner.js";

const BIN = "herdr";

const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);

interface HerdrWorktree {
  path?: string;
  open_workspace_id?: string | null;
}

/** `herdr worktree list --cwd <root>` — the flag selects the repo; Herdr otherwise uses its ambient context. */
function listWorktrees(root: string): HerdrWorktree[] {
  const res = runCliJson(BIN, ["worktree", "list", "--cwd", root], { cwd: root }) as {
    result?: { worktrees?: HerdrWorktree[] };
  };
  return res.result?.worktrees ?? [];
}

export const herdrAdapter: AdeAdapter = {
  id: "herdr",
  label: "Herdr",

  isAvailable(): boolean {
    const res = runCli(BIN, ["status"]);
    if (res.missing || res.code !== 0) return false;
    return /server:[\s\S]*?status:\s*running/.test(res.stdout);
  },

  attach(ctx: AdeContext): AdeSyncResult {
    // `worktree open [--workspace ID | --cwd PATH] (--path | --branch)`: --cwd
    // selects the repo, --path the worktree inside it — omitting --cwd makes
    // Herdr resolve the path against whichever repo its UI currently shows.
    const args = [
      "worktree", "open",
      "--cwd", ctx.root,
      "--path", ctx.target.path,
      "--label", ctx.target.label,
      ctx.target.focus ? "--focus" : "--no-focus",
    ];
    const res = runCliJson(BIN, args, { cwd: ctx.root }) as {
      result?: { type?: string; already_open?: boolean };
    };
    const r = res.result ?? {};
    if (r.type !== "worktree_opened" && r.already_open !== true) {
      throw new Error(`unexpected worktree open response: ${r.type ?? "unknown"}`);
    }
    return {
      ade: "Herdr",
      ok: true,
      detail: r.already_open ? `workspace '${ctx.target.label}' already open` : `opened workspace '${ctx.target.label}'`,
    };
  },

  /** Close the workspace bound to this checkout; nothing open → silent no-op. */
  detach(ctx: AdeContext): AdeSyncResult | null {
    const wt = listWorktrees(ctx.root).find((w) => w.path && real(w.path) === real(ctx.target.path));
    if (!wt?.open_workspace_id) return null;
    runCliJson(BIN, ["workspace", "close", wt.open_workspace_id], { cwd: ctx.root });
    return { ade: "Herdr", ok: true, detail: `closed workspace '${ctx.target.label}'` };
  },
};

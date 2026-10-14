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
    // Opening a worktree of a repo Herdr never saw also creates a workspace for
    // the repo itself — remember whether one existed so detach can clean it up.
    const repoHadWs = listWorktrees(ctx.root).some(
      (w) => w.path && real(w.path) === real(ctx.root) && w.open_workspace_id,
    );
    const args = [
      "worktree", "open",
      "--cwd", ctx.root,
      "--path", ctx.target.path,
      "--label", ctx.target.label,
      ctx.target.focus ? "--focus" : "--no-focus",
    ];
    const res = runCliJson(BIN, args, { cwd: ctx.root }) as {
      result?: { type?: string; already_open?: boolean; workspace?: { workspace_id?: string } };
    };
    const r = res.result ?? {};
    if (r.type !== "worktree_opened" && r.already_open !== true) {
      throw new Error(`unexpected worktree open response: ${r.type ?? "unknown"}`);
    }

    // Focused attach while running inside a Herdr pane: the pane the user is in
    // migrates into the worktree's workspace (pane/process survive the move;
    // an emptied source workspace auto-closes). Outside Herdr, plain focus.
    const pane = process.env.HERDR_PANE_ID;
    const wsId = r.workspace?.workspace_id;
    if (ctx.target.focus && pane && wsId && process.env.HERDR_WORKSPACE_ID !== wsId) {
      const mv = runCli(BIN, ["pane", "move", pane, "--new-tab", "--workspace", wsId, "--label", ctx.target.label, "--focus"], { cwd: ctx.root });
      if (mv.code !== 0) {
        return { ade: "Herdr", ok: true, detail: `opened workspace '${ctx.target.label}'`, warning: `pane move failed: ${mv.stderr.trim() || `exit ${mv.code}`}` };
      }
    }

    let autoWorkspaceId: string | undefined;
    if (!repoHadWs) {
      autoWorkspaceId = listWorktrees(ctx.root).find(
        (w) => w.path && real(w.path) === real(ctx.root) && w.open_workspace_id,
      )?.open_workspace_id ?? undefined;
    }
    return {
      ade: "Herdr",
      ok: true,
      detail: r.already_open ? `workspace '${ctx.target.label}' already open` : `opened workspace '${ctx.target.label}'`,
      autoWorkspaceId,
    };
  },

  /** Close the workspace bound to this checkout; nothing open → silent no-op. */
  detach(ctx: AdeContext): AdeSyncResult | null {
    const entries = listWorktrees(ctx.root);
    const wt = entries.find((w) => w.path && real(w.path) === real(ctx.target.path));
    const repoWs = entries.find((w) => w.path && real(w.path) === real(ctx.root) && w.open_workspace_id)?.open_workspace_id;
    const wsToClose = wt?.open_workspace_id ?? null;

    // Detach must never kill the pane running this command — when it lives in
    // the workspace about to close, migrate it to the repo anchor first; no
    // safe target → leave the workspace open and warn instead.
    const ownWs = process.env.HERDR_WORKSPACE_ID;
    const pane = process.env.HERDR_PANE_ID;
    const closingRepoToo = Boolean(ctx.target.adeRepoWorkspaceId) && !entries.some(
      (w) => w.path && real(w.path) !== real(ctx.root) && real(w.path) !== real(ctx.target.path) && w.open_workspace_id,
    );
    const safeTarget = repoWs && !closingRepoToo ? repoWs : null;
    if (wsToClose && ownWs === wsToClose && pane) {
      if (safeTarget) {
        runCli(BIN, ["pane", "move", pane, "--new-tab", "--workspace", safeTarget, "--no-focus"], { cwd: ctx.root });
      } else {
        return { ade: "Herdr", ok: true, detail: `workspace '${ctx.target.label}' kept open`, warning: "command is running inside the workspace being closed — left it open" };
      }
    }
    const anchor = ctx.target.adeRepoWorkspaceId;
    const closeAnchor = Boolean(anchor && closingRepoToo && repoWs === anchor);
    if (!wsToClose) {
      // Worktree ws already gone — the auto-created repo anchor may still leak.
      if (closeAnchor) runCli(BIN, ["workspace", "close", repoWs!, "--group"], { cwd: ctx.root });
      return null;
    }
    runCliJson(BIN, ["workspace", "close", wsToClose], { cwd: ctx.root });
    // Close the repo anchor we implicitly created, once nothing else of this
    // repo stays open. Group-close is required while sibling worktree ws exist.
    if (closeAnchor) runCli(BIN, ["workspace", "close", repoWs!, "--group"], { cwd: ctx.root });
    return { ade: "Herdr", ok: true, detail: `closed workspace '${ctx.target.label}'` };
  },
};

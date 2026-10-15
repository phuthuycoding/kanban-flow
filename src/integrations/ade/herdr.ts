import { existsSync, realpathSync } from "node:fs";

import type { AdeAdapter, AdeContext, AdeSyncResult } from "./types.js";
import { runCli, runCliJson } from "./runner.js";

const BIN = "herdr";

const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);

interface HerdrWorktree {
  path?: string;
  open_workspace_id?: string | null;
}

interface HerdrWorkspace {
  workspace_id?: string;
  worktree?: { checkout_path?: string; repo_root?: string };
}

interface HerdrPane {
  pane_id?: string;
  workspace_id?: string;
  cwd?: string;
  foreground_cwd?: string;
}

/** `herdr worktree list --cwd <root>` — the flag selects the repo; Herdr otherwise uses its ambient context. */
function listWorktrees(root: string): HerdrWorktree[] {
  const res = runCliJson(BIN, ["worktree", "list", "--cwd", root], { cwd: root }) as {
    result?: { worktrees?: HerdrWorktree[] };
  };
  return res.result?.worktrees ?? [];
}

function listWorkspaces(root: string): HerdrWorkspace[] {
  const res = runCliJson(BIN, ["workspace", "list"], { cwd: root }) as {
    result?: { workspaces?: HerdrWorkspace[] };
  };
  return res.result?.workspaces ?? [];
}

function listPanes(root: string): HerdrPane[] {
  const res = runCliJson(BIN, ["pane", "list"], { cwd: root }) as {
    result?: { panes?: HerdrPane[] };
  };
  return res.result?.panes ?? [];
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
    const wsToClose = wt?.open_workspace_id ?? null;
    // `worktree list` never tags the repo row — the anchor ws must come from
    // `workspace list`, where the repo workspace reports checkout_path == root.
    const workspaces = listWorkspaces(ctx.root);
    const repoWs = workspaces.find(
      (w) => w.worktree?.checkout_path && real(w.worktree.checkout_path) === real(ctx.root),
    )?.workspace_id ?? null;
    const panes = listPanes(ctx.root);

    // Identify the pane running this command. Env vars are fastest; when they
    // are absent (agent shells don't always inherit them) fall back to the
    // pane whose cwd sits inside the checkout being torn down.
    const envPane = process.env.HERDR_PANE_ID;
    const envWs = process.env.HERDR_WORKSPACE_ID;
    const caller = envPane
      ? panes.find((p) => p.pane_id === envPane)
      : panes.find(
          (p) => p.workspace_id === wsToClose && (p.foreground_cwd ?? p.cwd)
            && real((p.foreground_cwd ?? p.cwd)!).startsWith(real(ctx.target.path)),
        );
    const callerWs = envWs ?? caller?.workspace_id ?? null;
    const callerPaneId = envPane ?? caller?.pane_id ?? null;

    const closingRepoToo = Boolean(ctx.target.adeRepoWorkspaceId) && !entries.some(
      (w) => w.path && real(w.path) !== real(ctx.root) && real(w.path) !== real(ctx.target.path) && w.open_workspace_id,
    );
    const safeTarget = repoWs && !closingRepoToo ? repoWs : null;

    // Detach must never kill the pane running this command.
    if (wsToClose && callerWs === wsToClose) {
      if (safeTarget && callerPaneId) {
        runCli(BIN, ["pane", "move", callerPaneId, "--new-tab", "--workspace", safeTarget, "--no-focus"], { cwd: ctx.root });
      } else {
        return { ade: "Herdr", ok: true, detail: `workspace '${ctx.target.label}' kept open`, warning: "command is running inside the workspace being closed — left it open" };
      }
    }

    // A group close kills EVERY workspace bound to the repo — including the
    // one hosting this command. If our ws is in the group, leave the anchor
    // open with a warning instead of murdering the caller.
    const groupWs = new Set([
      repoWs,
      ...entries.map((w) => w.open_workspace_id),
    ].filter((id): id is string => Boolean(id)));
    const anchor = ctx.target.adeRepoWorkspaceId;
    const callerInGroup = callerWs != null && groupWs.has(callerWs);
    const closeAnchor = Boolean(anchor && closingRepoToo && repoWs === anchor && !callerInGroup);
    const anchorWarn = anchor && closingRepoToo && repoWs === anchor && callerInGroup
      ? "repo workspace left open — this command is running inside it" : undefined;
    if (!wsToClose) {
      if (closeAnchor) runCli(BIN, ["workspace", "close", repoWs!, "--group"], { cwd: ctx.root });
      return anchorWarn ? { ade: "Herdr", ok: true, warning: anchorWarn } : null;
    }
    runCliJson(BIN, ["workspace", "close", wsToClose], { cwd: ctx.root });
    if (closeAnchor) runCli(BIN, ["workspace", "close", repoWs!, "--group"], { cwd: ctx.root });
    return { ade: "Herdr", ok: true, detail: `closed workspace '${ctx.target.label}'`, warning: anchorWarn };
  },
};

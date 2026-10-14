/**
 * ADE (agentic development environment) adapters — one file per tool, registered
 * in `index.ts`'s ADE_ADAPTERS. An adapter only mirrors a worktree that kf already
 * created into an external app; it never owns git state.
 */

/** A checkout to surface inside an ADE — a registered kf worktree or a foreign one. */
export interface AdeTarget {
  path: string;
  branch: string | null;
  /** Display name in the ADE — the feature name, or a branch/dir-derived name for foreign worktrees. */
  label: string;
  /**
   * True when the attach should also focus the workspace in the ADE — set on
   * creation paths (create/stage→implementation), unset on `sync` catch-up.
   * Adapters without a focus concept ignore it.
   */
  focus?: boolean;
  /**
   * Id of the repo anchor workspace the attach implicitly created (persisted by
   * the caller on the worktree registration); detach uses it to clean that
   * anchor up. Adapters without an anchor concept leave it unset.
   */
  adeRepoWorkspaceId?: string;
}

export interface AdeContext {
  /** Main checkout root (where `.works/` lives), resolved via findWorksRoot. */
  root: string;
  target: AdeTarget;
}

export interface AdeSyncResult {
  /** Adapter display label, e.g. "Orca". */
  ade: string;
  ok: boolean;
  /** Success line for command output, e.g. "opened as workspace 'demo'". */
  detail?: string;
  /** Advisory or failure text — rendered as `⚠ <ade>: <warning>`. */
  warning?: string;
  /**
   * Id of an anchor/workspace the attach implicitly created beside the target
   * (e.g. Herdr creates a repo workspace when opening a worktree of a repo it
   * never saw). Callers persist it so detach can tear it down again.
   */
  autoWorkspaceId?: string;
}

export interface AdeAdapter {
  readonly id: string;
  readonly label: string;
  /** Binary present AND the app/runtime actually reachable — false means "skip silently". */
  isAvailable(): boolean;
  /** Register/attach an existing checkout so it appears in the ADE. Throws on hard failure. */
  attach(ctx: AdeContext): AdeSyncResult;
  /** Best-effort cleanup on teardown; omit when the ADE tracks nothing per-worktree. */
  detach?(ctx: AdeContext): AdeSyncResult | null;
}

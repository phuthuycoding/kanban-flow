---
feature: ade-sync
context: worktree
created: 20261014_2059
kind: feature
status: archived
---
# Spec Requirement

## Feature
ade-sync

## Objective
When `kf` creates a worktree, detect the agentic development environments (ADEs) present on the machine and register/attach the worktree into each reachable one, so the worktree shows up in whichever ADE the user is working in — via a pluggable adapter registry that makes adding a new ADE a one-file change.

## Problem Statement
`kf` worktrees are plain `git worktree` checkouts registered in `.works` metadata and the proxy routes file. ADE apps the user actually lives in (Orca, Herdr) do not know a kf worktree exists: Orca only shows them when the repo is registered and external-worktree visibility is on; Herdr discovers git worktrees but the user must open them by hand. The user wants `kf worktree create` (and the automatic create on stage → implementation) to push the worktree into every detected ADE automatically, with a design where adding the next ADE is trivial.

## Scope
### In Scope
- Adapter registry for ADEs (`AdeAdapter` interface + `ADE_ADAPTERS` list), mirroring the existing `AgentAdapter`/`AGENTS` pattern in `src/integrations/`.
- Detection of ADE availability at create time (binary present + app/runtime API reachable); unavailable ADEs are skipped silently.
- Attach/sync of the just-created worktree into each reachable adapter — `kf worktree create` and the stage → implementation auto-create.
- Orca adapter: `orca repo add --path <root>` (idempotent repo registration), then verify the worktree appears in `orca worktree list`; when the repo's external-worktree visibility hides it, report a warning telling the user to enable it (no CLI setter exists — verified).
- Herdr adapter: `herdr worktree open --cwd <repo> --path <wt> --label <feature>` (idempotent via `already_open`; `--path`/`--branch` are mutually exclusive, `--cwd` selects the repo context), so the worktree becomes a Herdr workspace — focused on create, `--no-focus` on sync.
- Detach on teardown (`worktree remove`, `cancel`, `archive`): best-effort — Herdr closes the workspace bound to the path; Orca needs nothing.
- `kf worktree sync [feature]` — manual re-sync: inside a linked worktree it syncs the worktree being stood in (including ADE-created ones); with a feature name it syncs that item's worktree; from the main checkout with no argument it syncs every linked worktree of the repo (registered or foreign).
- Sync failures are warnings, never fatal: a failed ADE call cannot fail worktree creation or removal.
- Machine-level opt-out in `~/.config/kanban-flow/config.json` (never committed — per-machine preference).

### Out of Scope
- Delegating checkout creation to an ADE (e.g. `orca worktree create`) — kf keeps owning path/branch/domain conventions; verified Orca's create cannot adopt kf's paths.
- `kf worktree sync` does NOT adopt foreign worktrees into `.works` — no domain/route/feature binding for ADE-created checkouts (a future "adopt" feature could own that).
- Spawning agents/terminals inside the worktree in any ADE.
- A per-ADE UI or `kf worktree list` status column (could follow later).
- Herdr "trust repository" auto-grant — if `worktree open` fails on trust, surface it as a warning instead of silently widening trust.

## Affected surfaces
- `kf worktree create` stdout — new per-ADE sync lines/warnings; default branch prefix changes from `kf/` to `<git-user>/` when a git name resolves.
- `kf worktree sync` — new subcommand in `kf worktree` usage/stdout.
- `kf worktree remove` / `kf cancel` / `kf archive` warnings — ADE detach failures surface alongside existing warnings.
- `kf stage` transition output into implementation — auto-created worktrees report ADE sync.
- Machine config `~/.config/kanban-flow/config.json` — new `adeSync` field (documented default).
- README worktree section + CHANGELOG.
- `docs/` user-facing worktree docs if they describe lifecycle steps.

## Actors
- Developer running `kf` CLI on a workstation with zero or more ADEs installed.
- ADE apps (Orca, Herdr, future) that expose a CLI/socket API.

## Functional Requirements
### FR-001
- Requirement: After a worktree is successfully created (both `kf worktree create` and the stage → implementation auto-create), kf iterates a registry of ADE adapters; each adapter reports whether its app is present and reachable, and reachable adapters attach the worktree so it appears in that ADE.
- Priority: must
- Notes: Verified live — Herdr `worktree open` attaches external checkouts; Orca needs `repo add` + external-worktree visibility.

### FR-002
- Requirement: The integration is an adapter registry — a shared `AdeAdapter` interface (`id`, `detect`, `attach`, `detach`), one file per ADE, and a single exported list; adding a new ADE means adding one adapter file and one registry entry, no changes to lifecycle code.
- Priority: must
- Notes: Mirrors `AGENTS: AgentAdapter[]` in src/integrations/agents.ts — house pattern for tool integrations.

### FR-003
- Requirement: Herdr adapter — detect via `herdr` binary + running server (`herdr status`); attach via `herdr worktree open --cwd <root> --path <wt.path> --label <feature>` with `--focus` on create paths and `--no-focus` on `sync` (`--path` and `--branch` are mutually exclusive selectors; `--cwd` names the repo Herdr resolves the path in); treat `already_open: true` as success (idempotent re-create).
- Priority: must
- Notes: Verified on live server v0.9.3: open returns `type: worktree_opened`, workspaces get `open_workspace_id`.

### FR-004
- Requirement: Orca adapter — detect via `orca status --json` with a reachable runtime (never trust bare binary presence — on Linux `orca` can be the GNOME screen reader); attach = `orca repo add --path <root> --json` (idempotent) followed by checking the worktree appears in `orca worktree list --repo path:<root> --json`; when it does not, warn that the repo's external-worktree visibility is off in Orca and name the setting.
- Priority: must
- Notes: Verified — repos with visibility "show" list external worktrees (incl. kf's own); no CLI setter exists, so a warning is the honest ceiling.

### FR-005
- Requirement: On worktree teardown (`kf worktree remove`, `kf cancel`, `kf archive`), each adapter gets a best-effort detach: Herdr closes the workspace bound to the worktree path (`worktree list` → `open_workspace_id` → `workspace close`); Orca detaches nothing. Detach failures join the existing `TeardownResult.warnings`.
- Priority: should
- Notes: Prevents stale ADE workspaces pointing at deleted paths.

### FR-006
- Requirement: ADE sync is side-effect-only: any adapter error (binary missing mid-run, timeout, non-zero exit, unparsable output) is caught, recorded, and surfaced as a warning line — worktree create/remove exit codes and rollback behavior are unchanged.
- Priority: must
- Notes: Same contract as `worktree-remove` hook failures, which are warnings.

### FR-007
- Requirement: Machine config gains `adeSync` (boolean, default `true`) in `~/.config/kanban-flow/config.json`; `false` disables detection+attach+detach everywhere without touching project config.
- Priority: should
- Notes: Machine-scoped because ADE installs are per-machine; the committed `.kf/config.json` stays free of personal preferences.

### FR-008
- Requirement: Worktree branch prefix resolves by priority: (1) explicit `worktree.branchPrefix` in `.kf/config.json`; (2) `worktree.gitconfigName` (string) in `.kf/config.json`, slugified → `<name>/`; (3) `git config user.name`, slugified → `<name>/`; (4) `"kf/"`. The resolved prefix applies to `worktreeBranch` and to orphan detection (`unmanaged-worktree`) alike.
- Priority: must
- Notes: Aligns kf branch naming with ADE conventions (e.g. Orca's `phuthuycoding/<name>`); existing `kf/...` worktrees keep working because registrations store the branch literally.

### FR-009
- Requirement: `kf worktree sync` broadcasts worktrees to all reachable ADEs on demand — from inside a linked worktree it syncs that worktree (feature-bound or foreign, labelled by feature name else branch/dir name); `kf worktree sync <feature>` syncs one registered worktree from any cwd; bare `sync` at the main checkout syncs every linked worktree (`git worktree list` minus the main checkout; registered keep feature labels, foreign get branch/dir labels). Idempotent; unreachable ADEs are skipped; failures are warnings.
- Priority: must
- Notes: The catch-up path for ADEs that were off at create time, and the "sync it right where I stand" flow for ADE-created worktrees. `findWorksRoot` already resolves the main root from inside linked worktrees via git-common-dir.

## Non-Functional Requirements
- Detection+attach must be bounded: every adapter call runs with a timeout (~10s); adapters run in sequence and total added latency stays under ~15s worst case.
- No secrets in logs; adapter stderr is truncated to a few lines in warnings.
- All subprocess calls use argv arrays (no shell interpolation) — worktree paths with spaces stay safe.

## Main Use Cases
- UC-001 Create a worktree with Orca + Herdr running — worktree appears as a Herdr workspace and is registered/visible in Orca.
- UC-002 Create a worktree with no ADE reachable — output identical to today, no extra lines.
- UC-003 Create succeeds while one adapter fails — creation succeeds, a warning names the ADE and the failure.
- UC-004 Remove a worktree — Herdr workspace for the path is closed; nothing dangles.
- UC-005 Add a third ADE — implement `AdeAdapter` in one file and register it; no lifecycle edits.
- UC-006 `kf worktree sync` — inside an ADE-created worktree, broadcast it to every reachable ADE; from the root, resync registered worktrees.

## Constraints
- kf keeps owning git state: `git worktree add/remove`, branch naming, domain routing, port allocation and hooks are unchanged; adapters only mirror the result into external apps.
- macOS is the verified environment; adapter detection must be defensive on other platforms (e.g. Linux `orca` name clash).

## Assumptions
- The user's accepted semantic is "whichever ADE I use, the worktree shows up" — attach/sync model, not ADE-owned creation.
- `orca` CLI talks to the running Orca runtime without extra auth on this machine.
- Herdr's `worktree open` is the supported way to surface an existing git worktree as a workspace.

## Acceptance Criteria
- [ ] `kf worktree create <f>` with Herdr running opens a Herdr workspace labelled with the feature name, and repeated creates report already-open instead of duplicating.
- [ ] `kf worktree create <f>` with Orca running registers the repo (idempotent) and either confirms the worktree is listed in Orca or prints the visibility warning.
- [ ] `kf worktree create <f>` with no ADE binary/reachable app succeeds with the same output contract as today.
- [ ] An adapter whose CLI exits non-zero produces a `⚠` warning while the create still exits 0.
- [ ] `kf worktree remove <f>` closes the bound Herdr workspace; archive/cancel paths do the same via the shared detach.
- [ ] A new adapter can be added by creating one file and appending to the registry — verified by a test exercising a fake adapter through the full create path.
- [ ] `adeSync: false` in machine config disables all adapter calls.
- [ ] With `git config user.name` = `phuthuycoding` and no prefix options, a new worktree's branch is `phuthuycoding/<feature>`; with `worktree.gitconfigName` set, that value wins; with `worktree.branchPrefix` set, the explicit prefix wins; with neither git name nor options, the branch stays `kf/<feature>`.
- [ ] `kf worktree sync` inside a worktree created outside kf attaches it to every reachable ADE (label from branch/dir name) and does not write `.works` metadata.
- [ ] `kf worktree sync <feature>` re-attaches the feature's registered worktree; bare `sync` at the repo root covers all registered worktrees.

## Edge Cases
- Worktree already exists (idempotent ensureWorktree reuse path) — adapters must still attach, since a prior sync may have been lost.
- ADE CLI hangs or times out → bounded by timeout, reported as warning.
- `orca` resolves to the GNOME screen reader on Linux → detection fails closed, no sync attempted.
- Two features created in sequence → each attaches independently; port/route logic unaffected.
- Detach when the worktree path was deleted manually → adapters no-op cleanly (workspace list no longer matches).
- Project repo not yet a git repo / `worktree.enabled: false` → no ADE calls at all.
- `git config user.name` with spaces/uppercase (e.g. `Phu Thuy`) → slugified `phu-thuy/`; empty or unset → fallback chain continues.
- Orphan detection on repos that mixed old `kf/` branches with new `<user>/` branches — both prefixes' leftovers must still be reported (prefix change must not hide old orphans).

## Open Questions
- Should `adeSync` also support a per-ADE list (`adeSync: { orca: false }`) later? v1 ships the boolean only.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A — CLI feature, no UI surface of its own.
- Tools: vitest; fake CLI subprocess pattern already in `src/tests/helpers/fake-cli.ts`; worktree fixtures in `src/tests/worktree.test.ts` / `worktree-setup.test.ts`.
- Coverage Target: 80%

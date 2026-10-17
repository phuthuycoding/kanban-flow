---
feature: ship-pipeline
context: cli
created: 20261017_1739
kind: feature
status: archived
---
# Spec Requirement

## Feature
ship-pipeline

## Objective
Close the gap between a PASS review and `dones`: today nothing in `kf` guides or automates publishing the PR, waiting for merge, cutting a release and updating the changelog — archive only *checks* that it happened. Add an optional `shipping` stage plus a resumable `kf ship` command so the last mile is a first-class, per-step-disableable pipeline.

## Problem Statement
After `kf stage <f> review` PASSes, the work item enters an uninstrumented zone: push branch, open PR, link it, wait for CI/reviewer merge, tag a release, update the changelog — all manual, all invisible to `kf status` and the project board. `kf archive` refuses while a recorded PR is unmerged, yet no step in the pipeline ever creates that PR. Users get an enforced gate with no guided way to satisfy it.

## Scope
### In Scope
- New stage `shipping` between `review` and `dones`, wired through schema (STAGES, TRANSITIONS, STAGE_GATES, STAGE_INDEX, PHASE_NAMES), `.works/` scaffolding, `statusMap`, stage hooks, status/dashboard output.
- `kf stage <f> shipping` allowed only from `review` holding a current PASS report; `review → dones` stays open for non-code items.
- `.kf/config.json` `ship` block: `enabled` (default `false` — absent block means today's behaviour), `merge` (`"manual"` | `"auto"`, default `"manual"`), `release` (bool), `changelog` (bool), with strict validation.
- `kf ship <feature>`: resumable pipeline — publish (push + `gh pr create` + `issues link --pr`) → merge check → release → changelog; each step skipped when its flag is off or already recorded done.
- `kanban-ship` skill: the ship ritual + the third human gate ("ship now?" after review PASS); review skill hands off to it.
- `shipping.sh` seed in the github-hooks pack + `KFW_PROJECT_STATUS_SHIPPING` env.
- `kf sync` sweeps `shipping` items whose recorded PR merged.

### Out of Scope
- `merge: "immediate"` — kf never merges a PR itself; `auto` only schedules `gh pr merge --auto` (GitHub still enforces CI/review).
- Release-as-work-item (batched multi-feature releases) — ship covers one item = one tag.
- Custom deploy logic — delegated to the `shipping.sh` project hook, kf builds in only tag + `gh release create`.
- Auto-detection of "this item has no code" — the human/agent picks the archive-direct path at the ship gate.
- Command-tree/git-flow verb naming for `kf ship` — owned by the `command-tree` feature; this feature ships the flat `kf ship`.

## Affected surfaces
- CLI surface: new `ship` command in help/args/dispatch; `stage`, `archive`, `sync`, `status`, `view`, `doctor`, `init` outputs.
- `.kf/config.json` schema: new `ship` block, new `statusMap.shipping` key.
- Skills: new `kanban-ship`; edits to `kanban-review`, `kanban-archive`, `kanban-flow` phase table.
- `kanban-flow/github-hooks/` seed pack: new `shipping.sh`.
- `README.md`, `CHANGELOG.md`, `docs/requirement/cli/`, `docs/use-cases/cli/`.

## Actors
- Human — approves shipping at the third gate; performs manual merge/release steps when flags are off.
- Agent — runs `kf ship`, interprets per-step results.
- GitHub (`gh` CLI) — PR creation, merge state, releases.

## Functional Requirements
### FR-001
- Requirement: `STAGES` gains `shipping` between `review` and `dones`; `init` scaffolds `.works/shipping/`; `doctor`/`doctor --fix` treats a missing `shipping` dir like any missing stage dir; `status`, `view`, `dashboard` and `statusMap`/hook env recognize the stage.
- Priority: must
- Notes: STAGE_INDEX ordering matters — `shipping` sits at index 6, `dones` at 7; `dueFromStage` semantics must not leak plan/test/review artifacts onto it.

### FR-002
- Requirement: `kf stage <f> shipping` is allowed only from `review` when the current execution's review report is PASS; from any other stage, or with a non-PASS/stale report, the move is refused. `review → dones` remains allowed (non-code items never enter shipping). `shipping → dones` is reachable only via `kf archive`.
- Priority: must
- Notes: reuses the existing directional-gate mechanism in `direction.ts`; no new gate type.

### FR-003
- Requirement: `kf archive` accepts an item in `shipping` or `review`; the recorded-PR-unmerged refusal and human-confirm path are unchanged. Items without `meta.pr` archive exactly as today.
- Priority: must

### FR-004
- Requirement: `readProjectConfig` parses `ship` — `{ enabled?: boolean (default false), merge?: "manual"|"auto" (default "manual"), release?: boolean (default false), changelog?: boolean (default false) }` — with per-field type/enum errors naming the file, consistent with existing config validation.
- Priority: must
- Notes: absent `ship` block must reproduce current end-to-end behaviour byte-for-byte.

### FR-005
- Requirement: `kf ship <feature>` publish step: determines the item's branch (registered worktree branch, else current checkout branch), pushes it, runs `gh pr create` (title/body derived from the spec/plan artifacts), records the PR URL into `meta.pr` (same field `archive` reads). If `meta.pr` already exists, publish is skipped.
- Priority: must

### FR-006
- Requirement: merge step reads PR state via `gh`; under `merge: "manual"` it reports "waiting for merge" and exits 0; under `merge: "auto"` it runs `gh pr merge --auto` once and reports scheduled. Ship is re-runnable and resumes at the first unfinished step.
- Priority: must

### FR-007
- Requirement: once the recorded PR is merged, `release: true` creates a tag + `gh release create` with notes generated from the item's spec/report artifacts; `changelog: true` appends an entry to `CHANGELOG.md` following the file's existing format. Both steps record completion in `.kfw.json` so re-runs skip them.
- Priority: must

### FR-008
- Requirement: per-run overrides — `kf ship --no-release`, `--no-changelog`, `--draft` (publish as draft PR) — override config for that run only.
- Priority: should

### FR-009
- Requirement: `kanban-ship` skill is added to the package skills and `MANAGED_SKILLS`; it documents the ship ritual and the third human gate (review PASS → "ship now or archive directly?"); `kanban-review` hands PASS items off to it; `kanban-flow`'s phase table lists it.
- Priority: must

### FR-010
- Requirement: `shipping.sh` is added to the github-hooks seed pack and stage-hook resolution; `KFW_PROJECT_STATUS_SHIPPING` is exported to hooks when `statusMap.shipping` is set.
- Priority: should

### FR-011
- Requirement: `kf sync` also sweeps items in `shipping` whose recorded PR has merged (archive path unchanged).
- Priority: must

## Non-Functional Requirements
- No behaviour change when `ship` is absent/disabled (backward compatibility is a hard gate).
- No token/credential logging; `gh` stderr is surfaced verbatim on failure, never swallowed.
- `gh pr merge --auto` requires repo allow-auto-merge; its absence is a clean, explained refusal — not an error crash.
- Ship steps are idempotent: killing `kf ship` mid-pipeline and re-running converges to the same state.

## Main Use Cases
- UC-001 Move a PASS-reviewed item into `shipping`
- UC-002 `kf ship` publishes branch + PR and records `meta.pr`
- UC-003 `kf ship` under manual merge reports waiting, then resumes after the human merges
- UC-004 `kf ship` creates release + changelog once merge is detected
- UC-005 Archive a shipped item (`shipping → dones`)
- UC-006 Archive a non-code item directly from `review`
- UC-007 Project without `ship` config runs the unchanged pipeline

## Constraints
- `gh` CLI availability is required only for ship steps that call it; absence is an explained refusal, not a crash.
- Worktree-enabled items publish the worktree branch; worktree-off items publish the current branch — ship must not assume a `kf/` branch exists.

## Assumptions
- One PR per work item; multi-PR flows stay manual.
- `meta.pr` stays the single source of truth for "which PR ships this item" (the field `archive` already reads).
- Release = git tag + `gh release create`; npm publish/deploy belongs to the project hook.
- Non-code items are routed to direct archive by the ship-gate question, not by auto-detection.

## Acceptance Criteria
- [ ] `kf stage <f> shipping` from `review` with PASS report moves the item; without PASS or from other stages it refuses with a clear message.
- [ ] `kf archive` succeeds from `shipping` and from `review`; an unmerged recorded PR still refuses in both.
- [ ] `kf ship` on an item with no `meta.pr` creates the PR and records it; a second run does not recreate it.
- [ ] With `merge: "manual"`, `kf ship` exits reporting "waiting for merge"; after `gh`-observed merge, the next run performs release/changelog per config.
- [ ] With `release: false`/`changelog: false` (or `--no-*`), those steps are skipped and recorded.
- [ ] A project with no `ship` block shows identical pipeline behaviour to before this feature.
- [ ] `kf status --all`, `kf view`, dashboard and hook env expose `shipping`.
- [ ] `kanban-ship` installs via `kf install` and `doctor` recognises it.

## Edge Cases
- `kf ship` run twice / killed mid-step → resumes, no duplicate PR/tag/changelog entry.
- `gh` missing or PR creation fails → error surfaced, `meta.pr` untouched, retry works.
- Item in `shipping` whose PR was closed unmerged → ship reports the state honestly; archive still refuses.
- `worktree.enabled: false` project → publish uses current branch, never assumes `.worktrees/`.
- `auto` merge on a repo without allow-auto-merge → explained refusal, item stays in `shipping`.
- Changelog file absent → create with a standard header rather than crash.

## Open Questions
- Default `statusMap` suggestion for `shipping` when seeding the hooks pack (`Shipping` vs reusing `In review`).
- Whether `kf ship` on TTY should interactively confirm each enabled step, or run non-interactively by default and honour `--yes`/flags only.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`src/tests`), stubbed `gh` binary on PATH like the existing github/ade test doubles
- Coverage Target: 80%

---
feature: github-sync-hooks
context: cli
created: 20261010_1217
kind: feature
status: archived
---
# Spec Requirement

## Feature
github-sync-hooks

## Objective
Make the GitHub sync that monitoring hand-built a standard, opt-in part of `kf init`: a generic hook pack driven by `.kf/config.json` (`repository` + a new `project` block) with zero per-project hardcoding.

## Problem Statement
The monitoring project mirrors every work item to a GitHub issue and a GitHub Projects board — issue created on `kf new`, spec synced into the body at planning, stage moves updating the board Status, issues closed/reopened/assigned at transitions, and an acceptance-criteria gate at archive. That behaviour is real and working, but it lives entirely in hand-written `.kf/hooks/` with the repo name and Project field IDs hardcoded. Every other project wanting the same flow must copy and edit ~300 lines of bash.

## Scope
### In Scope
- A `project` block in `.kf/config.json`: `owner`, `number`, `statusMap` (stage → Status option name), `acGate` (default true). Option names, not IDs — `gh project field-list` resolves them at run time so a recreated board still works.
- `KFW_PROJECT_OWNER`, `KFW_PROJECT_NUMBER`, `KFW_PROJECT_STATUS_<STAGE>`, `KFW_PROJECT_AC_GATE` added to the hook environment.
- `kf issues sync <feature>` — new subcommand rewriting the linked issue's body from the filled requirement file (frontmatter stripped, kf footer appended).
- A generic hook pack under `kanban-flow/hooks/` (`lib-github.sh` + the stage hooks) shipped in the npm package's `files`.
- `kf init` asks "Install GitHub sync hooks?" when a repository is configured/detected; answering yes copies the pack into `.kf/hooks/` like the existing template/rule seeding.
- `kf doctor --fix` refreshes pack files that came from the package (missing or package-different), and `kf doctor` warns when `project` is set but `gh` lacks the `project` scope.

### Out of Scope
- Sync logic inside kf core — stays in hooks, which already carry the fail-open semantics.
- `sync-project.sh` bulk reconciler — remains a project-level tool.
- GitHub Project field types other than the Status single-select.

## Actors
- Maintainer onboarding a project that mirrors work items to GitHub.
- Agent running `kf stage`/`kf archive` — must not be blocked by GitHub being down.

## Functional Requirements
### FR-001
- Requirement: `.kf/config.json` accepts `project: {owner, number, statusMap, acGate}`; `readProjectConfig` validates owner/number and that statusMap keys are stage names.
- Priority: high
- Notes: `statusMap` values are option names looked up live, never IDs.

### FR-002
- Requirement: `runHook` exports `KFW_PROJECT_*` populated from the config block (empty when absent), alongside the existing `KFW_REPOSITORY`.
- Priority: high

### FR-003
- Requirement: `kf issues sync <feature>` replaces the linked issue body with the work item's filled requirement (frontmatter stripped + kf footer); refuses without a link or an unfilled spec.
- Priority: high
- Notes: becomes the primitive the planning hook calls.

### FR-004
- Requirement: package ships `kanban-flow/hooks/`: `lib-github.sh` plus `brainstorm.sh` (issue create via `kf issues create`), `planning.sh` (`kf issues sync` + status), `implementation.sh` (reopen + assign + status), `testing.sh`/`review.sh`/`backlog.sh` (status), `cancelled.sh` (close not-planned), `dones.sh` (AC gate when `acGate` + status — issue close moved to the `delivered` event, see `delivered.sh`), `delivered.sh` (issue close + statusMap.delivered, run by `kf issues done`). All fail-open on gh errors; hooks no-op when `KFW_REPOSITORY` is empty.
- Priority: high
- Notes: ported from monitoring's lib-project.sh with hardcodes replaced by `KFW_*` env and option names resolved via `gh project field-list` cached per process.

### FR-005
- Requirement: `kf init` (TTY Customize) asks "Install GitHub sync hooks?" — offered only when a repository is configured/detected; yes copies the pack into `.kf/hooks/`. `kf doctor --fix` reinstalls missing or package-divergent pack files, and `kf doctor` warns when `project` is configured but `gh` lacks the `project` scope.
- Priority: medium

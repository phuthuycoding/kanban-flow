---
feature: "worktree-opt-out"
context: "worktree"
created: "20261017_1739"
kind: feature
status: confirmed
---

# Spec Requirement

## Feature
worktree-opt-out

## Objective
Make the worktree subsystem opt-in: `worktree.enabled` defaults to `false`, so a fresh `kf init` never pulls in worktree/dnsmasq/proxy behaviour unless the project asks for it.

## Problem Statement
`worktree.enabled` currently defaults to `true`: every project gets an auto-created git worktree + `.test` domain expectation on entering implementation, and `doctor` nudges toward `sudo kf worktree setup` — a heavy machine onboarding (dnsmasq, launchd proxy daemon) that most users never wanted. The subsystem is useful but should be a conscious opt-in, not silent default.

## Scope
### In Scope
- Flip the default: absent `worktree.enabled` ⇒ `false` (`worktreeConfig` in `src/worktree/config.ts`).
- `doctor` only probes domain infra when worktree is enabled; the `sudo kf worktree setup` suggestion never appears for opted-out projects.
- Help/docs text: `kf worktree` and `init` describe the subsystem as opt-in; `stage.ts`'s failure message stays coherent (only reachable when enabled).
- Skill text (`kanban-implement`, `kanban-test`, `kanban-review`) updated: worktree provisioning happens when the project opted in, not "by default".
- Tests covering the flipped default + explicit `enabled: true`/`false` configs.

### Out of Scope
- Removing the subsystem or any command (`kf worktree`, `kf proxy` stay fully functional when enabled).
- Machine config (`~/.config/kanban-flow`) changes — already machine-local.
- Migrating/uninstalling existing worktrees — items with a recorded worktree keep tearing down normally on archive/cancel regardless of the flag.
- ADE sync flag (`adeSync`) semantics — unchanged.

## Affected surfaces
- `src/worktree/config.ts` default.
- `doctor`, `init`, `stage`, `worktree` help output.
- `skills/kanban-implement|test|review/SKILL.md` paragraphs.
- `README.md`, `CHANGELOG.md`, `docs/requirement/worktree/`.

## Actors
- Project owner — opts in via `.kf/config.json`.
- Agent — relies on skill text describing when a worktree exists.

## Functional Requirements
### FR-001
- Requirement: `worktreeConfig` resolves `enabled` to `raw?.enabled ?? false`; explicit `true`/`false` in config is honoured exactly as before.
- Priority: must

### FR-002
- Requirement: entering `implementation` with worktree disabled (default) never attempts provisioning and prints no worktree note; with `enabled: true` behaviour is byte-for-byte today's.
- Priority: must

### FR-003
- Requirement: `kf doctor` skips the domain-infra probe and its `sudo kf worktree setup` repair suggestion when worktree is disabled; `--fix` never "repairs" a healthy opt-out state.
- Priority: must

### FR-004
- Requirement: `kf worktree` command, `kf proxy serve` and `kf worktree setup` remain usable regardless of the flag (explicit operator commands, not gated by project config).
- Priority: must
- Notes: the flag governs *automatic* provisioning/teardown guidance, not operator access to the commands.

### FR-005
- Requirement: help strings and skill docs describe worktree as opt-in ("set `worktree.enabled: true`"), including the `init` onboarding question/`.gitignore` text where it mentions worktrees.
- Priority: should

## Non-Functional Requirements
- Existing projects with explicit `enabled: true` see zero change.
- Existing projects with explicit `enabled: false` or the flag absent previously… behaviour changes only for absent-and-previously-enabled users: provisioning stops. This is the intended change and goes in CHANGELOG.
- Items that already hold `meta.worktree` still tear down on archive/cancel (no orphaned worktrees created by the flag flip).

## Main Use Cases
- UC-001 Fresh `kf init` + `kf stage → implementation` with no config → no worktree created
- UC-002 `worktree.enabled: true` project provisions exactly as today
- UC-003 `kf doctor` on an opted-out project stays silent about domain infra
- UC-004 Item with a legacy recorded worktree archives and tears down cleanly under default-off

## Constraints
- One-line semantic change in `config.ts`; the rest is gating/text, no refactor of `src/worktree/*`.

## Assumptions
- `.gitignore` seeding keeps `.worktrees/` (harmless when unused; removing it would break opted-in projects created earlier).
- "Opt-in" wording replaces "(default)" phrasing in skill text.

## Acceptance Criteria
- [ ] No `worktree` block in config → `stage → implementation` creates nothing, meta has no `worktree` field.
- [ ] `enabled: true` → identical provisioning to before.
- [ ] `doctor` on a default project reports no worktree-infra finding; on `enabled: true` + missing infra it still suggests setup.
- [ ] `kf worktree create/list/remove/setup` all function under default-off.
- [ ] Archive/cancel of an item carrying `meta.worktree` still tears it down under default-off.
- [ ] `npm test` green with updated expectations.

## Edge Cases
- Mid-flight items with a recorded worktree at upgrade time — teardown path must not consult `enabled`.
- `enabled: true` + failing setup → the stage failure message still points at the flag (now phrased as "set `worktree.enabled: false` to skip").

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`src/tests` — config default test, stage behaviour test, doctor test)
- Coverage Target: 80%

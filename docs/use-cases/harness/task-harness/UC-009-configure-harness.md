---
feature: task-harness
context: harness
created: 20261024_1110
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-009 |
| Name | Configure verify commands, limits and the drive-stop hook |
| Requirement reference | FR-006, FR-009, FR-011, FR-015, FR-016, FR-018 |
| Goal | The owner pins the commands kf executes, the concurrency and retry limits, and an optional stop notification in files only a human edits, and gets early, specific feedback when the setup is incomplete or unsafe. |
| Primary actor | Owner / operator |

## Supporting Actors
- kf CLI: validates config and runs `kf validate`, `kf doctor`, `kf drive`.
- kf driver: reads the limits and runs verify commands and the hook.
- `kanban-flow` skill: asks the human to enable worktrees at the start-now/backlog decision.

## Preconditions
- The project has `.kf/config.json` with a `harness` section (roles, runners, stages), created by `kf init` or by hand.
- The owner can edit `.kf/config.json` and `.kf/hooks/`; agents do not edit these as part of a task.

## Trigger
The owner wants a project to support `kf drive`: edits `harness.verify` and optional limits in `.kf/config.json`, adds `.kf/hooks/drive-stop.sh`, and runs `kf harness`, `kf validate`, `kf doctor` or `kf drive`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner / operator | Sets `harness.verify.task` and `harness.verify.stage` as arrays of argv arrays, for example `[["npm","run","typecheck"],["npm","test"]]`. | Commands are pinned in a human-owned file. |
| 2 | Owner / operator | Optionally sets `harness.parallel`, `harness.retries`, `harness.maxLoops` and `harness.budget.maxRuns`. | Unset limits use defaults 3, 1, 2 and 30. |
| 3 | kf CLI | Validates the harness section when config is read (including `kf harness`, and re-init which preserves these fields). | Valid config is accepted; `kf harness` shows verify, limits and effective defaults. |
| 4 | Owner / operator | Optionally adds `.kf/hooks/drive-stop.sh` (executable) to be notified when a drive ends; the event is documented in `docs/workflow/autoconfig.md`. | The hook is opt-in: `kf init` does not seed it into `.kf/hooks/`; once present it is picked up by the existing hook mechanism. |
| 5 | Owner / operator | Runs `kf doctor`. | Doctor reports harness findings or none. |
| 6 | Owner / operator | Runs `kf drive <feature>` on an approved item in `implementation`. | With `verify.stage` set, `worktree.enabled: true`, a current approval and no live drive, the drive starts using these settings. |
| 7 | kf driver | When it stops (`ready` at the ship gate, or any stop code), runs `.kf/hooks/drive-stop.sh` when present, with the standard hook environment plus `KFW_DRIVE_RESULT` (`ready` or `stopped`) and `KFW_DRIVE_REASON`. | The owner is notified; a hook failure is a warning and does not change the drive result. |

## Alternative Flows
### A1
- Trigger: `harness.verify.task` is empty or unset but `verify.stage` is set.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf accepts the config; with `verify.task` unset there is nothing to run per task and that step passes (`verify.stage` remains required for `kf drive`). | Tasks are checked by the allowlist and stage verify only; return to main flow step 5. |

### A2
- Trigger: A planning or backlog item exists, `harness.verify.stage` is set and `worktree.enabled` is not `true`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf validate` on the item reports the WARNING `task_harness_needs_worktree`: the task harness cannot start until worktrees are enabled. | The owner enables `worktree.enabled: true` before the start decision; return to main flow step 6. |
| A2.2 | The `kanban-flow` skill checks the same setting at the start-now/backlog decision and asks the owner to enable worktrees. | The human learns before starting a drive, not after. |

### A3
- Trigger: At least one stage is assigned in `harness.stages` and `harness.verify.stage` is not set.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | `kf doctor` reports a WARNING that `harness.verify.stage` is missing and that `kf drive` refuses to start without it. | Manual flow (`kf run`, `kf validate`) keeps working unchanged; no WARNING for A2 is emitted because `verify.stage` is unset. |
| A3.2 | With `harness.stages` empty (no stage assigned) the doctor reports no verify WARNING. | Projects that do not use stage roles are not nagged. |

### A4
- Trigger: Doctor finds stale task worktrees or locks with no live holder.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | `kf doctor` reports a WARNING with the exact cleanup command for each. | Owner runs the command; the next `kf doctor` is clean. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `harness.verify.task` or `.stage` is not an array of non-empty argv arrays: a non-array value such as `"npm test"`, an empty argv `[[]]`, an empty string element `[[""]]`, an argv whose first element starts with `-` (`[["-rf"]]`), or any element containing `{` ... `}` placeholder syntax (`[["npm","{x}"]]`) | Validation rejects the config; no shell parsing is attempted. | Validation error naming the field and the expected argv shape. |
| A `harness.parallel`, `retries`, `maxLoops` or `budget.maxRuns` value that is not a valid integer in range (parallel and maxRuns at least 1, retries and maxLoops at least 0) | Validation rejects the value. | Validation error naming the field and the allowed range. |
| `kf drive` with `harness.verify.stage` missing or empty | The driver refuses before changing anything. | Exit 1, message naming `harness.verify.stage` in `.kf/config.json` as the setting to add. |
| `kf drive` with `worktree.enabled` not `true` | Refuses before doing anything. | Exit 1 naming `worktree.enabled`. |
| A verify command is not found on PATH | The verify fails; kf does not crash. | For `verify.task`: task `failed` with the "not found" message; retry rules apply as in UC-005. For `verify.stage`: the drive stops with code `verify_failed`. |
| A report, plan or worker output contains a command line | kf ignores it; only `harness.verify` is ever executed. | No execution; nothing to configure. |
| `drive-stop.sh` exits non-zero or is missing its executable bit | Hook failure is a warning only. | Warning printed and logged; the drive result stays `ready` or `stopped`. |
| A planned task of an open item uses a role that is no longer in `harness.roles` (checked when at least one stage is assigned) | `kf doctor` reports an ERROR naming the item and the task (and `kf validate` reports the unknown role per UC-001). | Owner restores the role or edits the plan and re-approves. |

## Postconditions
- `.kf/config.json` holds valid `harness.verify` and limits; effective defaults are 3 (parallel), 1 (retries), 2 (maxLoops) and 30 (budget.maxRuns) when unset.
- `kf drive` starts only for a project with `verify.stage`, `worktree.enabled: true`, an item in `implementation` with a current approval and no live drive.
- Every drive stop invoked `drive-stop.sh`, when present, with `KFW_DRIVE_RESULT` and `KFW_DRIVE_REASON`; the hook is not created by `kf init`.
- Doctor and validate output tells the owner exactly which setting to fix.
- Re-running `kf init` does not drop the harness verify and limit fields.

## Business Rules
- Verification commands come only from `harness.verify` in `.kf/config.json`, each as an argv array run without a shell; kf never executes a command read from an artifact, a report or worker output.
- Editing `.kf/config.json` is a human action; the driver stops with code `config_changed` if `harness.roles`, `harness.runners`, `harness.verify` or `worktree.enabled` change while a drive runs (see UC-007).
- `harness.verify.task` unset means there is nothing to run per task (passes); `harness.verify.stage` is required for `kf drive`.
- Validation (FR-009) rejects, naming the field: a non-array value, an empty argv, an empty string element, an argv whose first element starts with `-`, and any element containing `{` ... `}` placeholder syntax.
- `harness.parallel` defaults to 3, `harness.retries` to 1, `harness.maxLoops` to 2 and `harness.budget.maxRuns` to 30; all are configurable.
- `harness.budget.maxRuns` caps worker runs per drive, counting retries and repair runs; there is no USD cap.
- `drive-stop.sh` is optional and opt-in: documented in `docs/workflow/autoconfig.md`, not seeded into `.kf/hooks/`; its failure is a warning and never turns a `ready` drive into a failure.
- `kf validate` raises the worktree WARNING only for `planning` and `backlog` items when `verify.stage` is set; it is a WARNING, not an ERROR.
- `kf doctor` reports, only when at least one stage is assigned in `harness.stages`: missing `harness.verify.stage` WARNING; a role used by a planned task of an open item that no longer exists ERROR (naming item and task); task worktrees with no live drive or run, and lock files whose pid is dead, WARNING each with the cleanup command.

## Data
- `.kf/config.json`: `harness.verify.task: string[][]`, `harness.verify.stage: string[][]`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget.maxRuns`, `worktree.enabled`.
- Hook environment: standard hook variables plus `KFW_DRIVE_RESULT` (`ready` or `stopped`) and `KFW_DRIVE_REASON`.
- `.kf/hooks/drive-stop.sh`: optional executable script.
- Doctor findings: severity, message and cleanup command.
- Validate findings: `task_harness_needs_worktree` WARNING.

## Acceptance Criteria
- [ ] `harness.verify.task` as `"npm test"`, `[[]]`, `[[""]]`, `[["-rf"]]` and `[["npm","{x}"]]` is each rejected with an error naming the field, while `[["npm","test"]]` is accepted (TC-028).
- [ ] Unset limits resolve to parallel 3, retries 1, maxLoops 2, maxRuns 30, and `kf harness` shows the effective values (TC-028).
- [ ] Out-of-range or non-integer limits (for example `parallel: 0`) are rejected by validation with the field named (TC-028).
- [ ] With worktrees enabled and no `harness.verify.stage`, `kf drive` exits 1 naming `harness.verify.stage` and changes nothing; with `verify.task` unset and `verify.stage` set, a task passes the verify step with nothing executed (TC-029).
- [ ] `kf validate` on a planning or backlog item shows the `task_harness_needs_worktree` WARNING when `verify.stage` is set and `worktree.enabled` is not `true`, and no such warning when neither is set (TC-029).
- [ ] A verify command is run as argv without a shell (a fixture argument containing shell metacharacters reaches the command verbatim), and a command line placed in a report or worker output is never executed (a sentinel file it would create does not appear).
- [ ] `drive-stop.sh` writing its environment to a file shows `KFW_DRIVE_RESULT=ready` for a drive that reached the ship gate and `KFW_DRIVE_RESULT=stopped` with `KFW_DRIVE_REASON` for a `budget` stop; a variant that exits 1 adds a warning and the drive result is unchanged (TC-030).
- [ ] After `kf init`, `.kf/hooks/` contains no `drive-stop.sh`.
- [ ] With `harness.stages.implementation` assigned, no `verify`, an open item whose plan uses role `designer`, a task worktree with no live drive and a lock file with a dead pid, `kf doctor --json` reports four findings: WARNING missing `verify.stage`, ERROR missing role naming item and task, WARNING stale task worktree and WARNING dead lock, each WARNING with a cleanup command; with `stages: {}` there is no verify WARNING (TC-031).
- [ ] Re-running `kf init` on a valid config keeps `harness.verify` and the limits (TC-028).

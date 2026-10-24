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
| ID | UC-002 |
| Name | Inspect the task graph and progress |
| Requirement reference | FR-002 |
| Goal | See every planned task with its resolved role, dependencies, files, wave and current state from one source of truth, in human-readable or JSON form, and keep `tasks.md` consistent with it. |
| Primary actor | Owner / operator |

## Supporting Actors
- `kf tasks`: reads the plan and the task state and prints the listing.
- Main agent: may call `kf tasks --json` to read progress.
- kf driver and worker runs: update task state in `.kfw.json` as tasks progress.
- Dashboard: keeps counting checkboxes in `tasks.md`.

## Preconditions
- A work item exists with an implementation plan containing a Task Breakdown table (UC-001 satisfied, or an older plan treated as role `-` / files unknown).
- Task state, when any task has started, is stored in the item's `.kfw.json`.

## Trigger
The owner runs `kf tasks <feature>` or `kf tasks <feature> --json`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner / operator | Runs `kf tasks <feature>`. | kf locates the item and reads its plan and `.kfw.json`. |
| 2 | kf | Parses the Task Breakdown and resolves each task's role with the FR-004 rules. | Each task has a resolved role. |
| 3 | kf | Computes each task's wave: the longest dependency depth (a task with no dependencies is wave 1). | Each task has a wave number. |
| 4 | kf | Reads each task's state from `.kfw.json`: `pending`, `ready`, `running`, `verifying`, `merging`, `done`, `failed` or `blocked`, with the reason for `failed` / `blocked`. | Each task has a state; tasks not yet started are `pending` or `ready` (all dependencies `done`). |
| 5 | kf | Prints a listing of id, role, dependencies, files, wave, state and reason. | The owner sees the graph and progress. |
| 6 | kf | Renders `tasks.md` from the stored state: one checkbox per task, ticked only when the task is `done`, plus the `## Baseline` section when one exists. | `tasks.md` matches the state; existing checkbox counters keep working. |

## Alternative Flows
### A1
- Trigger: The owner passes `--json`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf prints a JSON document with, per task: id, resolved role, dependencies, files, wave, state and reason. | Machine-readable output that equals the human listing. Returns to step 6. |

### A2
- Trigger: A task depends on a `blocked` task.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | kf keeps the dependent `pending` and reports that it is blocked by the named task. | The owner sees which task holds up the graph. Returns to step 5. |

### A3
- Trigger: The first task run or drive starts (or `tasks.md` is re-rendered after any state change).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | When the first task run or drive starts, kf writes the `## Baseline` section in `tasks.md`: the item branch HEAD sha and the `git status --porcelain` output of the item worktree at that moment. | Baseline recorded once. Returns to step 6. |
| A3.2 | Every later re-render keeps the `## Baseline` section byte-identical. | The baseline survives re-renders. Returns to step 6. |

### A4
- Trigger: The plan has no Role / Files columns (older plan).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | kf shows role `-` resolved through the fallback, and files as unknown. | Listing still works. Returns to step 5. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The feature name does not match a work item. | kf exits non-zero using the existing unknown-feature handling. | Error naming the feature; nothing is written. |
| The plan has graph errors (duplicate id, dangling dependency, cycle, unknown role). | kf does not compute waves from an invalid graph; it prints the graph ERRORs from `kf validate` and exits 1. | Error pointing the owner to fix the plan (see UC-001); `tasks.md` is not changed. |
| The item has no implementation plan or no Task Breakdown rows. | kf reports there are no planned tasks. | Message that no tasks are planned; no state is changed. |

## Postconditions
- The owner has seen every planned task with resolved role, dependencies, files, wave, state and reason.
- `tasks.md` reflects the stored state: a checkbox is ticked only for `done` tasks, and `## Baseline` is preserved.
- `.kfw.json` task state is the single source of progress; `kf tasks` itself does not change task states.

## Business Rules
- Task state lives in `.kfw.json`; `tasks.md` is rendered from it, never the other way round.
- Valid states are exactly `pending`, `ready`, `running`, `verifying`, `merging`, `done`, `failed`, `blocked`; a reason is shown for `failed` and `blocked`.
- A task is ticked in `tasks.md` only when `done`; a worker STATUS alone never marks a task done (FR-007).
- Wave number is the longest dependency depth.
- Role shown is the resolved role (FR-004), not the raw cell.
- The `## Baseline` section is written when the first task run or drive starts (item branch HEAD sha plus `git status --porcelain` of the item worktree) and kept byte-identical on every re-render.
- The dashboard's existing `tasks.md` checkbox counting is unchanged.

## Data
- Plan Task Breakdown: id, description, dependencies, role cell, files cell.
- `.kfw.json` `tasks{}`: per-task state, reason, attempts, branch, base and merge sha.
- `tasks.md`: one checkbox per task and a `## Baseline` section (item branch HEAD sha and `git status --porcelain` of the item worktree).
- `kf tasks --json` output: per task id, resolved role, dependencies, files, wave, state, reason.

## Acceptance Criteria
- [ ] With TASK-001 `done`, TASK-002 (depends on 001) and TASK-003 (depends on 001, 002), `kf tasks <f> --json` returns TASK-001 `done` wave 1, TASK-002 `ready` wave 2, TASK-003 `pending` wave 3, each with resolved role and files, exit 0; the text output shows the same data; `tasks.md` matches it (TC-006).
- [ ] On a plan with a dependency cycle, `kf tasks <f>` exits 1 and prints `task_dep_cycle`, and `tasks.md` is unchanged (TC-006).
- [ ] Every one of the eight states can be reported, with a reason for `failed` and `blocked`.
- [ ] A task whose dependency is `blocked` is listed as blocked by that task and stays `pending`.
- [ ] `tasks.md` has one checkbox per task, ticked only for `done`, and its `## Baseline` section (sha plus porcelain lines) is byte-identical after two successive renders (TC-007).
- [ ] With one `done` and one `blocked` task, the existing checkbox counter (`countTasks`) reports 1/2 (TC-007).

---
feature: kf-next
context: harness
created: 20261107_2256
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Run a bug's tasks |
| Requirement reference | FR-017 (also FR-004 for the `regression` rule; closes #139 item 1) |
| Goal | A bug item's tasks run through the same `kf next` loop and the same `kf verify --task` check as a feature's, even though a bug has no implementation plan. |
| Primary actor | Controller session |

## Supporting Actors
- `kf next`: reads the bug's `tasks.md` and answers what to run now. It changes no file.
- `kf verify --task`: checks a bug task and runs `harness.verify.task`.
- Developer and test-writer seats: dispatched by the controller session as `Agent()` calls.

## Preconditions
- The work item is a bug, with a `tasks.md` written during triage and no `phase-2-implementation-plan.md`.
- Each line of `tasks.md` that is a fix scope item carries a `TASK-###` id.
- The item has a worktree, so `kf verify --task` has a directory to run in.
- `harness.verify.task` may or may not be configured. Without it the command still runs and checks nothing beyond the task id.

## Trigger
The controller session starts the implementation loop for a bug item and calls `kf next <bug>`, and later `kf verify <bug> --task TASK-### --commits <sha>` after a task's commit.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller session | Runs `kf next <bug>`. | `kf next` reads the `TASK-###` lines of `tasks.md` as the task graph. It does not look for an implementation plan. |
| 2 | `kf next` | Orders the tasks by their order in the file and treats each task's Files as unknown. | Files unknown overlaps every open task, so only the first incomplete task is released and the rest get a `wait` naming the holding task. The tasks run one after the other. |
| 3 | `kf next` | Reads each line for the word `regression`. | A line containing `regression` gets a test-writer action. Any other line gets a `write` action for its `no test-writer` ledger line, and the session supplies the reason. |
| 4 | Controller session | Dispatches the test-writer for the `regression` task, records `test hashes` through `kf record`, then dispatches the developer when `kf next` releases it. | The task has a failing regression test and then a developer commit. |
| 5 | Controller session | Runs `kf verify <bug> --task TASK-### --commits <sha>` as `kf next` names it. | The command finds the task in `tasks.md`, skips the Files allowlist check, runs `harness.verify.task` and exits 0 on success. |
| 6 | Controller session | Records the verify result and the review through `kf record`, and runs the review as for a feature. | The task reaches `complete`. The ledger holds the `verify` lines that `kf loop-stats` counts, where a bug run used to show `verify: 0`. |
| 7 | Controller session | Calls `kf next <bug>` again for each following task until it prints `finished`. | Every `TASK-###` line is complete and the bug item is ready for review. |

## Alternative Flows
### A1
- Trigger: A task line has no `regression` word, so the task gets no test-writer.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf next` names the `no test-writer` line as a `write` action. The session records it through `kf record` with its reason. | The task is released to its developer with no test hashes owed. Return to main flow step 5. |

### A2
- Trigger: Two or more tasks, as in a bug with two `TASK-###` lines.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf next` holds the second task with a `wait` naming the first, because Files unknown overlaps everything. | No two developers run at once on a bug, whatever N is. |
| A2.2 | The first task completes. | `kf next` releases the second task. Return to main flow step 3. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `tasks.md` has no `TASK-###` id on any line | `kf next` refuses to schedule and `kf verify --task` finds no task. Neither guesses an id from the line position. | A refusal that names the fix: add a `TASK-###` id to each fix scope line of `tasks.md`. No seat is dispatched and no file changes. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf verify <bug> --task` is given an id that is not in `tasks.md`, for example a typo | `kf verify --task` exits 3 and runs neither the Files check nor `harness.verify.task`. | Message `Unknown task '<id>'` naming the bug's `tasks.md` as the place that was searched. The session fixes the id and runs the command again. |

## Postconditions
- Every `TASK-###` line of the bug is complete in the ledger, with `verify` lines recorded for each task.
- `kf next <bug>` prints `finished`.
- The bug's `tasks.md`, the item state and every other artifact are unchanged by `kf next` and `kf verify --task`.

## Business Rules
- A bug's tasks come only from `tasks.md`. A bug gets no implementation plan, so `kf next` and `kf verify --task` read `tasks.md` and no plan file.
- Task order is file order. `kf verify --task` matches an id the way it does for a feature: trimmed and upper-cased.
- Files is unknown for every bug task, so a bug's tasks stay sequential and `kf verify --task` has no allowlist to check.
- Only a line containing the word `regression` gets a test-writer. Every other line gets a `no test-writer` action.
- An unknown id is a usage error with exit 3, as it is for a feature.

## Data
- `tasks.md`: the bug's task list. Each line carries a `TASK-###` id and a fix scope item, and may contain the word `regression`.
- Task: an id, a position in the file, a test-writer flag derived from the word `regression`, and Files unknown.
- Ledger (`loop/progress.md`): receives the `verify`, `test hashes` and `no test-writer` lines through `kf record`.
- Verify exit code: 0 passes, 3 is an unknown task or a missing input.

## Acceptance Criteria
- [ ] A bug with two `TASK-###` lines runs them one after the other, in file order.
- [ ] Only the `regression` line gets a test-writer. The other line gets a `no test-writer` action.
- [ ] `kf verify <bug> --task TASK-###` exits 0 on each task with no Files check, and the ledger shows `verify` lines for the bug.
- [ ] A `tasks.md` with no `TASK-###` gets a refusal that names the fix, and no seat is released.
- [ ] `kf verify <bug> --task` with an unknown id exits 3.

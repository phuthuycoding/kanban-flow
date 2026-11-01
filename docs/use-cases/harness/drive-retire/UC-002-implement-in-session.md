---
feature: drive-retire
context: harness
created: 20261101_1211
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Implement an item in session with kf verify gates |
| Requirement reference | FR-001, FR-004, FR-006, FR-007, FR-011, FR-012 |
| Goal | After plan approval the human's session runs the task loop itself (no `kf drive` or `kf run` exists), gating each task with `kf verify --task` and the stage with `kf verify --stage`, and every kf command works on items that carry leftover run/drive meta. |
| Primary actor | In-session controller |

## Supporting Actors
- Human operator: approves the plan, reads the `Next:` line, and changes the plan when a verify gate reports a file outside the allowlist.
- kf CLI: `kf approve`, `kf verify`, `kf archive`, `kf status`, `kf validate`, `kf tasks`.
- Developer, test-writer and code-reviewer subagent seats: dispatched by the controller for each task.
- Review session (kanban-review): reads the skill text for the no-subagent fallback.

## Preconditions
- The item has an approved implementation plan whose tasks list a `Files` allowlist.
- The item worktree exists; if it does not, `kf verify` runs in the project root and says so.
- `harness.verify.task` and `harness.verify.stage` may or may not be configured.
- The item's `.kfw.json` may still hold `drive`, `runs`, `sessions` or `tasks` from before the upgrade.
- The plan may be an old one with a `Role` column.

## Trigger
The human approves the plan with `kf approve`, or explicitly starts the item from backlog, and the session opens the kanban-implement skill.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf CLI | `kf approve` starts the item and prints `Next:`. | `Next:` names the implement skill and does not name `kf drive`. |
| 2 | In-session controller | Opens kanban-implement and reads the plan's task graph with `kf tasks`. | The controller has the task order, dependencies and `Files` per task; no role column is shown. |
| 3 | In-session controller | For the next task, dispatches the test-writer, then the developer, and records the task commit. | The task commit exists and its parent is the recorded `<BASE>`. |
| 4 | In-session controller | Runs `kf verify <feature> --task TASK-### --base <BASE>` after the commit and before the code-reviewer. | Exit 0: every changed file is inside the allowlist and every `harness.verify.task` command passed. |
| 5 | In-session controller | Dispatches the independent code-reviewer for the task and applies the bounded fix loop. | The task is accepted and its `tasks.md` checkbox and ledger line are updated by hand. |
| 6 | In-session controller | Repeats steps 3 to 5 until every task is complete. | All tasks are committed and reviewed. |
| 7 | In-session controller | Runs `kf verify <feature> --stage` in place of the hand-run build gate when `harness.verify.stage` is configured. | Exit 0: the stage is ready for testing. |
| 8 | In-session controller | Hands the item to kanban-test. | The item moves on in the in-session path with no drive or run record written. |

## Alternative Flows
### A1
- Trigger: `kf verify --task` exits 2 because a changed file is outside the task's `Files` allowlist.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The controller stops the loop and reads the file list that `kf verify` printed. | It is a plan change, not a developer fix round. |
| A1.2 | The controller edits the plan's `Files` cell for that task and the human re-approves the plan. | Returns to main flow step 4 and re-runs `kf verify` with the same `<BASE>`. |

### A2
- Trigger: `kf verify --task` exits 1 because a `harness.verify.task` command failed.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The controller sends the failing command and its exit code back to the developer as a fix round. | The developer amends the work and commits. |
| A2.2 | The controller re-runs `kf verify --task`. | Returns to main flow step 4; the fix round counts toward the bounded fix loop. |

### A3
- Trigger: `kf verify --stage` exits 1 because a `harness.verify.stage` command failed.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The controller routes the failing command back to a developer fix round. | The developer fixes the failure. |
| A3.2 | The controller re-runs `kf verify --stage`. | Returns to main flow step 7. |

### A4
- Trigger: the item's `.kfw.json` still holds a `drive`, `runs`, `sessions` or `tasks` block from before the upgrade.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | The controller or human runs `kf archive`, `kf status`, `kf approve` or any other kf command on the item. | The command acts normally; the leftover record, even one that looks live, causes no refusal. |
| A4.2 | The leftover keys pass through any write untouched. | Only `kf doctor --fix` removes them (UC-004). Returns to main flow. |

### A5
- Trigger: the plan has a `Role` column from before the upgrade.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | `kf validate` and `kf tasks` read the plan. | The plan validates; the column is ignored, `task_role_unknown` is not raised, and `kf tasks` shows no role. Returns to main flow step 2. |

### A6
- Trigger: the review session has no subagent tool.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A6.1 | kanban-review follows its no-subagent fallback. | The skill says the review cannot complete in that session and the human must be told; it does not point at `kf run --role reviewer`. |
| A6.2 | The session tells the human. | The review waits for a session that has a subagent tool. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf verify --task` exits 3: unknown TASK id, a `--base` that does not resolve or is not an ancestor of HEAD, or a missing flag. | The controller treats it as its own invocation error, fixes the call and re-runs. It never starts a developer fix round and never counts exit 3 as a pass. | `kf verify` printed the reason and ran no command; the task state is unchanged. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A removed command is typed: `kf drive`, `kf run`, `kf runs` or `kf harness`. | The CLI falls through to its single unknown-command path with no special case. | Non-zero exit (1) with the unknown-command message; `kf -h` does not list the command. |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A pre-upgrade drive or run process is still alive for the item. | No kf command refuses because of it and kf does not kill it. | `kf doctor` names `drive.supervisorPid` and each `runs[].pid`; the human stops the process. |

## Postconditions
- Every task has been gated by `kf verify --task` before its code-reviewer, and the stage by `kf verify --stage` when configured.
- No `drive`, `runs`, `sessions` or `tasks` record was written by any command.
- Any leftover meta in `.kfw.json` is unchanged until `kf doctor --fix`.
- No CLI output or skill text names a removed command as a current command.

## Business Rules
- `kf verify --task` exit codes: 0 pass, 1 a verify command failed, 2 a file outside the task allowlist, 3 bad input (runs nothing).
- Exit 2 is a plan change followed by re-approval. Exit 1 is a developer fix round. Exit 3 is a controller invocation error and is never a fix round.
- `kf verify --task` runs after the task commit and before the code-reviewer.
- `kf verify --stage` replaces the hand-run build gate only when `harness.verify.stage` is configured.
- No kf command refuses to act because of leftover run/drive meta.
- Columns of the plan are found by header name, so a `Role` column is ignored and never required.
- Skills carry no `kf-run:` worker paragraph, no `kf drive` or `kf run` hand-off and no `assignedRoles` check.
- The unknown-command message for removed names is the existing one; nothing special-cases them.

## Data
- Implementation plan: task table with `Files` allowlist, dependencies and an optional legacy `Role` column.
- Work item `.kfw.json`: may hold leftover `drive`, `runs`, `sessions` and `tasks` keys, preserved by every write.
- `harness.verify.task` and `harness.verify.stage`: argv lists in the project config run by `kf verify`.
- Task base: the `<BASE>` sha recorded before the task commit and passed as `--base`.
- Loop ledger (`loop/progress.md`) and `tasks.md` checkboxes: maintained by hand by the controller.

## Acceptance Criteria
- [ ] `kf approve` on a freshly planned item prints a `Next:` that names the implement skill and does not contain `kf drive`.
- [ ] `kf drive x`, `kf run x`, `kf runs x` and `kf harness` each exit 1 with the unknown-command message, and `kf -h` lists none of them.
- [ ] kanban-implement calls `kf verify <feature> --task TASK-### --base <BASE>` after each task commit and before the code-reviewer.
- [ ] kanban-implement treats exit 2 as a plan change (stop, edit the plan's Files, re-approve), exit 1 as a developer fix round, and exit 3 as a call to fix and re-run, never a fix round.
- [ ] kanban-implement calls `kf verify <feature> --stage` once all tasks are complete, in place of the hand-run build gate, when `harness.verify.stage` is configured.
- [ ] `kf archive` and `kf status` act normally on an item whose `.kfw.json` still has a drive block that looks live.
- [ ] No kf command refuses to act because of leftover `drive`, `runs`, `sessions` or `tasks` keys, and the keys survive every write.
- [ ] A plan with a `Role` column validates with no `task_role_unknown`, and `kf tasks` shows no role.
- [ ] The plan template and kanban-plan have no `Role` column.
- [ ] `grep -rnE "kf-run:|assignedRoles"` over skills/ returns nothing.
- [ ] kanban-review's no-subagent fallback says the review cannot complete in that session and the human is told, without `kf run`.
- [ ] `kf inspect` and `kf autoconfig` output name no removed command.


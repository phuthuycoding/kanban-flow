---
feature: drive-retire
context: harness
created: 20261101_1210
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Verify a task and a stage with kf verify |
| Requirement reference | FR-002, FR-003 |
| Goal | The controller checks a task's commit against its Files allowlist and the project's `harness.verify` commands, and checks the stage before testing, getting a distinct exit code per outcome. |
| Primary actor | In-session controller |

## Supporting Actors
- kf CLI (`kf verify`)
- Project config (`harness.verify.task`, `harness.verify.stage`)
- Item worktree (git repository holding the task commit)

## Preconditions
- The work item is started and its approved implementation plan lists the task with a `Files` cell.
- For `--task`: the task's commit exists in the item worktree and the controller knows the base sha (the commit before the task started).
- `harness.verify.task` and `harness.verify.stage` are optional lists of argv arrays in the project config.

## Trigger
After a task's commit, the controller runs `kf verify <feature> --task TASK-### --base <sha>`. Once all tasks are complete and before testing, it runs `kf verify <feature> --stage`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | In-session controller | Runs `kf verify <feature> --task TASK-### --base <sha>` after the task commit. | kf resolves the item and the plan's task. |
| 2 | kf CLI | Resolves the item worktree path, checks the TASK id exists in the plan, and checks `<sha>` resolves and is an ancestor of HEAD. | Input is valid. |
| 3 | kf CLI | Lists `git diff --name-only <sha>..HEAD` and matches each file against the task's Files allowlist (exact path, directory prefix, glob). | Every changed file is inside the allowlist. |
| 4 | kf CLI | Runs each `harness.verify.task` argv in the worktree, in order, without a shell. | All commands exit 0. |
| 5 | kf CLI | Exits 0. | The controller proceeds to the code-reviewer for the task. |
| 6 | In-session controller | When all tasks are complete, runs `kf verify <feature> --stage`. | kf resolves the item worktree. |
| 7 | kf CLI | Runs each `harness.verify.stage` argv in the worktree, in order. | All commands exit 0. |
| 8 | kf CLI | Exits 0. | The controller proceeds to testing. |

## Alternative Flows
### A1
- Trigger: `harness.verify.task` is not configured.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf performs the allowlist check only and prints that no task verify is configured. | Exits 0 when the allowlist passes (exit 2 if it does not). Resumes at main flow step 5. |

### A2
- Trigger: The task's Files cell is empty (files unknown).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | kf skips the allowlist check and prints that the check was skipped because the task has no Files. | Verify commands still run. Returns to main flow step 4. |

### A3
- Trigger: The item has no worktree.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | kf runs in the project root and prints that no worktree exists for the item. | Returns to main flow step 3 (or step 7 for `--stage`). |

### A4
- Trigger: HEAD equals `--base` (no changed files).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | kf lists no changed files; the allowlist check passes trivially. | The verify commands still run. Returns to main flow step 4. |

### A5
- Trigger: `harness.verify.stage` is not configured (`--stage`).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | kf prints that no stage verify is configured. | Exits 0. The controller proceeds to testing. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Unknown TASK id (not in the plan), `--base` that does not resolve or is not an ancestor of HEAD, or a missing flag (`--task`/`--base`, or neither `--task` nor `--stage`) | kf prints the reason, runs no allowlist check and no command, and never reports a pass. | Exit 3. The controller fixes its own invocation and re-runs; this is never a developer fix round. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A changed file in `<sha>..HEAD` is outside the task's Files allowlist | kf prints each offending file and does not run the verify commands. | Exit 2. The controller treats it as a plan change: stop, edit the plan's Files, re-approve. |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A `harness.verify.task` or `harness.verify.stage` command exits non-zero, or cannot be spawned (ENOENT) | kf stops at the first failure and reports it as a failure naming the command and its exit code (or the spawn error); later commands do not run. | Exit 1. For a task, the controller returns to the developer as a fix round. For the stage, the controller fixes the failure before testing. |

## Postconditions
- Exit 0: the task (or stage) passed every mechanical check; the item's state and files are unchanged.
- Exit 1, 2 or 3: no check is reported as passed; the controller knows which of the three causes applies from the exit code alone.
- `kf verify` writes nothing to the work item; it only reads the plan, config and git state and runs the configured argv.

## Business Rules
- Exit codes: 0 pass, 1 a verify command failed, 2 a file outside the task allowlist, 3 bad input (runs nothing).
- Allowlist matching keeps the former `pathAllowed` semantics: exact path, directory prefix, glob.
- Verify commands run as argv in the worktree, in order, with no shell; they come only from the project's own `harness.verify`.
- The allowlist is checked before the verify commands; a file outside it exits 2 without running them.
- A missing verify configuration is not a failure: task verify falls back to the allowlist check only, and stage verify exits 0 saying nothing is configured.
- A spawn failure is a failure, never skipped silently.

## Data
- Feature: the work item name given as `<feature>`; resolves the plan and the worktree.
- Task: the `TASK-###` row of the approved plan, with its `Files` cell as the allowlist.
- Base sha: the commit before the task; the diff range is `<sha>..HEAD`.
- `harness.verify.task` / `harness.verify.stage`: lists of argv arrays from the project config.
- Exit code: 0, 1, 2 or 3 as defined in Business Rules.

## Acceptance Criteria
- [ ] `kf verify <f> --task TASK-001 --base <sha>` with a commit touching a file outside the task's Files prints that file and exits 2, running no verify command.
- [ ] With every changed file inside the allowlist, it runs each `harness.verify.task` argv in order and exits 0 when all pass.
- [ ] When a verify command exits non-zero, it exits 1 and names the first failing command with its exit code; later commands do not run.
- [ ] When a verify command cannot be spawned (ENOENT), it exits 1 and names the command.
- [ ] With no `harness.verify.task` configured, it does the allowlist check only, prints that no task verify is configured, and exits 0 when the allowlist passes.
- [ ] With an empty Files cell, the allowlist check is skipped with a message and the verify commands still run.
- [ ] When HEAD equals `--base`, the allowlist passes trivially and the verify commands still run.
- [ ] On an item with no worktree, it runs in the project root and says so.
- [ ] An unknown TASK id, a `--base` that does not resolve, a `--base` that is not an ancestor of HEAD, or a missing flag exits 3 with the reason and runs no command.
- [ ] `kf verify <f> --stage` runs each `harness.verify.stage` argv in the worktree and exits 0 when all pass, or exits 1 naming the first failure.
- [ ] `kf verify <f> --stage` with no `harness.verify.stage` configured exits 0 and prints that nothing is configured.
- [ ] Exit codes 0, 1, 2 and 3 are distinct for the pass, command-failed, outside-allowlist and bad-input outcomes.

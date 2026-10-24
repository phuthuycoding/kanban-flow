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
| ID | UC-006 |
| Name | Task merge conflicts with a concurrent item-branch commit |
| Requirement reference | FR-008 (preconditions rely on FR-005) |
| Goal | When a task's changes cannot be merged cleanly into the item branch because the item branch received another commit while the task ran, or a tracked file in the item worktree is modified, only that task is blocked with a concrete reason and its branch is kept, while unrelated tasks keep going. |
| Primary actor | kf driver |

## Supporting Actors
- Git: task branches, item branch, merge and merge abort.
- Worker agent: produced the task's change in its task worktree.
- Owner / operator (or any human): may commit to the item branch while a drive runs; resolves a conflict or a dirty item worktree by hand.

## Preconditions
- A task is running in a task worktree cut from the item branch HEAD at start (call it H0).
- Two tasks never conflict with each other: tasks whose declared `Files` overlap are serialized (FR-005), the allowlist blocks edits outside `Files` (FR-007), and each merge is verified before the next task is cut. A conflict therefore arises only when the item branch received another commit (for example from a human) after H0 and while the task ran.
- `worktree.enabled` is `true`; merges into the item branch are serialized.

## Trigger
A task passes the allowlist check, kf commits it on its task branch and attempts to merge it into the item branch, and the merge conflicts with a commit that reached the item branch after H0, or a tracked file in the item worktree has uncommitted changes (or the merge would overwrite an untracked file, which git refuses).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf driver | Starts the task in a task worktree cut from the item branch HEAD H0. | The task runs in isolation. |
| 2 | Human | Commits to the item branch while the task runs, touching lines the task also changes. | The item branch HEAD is now H1, different from H0. |
| 3 | Worker agent | Finishes `DONE`; kf passes the allowlist check and commits `task(TASK-###): <description>` on the task branch. | The task branch holds the task's change on top of H0. |
| 4 | kf driver | Confirms the item worktree is clean, records H1 as the pre-merge sha and merges the task branch with `merge --no-ff --no-edit`; git reports conflicts. | Conflicted paths are detected. |
| 5 | kf driver | Runs `merge --abort` in the item worktree. | The item worktree and item branch are back at H1; no conflict markers or `MERGE_HEAD` remain. |
| 6 | kf driver | Marks the task `blocked` with the conflicting paths as the reason. | The task state and reason are stored in `.kfw.json`. |
| 7 | kf driver | Keeps the task branch for the human and does not retry the task automatically. | The task's work is preserved. |
| 8 | kf driver | Leaves unrelated tasks running and scheduling; dependents of the blocked task stay `pending` and are reported blocked by it. | Independent work continues. |
| 9 | kf driver | When no task can progress, stops at the step boundary with code `tasks_blocked`, the reason and the next command, and runs `drive-stop.sh` with `KFW_DRIVE_RESULT=stopped` when that opt-in hook exists. | `kf drive --status` shows `tasks_blocked` and names the blocked task and the conflicting paths. |

## Alternative Flows
### A1
- Trigger: A tracked file in the item worktree is modified (uncommitted) when a task is ready to merge. Untracked files do not count.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf refuses to merge and does not touch the item worktree. | No merge is attempted. |
| A1.2 | kf marks the task `blocked` with the reason "item worktree has uncommitted changes". | Task branch kept; unrelated tasks continue; continues at main flow step 8. |

### A2
- Trigger: The human committed to the item branch while the task ran, but the commit does not touch the task's changed lines.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The merge sees the new item HEAD and succeeds; `verify.task` then decides as usual. | No block; a conflict blocks only a task that actually conflicts with the new commit. |

### A3
- Trigger: The owner resolves the cause by hand and re-runs `kf drive <feature>`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The driver resumes from stored state without re-running `done` tasks; the `blocked` task is reset to `pending` with its attempt count cleared and is scheduled again. | Remaining work continues per UC-004. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `merge --abort` fails | The task is marked `blocked` with the git error and the driver starts no further run, because the item branch state is unknown. | Drive stopped with code `git_error` (FR-012). |
| The supervisor is killed mid-merge | On resume the driver detects the half-finished merge (MERGE_HEAD), aborts it and retries the merge once; this belongs to the stop and resume use case (UC-008). | Retry succeeds or the task is blocked with the conflicting paths. |
| `verify.task` fails after a clean merge | Handled as a verification failure with reset to the pre-merge sha (UC-005), not as a conflict. | Task `failed`, then retried or `blocked` per UC-005. |

## Postconditions
- The conflicting task is `blocked` with its conflicting paths (or the dirty-worktree reason) recorded.
- Its task branch (`<item-branch>--task-###`) is kept and the item branch contains only verified merges.
- The item worktree has no merge in progress and no conflict markers; the item branch HEAD equals the pre-merge sha.
- Unrelated tasks were not interrupted and may be `done`; dependents of the blocked task are `pending`, reported blocked.

## Business Rules
- Tasks with overlapping declared `Files` never run at the same time, and the allowlist rejects edits outside `Files`, so a merge conflict never comes from two tasks; it comes from a commit made to the item branch by someone else while the task ran.
- Merges into the item branch happen one at a time.
- kf refuses to merge while a tracked file in the item worktree has uncommitted changes and blocks that task with "item worktree has uncommitted changes". Untracked files do not block; if a merge would overwrite an untracked file, git refuses and the task is `blocked` with git's message.
- A merge conflict always results in `merge --abort`, never in a left-over conflicted tree.
- A blocked task keeps its branch for the human; branches of failed or blocked tasks are never deleted by kf.
- A conflict blocks only the conflicting task; unrelated tasks continue.
- Conflict handling is not retried automatically within a drive; a human resolves it and re-runs `kf drive`.
- The driver never passes `--force` or `--skip-hooks` (observable through the transition spy of TC-034).

## Data
- Task state in `.kfw.json`: `state: blocked`, `reason` (conflicting paths or dirty-worktree text), `branch`, `base`.
- Conflicted path list from git, stored in the reason.
- Item branch HEAD and the pre-merge sha recorded before each merge.
- Task branch `<item-branch>--task-###` and worktree `<baseDir>/<feature>.tasks/task-###`.
- `runs/drive-<id>.jsonl` merge and task-state events.

## Acceptance Criteria
- [ ] With the fake runner for TASK-001 committing a different line 1 of `shared.txt` to the item branch from the item worktree before printing DONE (a simulated human commit), the merge conflicts, is aborted, TASK-001 is `blocked` naming `shared.txt`, and its branch is kept (TC-019).
- [ ] After that conflict there is no `MERGE_HEAD` in the item worktree and the item branch HEAD equals its pre-merge commit (TC-019).
- [ ] An independent TASK-003 in the same drive still reaches `done` (TC-019).
- [ ] Dependents of the blocked task are not started and are reported blocked by it.
- [ ] With a modified tracked file in the item worktree, the worker runs, the merge is refused, the task is `blocked` with "item worktree has uncommitted changes" and the file is unchanged (TC-020a).
- [ ] With only an untracked file `notes.tmp` in the item worktree (not touched by the task), the merge proceeds, the task is `done` and `notes.tmp` is untouched (TC-020b).
- [ ] When a merge would overwrite an untracked file, git refuses and the task is `blocked` with git's message.
- [ ] A human commit to the item branch that does not overlap the task's lines does not block the task.
- [ ] Two tasks with overlapping declared `Files` never run at the same time (TC-012), so no conflict is reported between them.
- [ ] A blocked task's branch is kept by `kf drive --stop` and the task appears as blocked in `kf drive --status`.

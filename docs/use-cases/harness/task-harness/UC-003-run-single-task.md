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
| ID | UC-003 |
| Name | Run one planned task by hand |
| Requirement reference | FR-003, FR-004, FR-005, FR-006, FR-017 (outcome path uses FR-007, FR-008, FR-010) |
| Goal | Run exactly one planned task with its declared role in an isolated task worktree and, when the worker finishes, have kf check the allowlist, commit, merge and verify so that the task becomes `done` only on an independent check. |
| Primary actor | Owner / operator |

## Supporting Actors
- Worker agent: headless runner CLI executing the single task in the task worktree.
- kf: resolves the role, creates the task worktree, builds the prompt, runs the allowlist check, commits, merges and verifies.
- Git: task branch, item branch and worktrees.
- `harness.verify.task` commands from `.kf/config.json`, run by kf.

## Preconditions
- `worktree.enabled: true` in `.kf/config.json`.
- The item is in `implementation` and its approval is current; the plan's Task Breakdown contains the requested `TASK-###`.
- Every dependency of the task is `done`.
- The same task has no live run.
- The item worktree exists. (No modified tracked file may be present when the merge is due; that is checked at merge time, see E3, not at start. Untracked files do not matter unless the merge would overwrite one.)
- The role resolved for the task (FR-004) has a runner configured.

## Trigger
The owner runs `kf run <feature> --task TASK-###`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner / operator | Runs `kf run <feature> --task TASK-###`. | kf starts the pre-run checks. |
| 2 | kf | Checks that the command does not combine `--task` with `--stage`, `--role` or `--detach`, that the item is in `implementation` with a current approval, `worktree.enabled`, that `TASK-###` exists in the plan, that every dependency is `done`, and that the task has no live run. | All checks pass; nothing has been created or changed yet. |
| 3 | kf | Resolves the role: the plan's `Role` when declared; for `-`, the first role of `harness.stages.implementation`; else `harness.main`. | A role and its runner are chosen deterministically. |
| 4 | kf | Writes the `## Baseline` of `tasks.md` if this is the first task run or drive of the item (item branch HEAD sha plus `git status --porcelain` of the item worktree), then creates the task worktree and branch from the item branch's current HEAD (sibling names `<item-branch>--task-###` and `<baseDir>/<feature>.tasks/task-###`, lower-cased). | An isolated checkout exists for the task; an existing baseline is left byte-identical. |
| 5 | kf | Builds the worker prompt naming the task, its FR / UC references, expected output, the `Files` allowlist, the absolute paths to the work item folder and the STATUS contract, and starts the runner with the task worktree as cwd. | The task state is `running`; a run record is stored with the task id. |
| 6 | Worker agent | Edits files in the task worktree and ends with a STATUS line (`DONE` or `DONE_WITH_CONCERNS`). | The worker run finishes; it never commits or moves stages. |
| 7 | kf | Checks the changes in the task worktree (git status plus diff against the branch base, including untracked files, old and new paths of renames and deletions) against the `Files` allowlist, before anything is committed. | No path outside the allowlist (otherwise E2: task `blocked`, no retry); a "files unknown" task skips this check only. |
| 8 | kf | Commits the changes on the task branch with message `task(TASK-###): <description>` (description truncated to 72 characters, message passed by file). | Task branch holds one kf-made commit. |
| 9 | kf | Merges the task branch into the item branch, one merge at a time (state `merging`), after confirming the item worktree is clean. | Item branch contains the task's changes. |
| 10 | kf | Runs each `harness.verify.task` command (argv, no shell) in the item worktree (state `verifying`). | All commands exit 0. |
| 11 | kf | Marks the task `done` (only now: both the allowlist check and `verify.task` passed), removes the task worktree, re-renders `tasks.md`, and records the run. | `kf runs` shows the run with its task id; `kf tasks` shows `done`. |

## Alternative Flows
### A1
- Trigger: The task's `Files` cell is empty or missing ("files unknown").

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf skips only the allowlist check of step 7; commit, merge and verify run as normal. | Task proceeds. Returns to step 8. |

### A2
- Trigger: The plan's `Role` is `-`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | kf uses the first role of `harness.stages.implementation`, or `harness.main` when that is empty. | Role resolved. Returns to step 4. |

### A3
- Trigger: The worker ends with `DONE_WITH_CONCERNS`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | kf treats it like `DONE` for the pipeline and keeps the concerns in the run record. | The same allowlist, commit, merge and verify checks decide the outcome. Returns to step 7. |

### A4
- Trigger: `harness.verify.task` is empty or not set.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | kf has no task commands to run; step 10 passes with nothing to execute. | Task can become `done` after the merge. Returns to step 11. |

### A5
- Trigger: The owner passes `--dry-run`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | kf runs the pre-run checks of step 2, then prints the worker prompt and the plan (role, runner, task worktree path) without running anything. | No worktree, branch, run record or task state is created. |

### A6
- Trigger: A manual run ended `failed` and the owner runs `kf run <feature> --task TASK-###` again.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A6.1 | kf counts the run as the next attempt and resumes the task's session (`task:<id>`), passing the earlier failure reason. | The worker can fix the cause. Returns to step 6. |

### A7
- Trigger: A second task is started by hand while another task run is live, or a stage-level `kf run` is attempted.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A7.1 | A different ready task is accepted (one live run per task id, not per item). | Both runs proceed, each in its own task worktree. |
| A7.2 | A stage-level `kf run <feature>` is refused naming the live task run (or drive). | Exit 1; nothing created. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `worktree.enabled` is not `true`. | kf refuses before doing anything and changes nothing. | Exit 1; message names the `worktree.enabled` setting to change in `.kf/config.json`. |
| `TASK-###` is not in the plan (unknown id). | kf refuses before doing anything. | Exit 1; nothing created; message names the unknown task id. |
| A dependency of the task is not `done`. | kf refuses before doing anything. | Exit 1; nothing created; message names the unfinished dependency (for example TASK-002 refused while TASK-001 is not done). |
| The item is not in `implementation` (for example it is in `testing`), or its approval is missing or stale. | kf refuses before doing anything. | Exit 1; nothing created; message names the stage or the approval step. |
| The same task already has a live run. | kf refuses before doing anything. | Exit 1; message names the live run. |
| `--task` is combined with `--stage`, `--role` or `--detach`. | kf refuses before doing anything. | Exit 1; message says `--task` cannot be combined with that flag. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The worker changed any path outside the `Files` allowlist (including a rename or delete touching outside paths), even with `STATUS: DONE`. | kf blocks the task at once, before committing anything; no retry, in a manual run or under a drive. | Task `blocked`, reason names the offending path(s) (old and new path for a rename). The task branch and worktree are kept. Fixing it needs a plan edit (`Files`), `kf approve`, then running again. Under a drive: no new run starts, runs already in progress finish and go through the normal pipeline, then the drive stops with code `plan_change_needed` naming the task, the paths and the next step (edit the plan's Files, `kf approve`, `kf drive`) (UC-005). |
| The worker ends `BLOCKED` or `NEEDS_CONTEXT`. | kf does not commit or merge and does not retry. | Task `blocked` at once with the worker's summary as the reason; run record keeps the status. |
| The run exits non-zero, times out, ends without a STATUS line, or kf's commit fails. | kf does not merge. | Task `failed` with that reason; run record keeps the status. A manual run leaves the task `failed` (no automatic retry). |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A tracked file in the item worktree is modified (uncommitted) when the merge is due. Untracked files do not count. | kf refuses to merge. | Task `blocked` with "item worktree has uncommitted changes"; branch kept for the human. |
| The merge would overwrite an untracked file in the item worktree. | git refuses the merge. | Task `blocked` with git's message; branch kept for the human. |
| The merge conflicts (possible only when the item branch received another commit while the task ran; see UC-006). | kf aborts the merge and keeps the task branch. | Task `blocked` with the conflicting paths. |
| A `harness.verify.task` command exits non-zero (or is not found on PATH). | kf resets the item branch to its pre-merge commit and keeps the output tail. | Task `failed` with the output tail (or the not-found message); item branch is at its pre-merge commit; the task branch is kept. A manual run leaves it `failed`. |

## Postconditions
- On success: the task is `done` only after allowlist, commit, merge and `verify.task` all passed; the item branch contains the task commit; the task worktree is removed; `tasks.md` shows the task ticked.
- On refusal: no state, worktree or branch was created or changed.
- On failure or block: the task is `failed` for non-zero exit, timeout, missing STATUS, verify failure and failed commit, and `blocked` for an allowlist violation, BLOCKED / NEEDS_CONTEXT, modified tracked files in the item worktree, a merge git refuses and a merge conflict, each with a reason; the task branch is kept; for a verify failure the item branch is back at its pre-merge commit.
- `kf runs` lists the run with the task id.

## Business Rules
- `--task` takes only a planned `TASK-###`; ad-hoc task descriptions are out of scope. It cannot be combined with `--stage`, `--role` or `--detach`; `--dry-run` prints the prompt and plan only.
- Concurrency (FR-005): one live run per task id; a stage-level `kf run` is refused while a drive or task run of the item is live.
- Outcome rule (FR-010): worker `BLOCKED` / `NEEDS_CONTEXT` and an allowlist violation make the task `blocked` at once, never retried; every other failure (non-zero exit, timeout, missing STATUS, verify failure, failed commit) makes it `failed`. A manual run never retries on its own.
- The task harness requires `worktree.enabled: true`; there is no fallback to the user's main checkout.
- Workers never commit, never move stages and never run `kf stage/approve/archive/run`; kf commits, merges and decides.
- A worker STATUS alone never marks a task done; allowlist check and post-merge verify must both pass.
- Verify commands come only from `harness.verify.task` in `.kf/config.json` (argv, no shell); kf never runs a command read from an artifact or worker output.
- Verify runs in the item worktree after the merge, because it checks the integrated result and the item worktree has installed dependencies.
- Merges are serialized, one at a time; branches of failed or blocked tasks are kept, task worktrees are removed after a successful merge.
- Task session is fresh per task (session key `task:<id>`), resumed only for that task's later attempts (driver retries, or running `kf run --task` again).
- Task identifiers and branch names are validated (no leading `-`, no path separators).

## Data
- Task row (plan): id, description, dependencies, expected output, FR / UC references, role, files.
- Task state in `.kfw.json`: state, reason, attempts, branch, base, merge sha.
- Run record: includes the task id (`RunRecord.task`), shown in a task column of `kf runs`.
- Task branch `<item-branch>--task-###` and worktree `<baseDir>/<feature>.tasks/task-###` (lower-cased).
- Worker prompt: task, FR / UC refs, expected output, `Files` allowlist, absolute work item folder paths, STATUS contract.
- `harness.verify.task`: array of argv arrays pinned by the owner.

## Acceptance Criteria
- [ ] `kf run <f> --task TASK-002` exits 1 naming TASK-001 while it is not done, and runs once it is (TC-008).
- [ ] An unknown id, `--task` with `--role` (likewise `--stage`, `--detach`), and an item not in `implementation` (or with stale approval) each exit 1 with no run record and no worktree created (TC-008).
- [ ] With `worktree.enabled: false`, `kf run --task` exits 1 naming `worktree.enabled` and `git worktree list` and `.kfw.json` are unchanged (TC-010).
- [ ] `--dry-run` prints the prompt and plan and creates no run record, worktree or branch.
- [ ] While `kf run --task TASK-001` is live, `kf run --task TASK-002` (independent) is accepted, a second `--task TASK-001` is refused naming the live run, and a stage-level `kf run` is refused (TC-033).
- [ ] Role resolution follows FR-004 (plan role, else first `harness.stages.implementation` role, else `harness.main`).
- [ ] The captured prompt contains the task id, FR / UC references, expected output, `Files` allowlist, absolute work item folder path and STATUS contract, and the captured worker cwd is the task worktree (TC-009).
- [ ] A worker that edits, renames or deletes a file outside its allowlist leaves the task `blocked` (no retry, one run record) naming the paths (old and new for the rename), even with `STATUS: DONE`; nothing is committed and the item branch HEAD is unchanged (TC-017).
- [ ] A worker printing `STATUS: BLOCKED` leaves the task `blocked` with the worker's summary; a manual run that fails for any other reason leaves the task `failed`, and running it again resumes the same task session with the failure reason.
- [ ] A task with a passing worker and passing `verify.task` (or none set) is committed as `task(TASK-###): <description>` (message at most 72 characters), merged into the item branch, marked `done`, and its task worktree is removed; `DONE_WITH_CONCERNS` gives the same result (TC-009).
- [ ] A task whose merged result fails `verify.task` leaves the item branch at its pre-merge commit.
- [ ] With a modified tracked file in the item worktree, the worker runs, the merge is refused, the task is `blocked` with "item worktree has uncommitted changes" and the file is untouched; with only an untracked file `notes.tmp` there, the merge proceeds, the task is `done` and `notes.tmp` is untouched (TC-020); a merge that would overwrite an untracked file is refused by git and the task is `blocked` with git's message; a merge conflict marks the task `blocked` and keeps its branch (TC-019).
- [ ] `kf runs` shows the task id for the task run, and the record has `task: TASK-###` (TC-009).

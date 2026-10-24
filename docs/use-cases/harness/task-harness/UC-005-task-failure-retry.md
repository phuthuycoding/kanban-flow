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
| ID | UC-005 |
| Name | Task fails allowlist or verification, retries, then blocks |
| Requirement reference | FR-007, FR-010 |
| Goal | A task's result counts only when an independent check passes: under the driver, a task that fails the pinned verify (or another retryable failure) is retried a bounded number of times with the failure reason, then becomes `blocked` and its dependents are reported blocked; a task that touches files outside its allowlist, or whose worker reports BLOCKED, is `blocked` at once and never retried. |
| Primary actor | kf driver |

## Supporting Actors
- Worker agent: executes the task and is resumed with the failure reason on retry.
- Owner / operator: pins `harness.verify.task` and `harness.retries`; resolves a blocked task.
- Git: task worktree, item worktree, branch reset.

## Preconditions
- A drive (UC-004) or a manual `kf run --task` (A4) is running a task with a declared `Files` allowlist (or a "files unknown" task).
- `worktree.enabled` is `true`; `harness.verify.task` is set for the verify scenario.
- `harness.retries` is 1 by default (configurable; 0 is valid).
- The worker ended `DONE` or `DONE_WITH_CONCERNS` (a worker ending `BLOCKED` or `NEEDS_CONTEXT` is E1).

## Trigger
A task worker finishes and kf runs its completion checks: `harness.verify.task` exits non-zero after the merge (main flow), another retryable failure occurs (non-zero exit, timeout, missing STATUS line, failed kf commit), or the allowlist check fails (A5, never retried).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Worker agent | Finishes the task with `STATUS: DONE` having changed only paths inside its `Files` allowlist. | Worker STATUS alone does not mark the task done. |
| 2 | kf driver | Runs the allowlist check (no violation), commits `task(TASK-###): <description>` on the task branch, records the pre-merge sha, merges into the item branch and runs `harness.verify.task` commands in the item worktree. | The merged result is checked. |
| 3 | kf driver | A verify command exits non-zero: resets the item branch to the recorded pre-merge sha and marks the task `failed` keeping the output tail. | The item branch is back to its pre-merge commit; the task branch is kept. |
| 4 | kf driver | While retries remain (`harness.retries`, default 1), starts a repair run that resumes the same task session (`task:<id>`) with the verify output tail. | The worker is told exactly what failed; attempt count increases; the run counts against `harness.budget.maxRuns`. |
| 5 | Worker agent | Fixes the change and finishes again. | The completion checks run again from the allowlist check. |
| 6 | kf driver | Repeats steps 2-3 for the repair run. | Either the verify passes (A1) or fails again. |
| 7 | kf driver | When no retry remains and the task still fails: marks the task `blocked` with the last reason. | The task stops being scheduled. |
| 8 | kf driver | Keeps dependents of the blocked task `pending` and reports them as blocked by it; unrelated tasks continue. | `kf tasks` shows the blocked task, its reason and its blocked dependents. |
| 9 | kf driver | When no task can progress, stops at the step boundary with code `tasks_blocked`, a one-line reason and the next command, and runs `drive-stop.sh` with `KFW_DRIVE_RESULT=stopped` when that opt-in hook exists. | `kf drive --status` shows `tasks_blocked`, names the blocked task and the human step. |

## Alternative Flows
### A1
- Trigger: The retry succeeds (allowlist and verify pass after the repair run).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The merge is kept, the task becomes `done` and its task worktree is removed. | Dependents become ready; returns to UC-004 main flow step 3. |

### A2
- Trigger: The task is a "files unknown" task.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The allowlist check (a) is skipped. | Only the merge and `verify.task` can fail the task; returns to main flow step 2. |

### A3
- Trigger: `harness.retries` is 0.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The first failure (state `failed`) finds no retry remaining, so the task becomes `blocked` with that reason and no repair run starts. | Returns to main flow step 7. |

### A4
- Trigger: The task was started by hand with `kf run --task TASK-###`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | The same allowlist and verify pipeline applies and the same failure reasons are recorded. | Returns to main flow step 2. |
| A4.2 | A manual run never retries and never blocks by exhausting retries: a retryable failure leaves the task `failed` (the BLOCKED / NEEDS_CONTEXT, allowlist, modified-tracked-files and merge cases are `blocked`, as under a drive). | The owner fixes the cause and runs `kf run --task TASK-###` again; that is the next attempt and resumes the task session. |

### A5
- Trigger: The worker ended `DONE` / `DONE_WITH_CONCERNS` but changed a path outside its `Files` allowlist (an edit, or a rename or delete touching outside paths).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | kf runs the allowlist check in the task worktree before anything is committed, comparing `git status --porcelain` and the diff against the task branch base, including untracked files and both old and new paths of renames and deletes. | Out-of-allowlist paths are identified. |
| A5.2 | kf marks the task `blocked` at once, with the offending paths (old and new for a rename) as the reason; nothing is committed or merged and no retry runs, even with `retries` above 0. | The item branch is untouched; the task branch is kept. |
| A5.3 | Under a drive: no new run starts; runs already in progress finish and go through the normal pipeline; then the drive stops with code `plan_change_needed`, naming the task, the paths and the next step. | `kf drive --status` shows `plan_change_needed` and the next step: edit the plan's `Files`, `kf approve <feature>`, `kf drive <feature>` (the approved plan's `Files` must change, which needs re-approval). |
| A5.4 | In a manual `kf run --task`, the task is `blocked` too. | The owner edits the plan, re-approves and runs the task again. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A verify command is not found on PATH | The task is marked `failed` with that message instead of crashing the driver; it follows the retry path. | Task `failed` (then `blocked` when no retry remains) with the missing-command reason. |
| The run exits non-zero, times out, ends without a STATUS line, or kf's commit fails | Same as any other failure: the task is `failed` with that reason and follows the retry path. | Task `failed` (then `blocked` when no retry remains). |
| The reset to the pre-merge sha fails | The task is marked `blocked` with the git error and the driver starts no further run, because the item branch state is unknown. | Drive stopped with code `git_error` (FR-012). |
| Worker ends `BLOCKED` or `NEEDS_CONTEXT` | The task becomes `blocked` at once with the worker's summary; no retry. | Drive stopped at the step boundary with code `worker_blocked`; reason and next command printed. |
| Run budget (`harness.budget.maxRuns`) is reached by retry runs | The driver starts no further run. | Drive stopped with code `budget` and the run count. |

## Postconditions
- A failed-then-fixed task is `done` and merged with its worktree removed.
- A task that exhausted its retries (or had `retries: 0`) is `blocked` with a reason; its task branch and worktree are kept for the human.
- The item branch is at its pre-merge commit after any verify failure; no unverified merge remains.
- Dependents of a blocked task are `pending` and reported as blocked by it; unrelated tasks were not interrupted.
- Every failure, retry and block is a line in `runs/drive-<id>.jsonl`.

## Business Rules
- A task is `done` only when the allowlist check and `verify.task` both pass; worker STATUS never decides.
- The allowlist check runs in the task worktree before anything is committed; `verify.task` runs in the item worktree after the merge (it checks the integrated result and has installed dependencies).
- Verification commands come only from `harness.verify` in `.kf/config.json`, run as argv arrays without a shell.
- Outcome rule (FR-010): worker `BLOCKED` / `NEEDS_CONTEXT` makes the task `blocked` at once with no retry and stops the drive (`worker_blocked`). An allowlist violation makes the task `blocked` at once with no retry and stops the drive with `plan_change_needed` after in-progress runs finish. Any other failure (non-zero exit, timeout, missing STATUS, verify failure, failed commit) makes the task `failed`.
- Under the driver a `failed` task gets up to `harness.retries` (default 1) repair runs that resume the same task session with the failure reason (for example the verify output tail); retries apply only to non-zero exit, timeout, missing STATUS, verify failure and failed commit; when none remain, including `retries: 0`, it becomes `blocked`; its dependents never start.
- A manual `kf run --task` never auto-retries; the failure stays `failed` and running it again is the next attempt.
- On verify failure the item branch is reset only to the pre-merge sha that kf recorded.
- Branches of failed or blocked tasks are kept.

## Data
- Task state in `.kfw.json`: `state` (`failed`, `blocked`), `reason`, `attempts`, `branch`, `base`, `merge sha`.
- Stop codes used here: `worker_blocked`, `plan_change_needed`, `tasks_blocked`, `git_error`, `budget`.
- Pre-merge sha: recorded by kf before each merge, used for the reset.
- Task session: key `task:<id>`, resumed only for that task's retries.
- `harness.verify.task`, `harness.retries`, `harness.budget.maxRuns` in `.kf/config.json`.
- Plan `Files` column: the allowlist.
- Run records and `runs/drive-<id>.jsonl` events.

## Acceptance Criteria
- [ ] A worker that edits, renames or deletes a file outside its allowlist (each of the three variants) leaves the task `blocked` with exactly one run record (no retry, even with `retries: 1`) naming the old and new paths involved, even with `STATUS: DONE`; nothing is committed or merged and the item branch HEAD is unchanged (TC-017).
- [ ] Under `kf drive` with a second independent task running, an allowlist violation starts no new run, the running task finishes and merges, and the drive stops with code `plan_change_needed` whose status output names the task, the paths and the next step (edit the plan's Files, `kf approve`, `kf drive`) (TC-017).
- [ ] With `verify.task: [["./fail.sh"]]` (exits 1) and `retries: 1`, a drive shows exactly two run records for TASK-001 with the same session id, the second prompt containing the verify output tail; the task then ends `blocked` (TC-018).
- [ ] After each failed verify the item branch HEAD equals the recorded pre-merge sha (TC-018).
- [ ] With `retries: 0`, the first failure leaves the task `blocked` after one run record.
- [ ] A worker printing `STATUS: BLOCKED` produces one run record, a `blocked` task and drive stop code `worker_blocked` (TC-023).
- [ ] Dependents of a blocked task (TASK-002 depends on TASK-001) never start, are listed by `kf tasks` as blocked by it, and the drive stops with code `tasks_blocked` (TC-018).
- [ ] A verify command not found on PATH (`no-such-cmd`) produces a `failed` task whose reason contains "not found", and the driver process keeps running (TC-018).
- [ ] A manual `kf run --task` that fails verify leaves the task `failed` (no second run starts by itself); running it again starts a second run that resumes the same session.
- [ ] A "files unknown" task skips the allowlist check but still runs merge and `verify.task`.
- [ ] A task that passes on retry becomes `done` and its task worktree is removed.
- [ ] When all remaining tasks are blocked the driver stops with code `tasks_blocked` instead of spinning.

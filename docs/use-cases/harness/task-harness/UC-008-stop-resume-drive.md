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
| ID | UC-008 |
| Name | Stop, crash, and resume a drive |
| Requirement reference | FR-013, FR-014 |
| Goal | The owner can inspect, stop and resume a detached drive at any time, and a crash at any point leaves state from which `kf drive` continues without redoing finished work or losing records. |
| Primary actor | Owner / operator |

## Supporting Actors
- kf driver: the detached supervisor process that is inspected, stopped or resumed.
- Worker agent: runner processes that `--stop` terminates.
- Per-item lock: serializes read-modify-write access to `.kfw.json` between the supervisor, workers' run records and CLI commands.

## Preconditions
- An item is in `implementation` — or in `testing`/`review` with a stored stopped drive (FR-011) — with a current approval and has been driven at least once (`kf drive <feature>` detached it), or a previous supervisor died.
- `worktree.enabled` is `true` and `harness.verify.stage` is configured.
- Drive state (current step, loop count, run count, stop code and reason, config hash) and task states are stored in `.kfw.json`.

## Trigger
The owner runs `kf drive <feature> --status`, `kf drive <feature> --stop`, or re-runs `kf drive <feature>` after the supervisor stopped or crashed.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner / operator | Runs `kf drive <feature> --status`. | kf prints the current step, loop and run counts, running tasks, and, when stopped, the stop code, the reason and the exact next command. |
| 2 | Owner / operator | Runs `kf drive <feature> --stop`. | kf terminates the supervisor and its workers; every worktree and branch is kept. |
| 3 | kf driver | On termination, records the stop in drive state under the item lock. | `--status` shows stop code `stopped_by_user` with its reason and next command. |
| 4 | Owner / operator | Re-runs `kf drive <feature>`. | kf validates the FR-011 preconditions and takes the drive lock; at most one drive for the item starts. |
| 5 | kf driver | Reads drive state and task states, skips every task already `done`, resets `failed` and `blocked` tasks to `pending` with their attempt count cleared (on the assumption the human fixed the cause), and re-takes the config hash. | Interrupted tasks (`running`, `verifying`, `merging`) are re-evaluated; finished work is not re-run. |
| 6 | kf driver | Continues the loop from the stored step (task DAG, stage verify, testing, review). | The drive proceeds toward the ship gate as in UC-004. |

## Alternative Flows
### A1
- Trigger: The supervisor was killed or the machine crashed instead of a clean `--stop`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf drive <feature> --status` finds a recorded drive whose supervisor pid is dead. | Status reports stop code `crashed` with the last known step and the next command, and explains what to clean up if needed. |
| A1.2 | Owner re-runs `kf drive <feature>`; the dead drive claim is taken over. | Return to main flow step 5; no task is reported `done` without its merge. |

### A2
- Trigger: The supervisor was killed in the middle of a merge, so the item worktree has `MERGE_HEAD`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | On resume the driver detects the half-finished merge by `MERGE_HEAD` in the item worktree. | The merge is aborted so the item worktree is clean. |
| A2.2 | The driver retries the merge of that task once. | If it succeeds and `verify.task` passes, the task becomes `done`; return to main flow step 5. If it conflicts the task is `blocked` (UC-006); if `verify.task` fails it is `failed` (UC-005). |

### A3
- Trigger: Two writers need the same item's `.kfw.json` at the same time (supervisor, parallel workers' run records, a CLI command such as `kf stage`).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Each writer takes the per-item lock file, which holds its pid, for its read-modify-write. | Writes are serialized; every run record and state change is kept. |
| A3.2 | A writer finding a live lock waits up to 30 seconds. | The lock is acquired when released, and the flow continues. |
| A3.3 | The lock is held only around the re-read, the write and (for stage moves) the folder rename, never across hooks or worker runs; a run record that reached `done`, `failed`, `timeout` or `reset` is never set back to `running` by a later write. | A late pid write after a finishing write keeps the final status. |

### A4
- Trigger: `--stop` or `--status` is used for an item with no running or recorded drive.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | kf reports there is no drive for the item and prints the command to start one. | No state is changed; exit as a no-op. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf drive <feature>` while another drive for the same item is alive, or two calls racing | kf refuses the loser; at most one drive starts. | Exit 1, message names the live supervisor pid and suggests `--status` or `--stop`. |
| A lock file whose pid is dead | The lock is taken over by the next writer. | The operation proceeds; the takeover is not an error. |
| A live lock is not released within 30 seconds | The waiting command fails instead of hanging. | Error naming the holder pid; no partial write. |
| Resume finds the approval fingerprint changed while the drive was stopped | `kf drive` refuses under FR-011 (approval must be current). | Exit 1 naming `kf approve <feature>`; nothing written. |
| Resume finds `harness.roles`, `runners`, `verify` or `worktree.enabled` changed while the drive was stopped | The config hash is re-taken at resume (FR-013); `worktree.enabled: false` is refused under FR-011. | The drive continues under the current config; `config_changed` is raised only for a change made while a drive is running. |
| `--stop` cannot signal a worker process (already exited) | The stop proceeds and reports the process as already gone. | Drive state is "stopped"; worktrees and branches are untouched. |
| Resume after the merge retry failed again | The task is `blocked` (conflict) or `failed` (verify) with the reason and its branch is kept. | Drive continues with unrelated tasks or stops with code `tasks_blocked`. |

## Postconditions
- After `--stop`: no supervisor or worker process of the drive is running; all task worktrees, branches and the item worktree still exist; drive state has stop code `stopped_by_user` with the reason.
- After a crash: `--status` reports `crashed` with the next command.
- After resume: tasks already `done` are not re-run, previously `failed` or `blocked` tasks are `pending` with attempts cleared, and no task is `done` without its merge into the item branch.
- After a half-finished merge recovery: the item worktree has no `MERGE_HEAD` and no conflict markers left by the aborted merge.
- No run record or state change was lost by concurrent writers.
- No lock file remains held by a dead pid after the next successful write.

## Business Rules
- `kf drive` detaches by default and survives the caller's exit; its state lives in `.kfw.json`, not in process memory.
- `--stop` terminates the supervisor and its workers and never deletes worktrees or branches; cleanup is a separate human action.
- Re-running `kf drive` resumes from stored state; `done` tasks are never re-run; `failed` and `blocked` tasks are reset to `pending` with attempts cleared; the config hash is re-taken.
- Two `kf drive` calls for the same item, concurrent or not, start at most one drive; the other is refused naming the live one.
- A dead supervisor is reported as stop code `crashed`; `--stop` yields `stopped_by_user`.
- Every read-modify-write of `.kfw.json` (stage, approve, run records, sessions, task state, drive state) holds the per-item lock.
- A lock with a dead pid is taken over; a live lock is waited on for up to 30 seconds and then fails with the holder named.
- A half-finished merge is aborted and retried at most once.
- Every stop prints one reason and one next command.

## Data
- Drive state (`.kfw.json`): step, loop count, run count, stop code, stop reason, config hash, supervisor pid.
- Task state (`.kfw.json`): state per task (`pending`, `ready`, `running`, `verifying`, `merging`, `done`, `failed`, `blocked`), reason, attempts, branch, base, merge sha.
- Lock file: `.works/.locks/<feature>.lock`, containing the holder's pid.
- Run records: one per worker run, written under the lock.
- Git state: item worktree and branch, task worktrees and branches, `MERGE_HEAD`.

## Acceptance Criteria
- [ ] `kf drive <feature> --status` prints the step, counts, running tasks and, when stopped, the stop code, the reason and the exact next command.
- [ ] `kf drive <feature> --stop` leaves no live supervisor or worker pid, keeps every worktree and branch, and `--status` then shows `stopped_by_user` (TC-025).
- [ ] With TASK-001 `done`, TASK-002 running and TASK-003 `blocked`, SIGKILL of the supervisor makes `--status` report `crashed` with a next command; re-running `kf drive` does not re-run TASK-001, re-runs TASK-002, resets TASK-003 to `pending` and runs it, and the drive completes (TC-024).
- [ ] With `MERGE_HEAD` left in the item worktree by a simulated crash, resume aborts the half merge, retries it once and the task becomes `done` (TC-025).
- [ ] Two `kf drive demo` processes started concurrently: exactly one starts and the other exits 1 naming it (TC-025).
- [ ] A lock file with a dead pid is taken over; a lock held by a live pid past the wait (shortened in the test) fails naming the holder pid (TC-026).
- [ ] Two processes performing 50 run-record upserts each on one item leave all 100 records, and a late pid write after a finishing write leaves status `done` (or `failed` for failed then running) with the pid kept (TC-027, TC-035).

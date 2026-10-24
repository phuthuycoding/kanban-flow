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
| ID | UC-004 |
| Name | Drive an approved item from implementation to the ship gate |
| Requirement reference | FR-005, FR-006, FR-008, FR-011, FR-013, FR-017, FR-019 (stop codes use FR-012) |
| Goal | After the human has approved the plan and chosen to start, `kf drive` runs the item through implementation, testing and review on its own and stops at "ready for ship decision" without shipping or archiving anything. |
| Primary actor | Main agent / owner |

## Supporting Actors
- kf driver: detached supervisor process that schedules tasks, runs verifies, merges, moves stages and stops.
- Worker agent: headless runner executing one task or one stage role.
- Owner / operator: pinned `harness.verify`, `harness.parallel` and `worktree.enabled` in `.kf/config.json`; makes the ship decision afterwards.
- Stage gates and hooks: the normal `kf stage` validation and hooks, applied to every driver transition.

## Preconditions
- All five FR-011 preconditions hold: the item is in `implementation`; its approval fingerprint is current (requirement confirmed, plan approved, start chosen by the human); `worktree.enabled` is `true`; `harness.verify.stage` is set; no drive of this item is live.
- `harness.verify.task` is optional; when unset, per-task verify has nothing to run and passes.
- For a feature item: the plan's Task Breakdown has the `Role` and `Files` columns (older plans still drive, serially, with role `-` and "files unknown").

## Trigger
The main agent or owner runs `kf drive <feature>` after the start decision (the `kanban-flow` skill hands off to it when a harness is configured).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Main agent / owner | Runs `kf drive <feature>`. | kf checks the preconditions (stage, approval, `worktree.enabled`, `verify.stage`, no live drive). |
| 2 | kf driver | Detaches into a supervisor process, records drive state (step, loop count, run count, config hash) in `.kfw.json` and writes the `## Baseline` of `tasks.md` (item branch HEAD sha plus `git status --porcelain` of the item worktree; kept byte-identical afterwards). | The command returns; the drive survives the caller's exit. |
| 3 | kf driver | Parses the approved task table into a DAG and computes the ready set (all dependencies `done`). | Ready tasks are known; each has a resolved role (plan `Role`, else first implementation role, else `harness.main`). |
| 4 | kf driver | Schedules ready tasks concurrently up to `harness.parallel` (default 3). A task whose `Files` patterns overlap a running task waits; a "files unknown" task runs alone. | Disjoint tasks run in parallel; overlapping tasks are serialized. |
| 5 | kf driver | For each task, creates a task worktree and branch (`<item-branch>--task-###`, `<baseDir>/<feature>.tasks/task-###`, lower-cased) cut from the item branch HEAD and runs the task's role runner there. | Workers edit files in isolated checkouts. |
| 6 | kf driver | When a worker finishes `DONE` or `DONE_WITH_CONCERNS`, runs the allowlist check, commits `task(TASK-###): <description>`, merges into the item branch one merge at a time and runs `harness.verify.task` in the item worktree. | The task becomes `done` only after allowlist, merge and verify all pass; its task worktree is removed. A failed task is retried or blocked per UC-005; a merge conflict per UC-006. |
| 7 | kf driver | Repeats steps 3-6 until every task is `done`, appending one JSON line per event to `runs/drive-<id>.jsonl`. | The DAG is complete. |
| 8 | kf driver | Runs `harness.verify.stage` commands. | Integrated result is verified with human-pinned commands. |
| 9 | kf driver | Moves the item to `testing` through the normal stage gates and hooks and runs the testing role(s) (`harness.stages.testing`, else `harness.main`). | A testing report exists. |
| 10 | kf driver | Runs `kf validate`; on PASS moves the item to `review` through the normal gates and runs the review role(s). On FAIL, REJECT or REQUIREMENT_BUG see UC-007. | A review report exists. |
| 11 | kf driver | Runs `kf validate` on the review report; on PASS stops with result `ready` and "ready for ship decision" and runs `.kf/hooks/drive-stop.sh` with `KFW_DRIVE_RESULT=ready` when that opt-in hook exists. | The item is in `review` with a PASS report; nothing is shipped, merged to the default branch or archived. |
| 12 | Main agent / owner | Runs `kf drive <feature> --status` (and `kf tasks`, `kf runs`). | Output shows the result `ready` and "ready for ship decision" and the human makes the ship decision. |

## Alternative Flows
### A1
- Trigger: The item has `kind: bug` (no plan task table).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The driver skips the DAG and runs the implementation stage role(s) once in the item worktree (no task worktrees, no allowlist). | One implementation run is recorded. |
| A1.2 | The driver continues with `harness.verify.stage` and the testing and review steps. | Returns to main flow step 8. |

### A2
- Trigger: The plan predates the `Role` and `Files` columns, or a task has an empty `Files` cell.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Missing columns resolve to role `-` and "files unknown"; the scheduler runs such a task alone. | Tasks run sequentially. |
| A2.2 | The allowlist check (a) is skipped for "files unknown" tasks; merge and `verify.task` still apply. | Returns to main flow step 7. |

### A3
- Trigger: The owner re-runs `kf drive <feature>` after a stop or `--stop`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The driver resumes from the stored drive state without re-running `done` tasks; `failed` and `blocked` tasks are reset to `pending` with their attempt count cleared; the config hash is re-taken (details in UC-008). | Returns to main flow at the stored step. |

### A4
- Trigger: A task worktree exists while the owner runs `kf worktree list`, or the owner archives or cancels the item.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | `kf worktree list` recognises task worktrees as belonging to the item and does not report them as orphans. | Listing is accurate during a drive. |
| A4.2 | `kf archive` / `kf cancel` remove clean task worktrees alongside the item worktree. | Task branches of failed or blocked tasks are reported as kept. |

### A5
- Trigger: A stage-level `kf run <feature>` or a second `kf drive <feature>` is attempted while the drive is live.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | kf refuses the stage-level `kf run` naming the live drive (one drive per item, one live run per task id). | Exit 1; the drive is unaffected. |
| A5.2 | Of two `kf drive` calls for the same item, concurrent or not, at most one starts; the other is refused naming the live drive. | Exit 1 for the loser. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Item is not in `implementation` (for example `planning` or `backlog`) | `kf drive` refuses before doing anything and names the human step needed. | Exit 1; for an approved item in planning or backlog the message names `kf stage <feature> implementation`; nothing changed. |
| Approval is missing or its fingerprint is no longer current | `kf drive` refuses and names the approve step. | Exit 1; message names `kf approve <feature>`; no drive state written. |
| `worktree.enabled` is not `true` | `kf drive` refuses and names the setting to change in `.kf/config.json`; there is no sequential fallback on the main checkout. | Exit 1; nothing changed. |
| `harness.verify.stage` is missing | `kf drive` refuses and names the missing config key. | Exit 1; nothing changed. |
| A drive for this item is already live (including two racing `kf drive` calls) | The second `kf drive` is refused; at most one drive holds the item. | Exit 1; message names the running drive and suggests `--status` or `--stop`. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A stop condition occurs mid-drive. The stop codes are `loop_limit`, `requirement_bug`, `worker_blocked` (a worker returned BLOCKED or NEEDS_CONTEXT), `plan_change_needed` (a task touched files outside its allowlist; runs already in progress finish and go through the normal pipeline first), `tasks_blocked` (no task can progress), `verify_failed` (`harness.verify.stage` failed), `transition_refused` (stage transition refused or its hook failed), `approval_changed`, `config_changed` (`harness.roles`, `harness.runners`, `harness.verify` or `worktree.enabled` differ from the hash at drive start), `budget`, `git_error` (`merge --abort` or the reset to the pre-merge commit failed; the task is `blocked` with git's message), `stopped_by_user` and `crashed` (supervisor pid dead). | The driver stops at the next step boundary (no new run starts; runs already in progress finish and their results go through the normal pipeline), records the stop code and a one-line reason in `.kfw.json`, runs `drive-stop.sh` with `KFW_DRIVE_RESULT=stopped` when that hook exists, and keeps all worktrees and branches. | `kf drive --status` prints the stop code, the reason and the exact next command; the item is not advanced further. Repair-loop and failure details are in UC-005, UC-006, UC-007 and UC-008. |

## Postconditions
- On success the item is in `review` with a PASS report and drive state says "ready for ship decision".
- Every task is `done`, merged into the item branch and verified; clean task worktrees are removed.
- Nothing was shipped, merged to the default branch or archived; the ship decision stays human.
- `runs/drive-<id>.jsonl` holds one line per task state change, verify result, merge, stage move and stop; `kf runs` shows the task id for task runs.
- On a stop, all worktrees and branches are kept and the stop code, reason and next command are available from `--status`.

## Business Rules
- `kf drive` starts only from `implementation` with a current approval; start and ship gates are human.
- The driver never passes `--force` or `--skip-hooks`; stage moves go through the typed stage transition with the normal gates and hooks, which has no bypass option.
- Concurrency (FR-005): one drive per item, one live run per task id; a stage-level `kf run` is refused while a drive or task run of the item is live.
- Stops happen at the next step boundary; no new run starts after a stop condition is seen.
- `drive-stop.sh` is an opt-in hook: documented in `docs/workflow/autoconfig.md`, not seeded into `.kf/hooks/`.
- The task harness requires `worktree.enabled: true`; no silent fallback.
- A task is `done` only after allowlist, merge and `verify.task` pass; worker STATUS alone never counts. An allowlist violation blocks the task at once (no retry) and stops the drive with `plan_change_needed`.
- Two tasks with overlapping `Files` patterns never run at the same time; a "files unknown" task runs alone.
- Merges into the item branch are serialized, one at a time.
- Task worktree and branch names are siblings of the item's (`<item-branch>--task-###`, `<baseDir>/<feature>.tasks/task-###`).
- Commands kf executes come only from `harness.verify` in `.kf/config.json`.
- A `kind: bug` item uses one implementation-role run and no DAG.
- Workers never commit and never move stages; kf owns commits, merges and transitions.

## Data
- `.kfw.json`: `tasks` map (state, reason, attempts, branch, base, merge sha) and `drive` (step, loop count, run count, stop code, stop reason, config hash) for the item.
- `.kf/config.json`: `harness.roles`, `harness.stages`, `harness.verify.task|stage`, `harness.parallel`, `worktree.enabled`.
- Implementation plan Task Breakdown: `Task`, `Dependencies`, `Role`, `Files` columns.
- `runs/drive-<id>.jsonl`: event log for the drive.
- Run records: `kf runs` entries carrying the task id.
- Task branch and worktree: `<item-branch>--task-###`, `<baseDir>/<feature>.tasks/task-###`.

## Acceptance Criteria
- [ ] With passing fake workers, an approved item ends in `review` with a PASS review report and `kf drive --status` shows result `ready` and "ready for ship decision"; the item is not in `shipping` or `dones` and has no `meta.ship` (TC-014).
- [ ] With `parallel` 3, four independent tasks with disjoint files and a fifth sharing a file with the first, the fake runner's start/end timestamps show never more than three concurrent workers and, at some moment, exactly three, and the overlapping pair never running at the same time (TC-012).
- [ ] While tasks run, `git worktree list` shows task worktrees at `<baseDir>/demo.tasks/task-00n` on branches `<item-branch>--task-00n`, and no task route or port is written (TC-012).
- [ ] `kf drive` on an approved item in planning or backlog exits 1 naming `kf stage <f> implementation`, and on an item with pending approval exits 1 naming `kf approve <f>`; nothing is written (TC-013).
- [ ] With `worktree.enabled: false`, `kf drive` exits 1 naming `worktree.enabled` and changes nothing.
- [ ] `kf drive` refuses to start when `harness.verify.stage` is missing.
- [ ] Of two `kf drive` calls started concurrently for the same item, exactly one starts and the other exits 1 naming it (TC-025); a stage-level `kf run` while a drive or task run is live is refused (TC-033).
- [ ] A `kind: bug` item drives through one implementation-role run, verify, testing and review without a task table.
- [ ] `kf worktree list` does not list a running task's worktree as an orphan; `kf archive` removes clean task worktrees.
- [ ] `kf runs` shows the task id for task runs and `runs/drive-<id>.jsonl` contains task, verify, merge, stage and stop events (TC-014).
- [ ] A spy on stage transitions records every driver-initiated transition across the stop scenarios, and none carries `--force` or `--skip-hooks` (TC-034).
- [ ] Every stop prints one reason and one next command, and `--status` shows the stop code (TC-034).
- [ ] `kf archive` removes the clean task worktree and reports the kept branch of a blocked task; `kf cancel` refuses naming a dirty task worktree and changes nothing (TC-032).

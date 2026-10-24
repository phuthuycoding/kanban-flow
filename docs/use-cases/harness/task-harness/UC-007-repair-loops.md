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
| ID | UC-007 |
| Name | Testing or review fails and the driver runs bounded repair loops |
| Requirement reference | FR-012, FR-015 |
| Goal | When a testing or review report says FAIL or REJECT, the driver repairs the item itself, re-verifies and re-tests, but only a bounded number of times, and stops immediately on any condition that needs a human. |
| Primary actor | kf driver |

## Supporting Actors
- Worker agent: the implementation role runs one repair run pointed at the failing report; testing and review roles produce the reports.
- Owner / operator: receives the stop reason and next command, and decides what to do after a stop.
- Hook layer: stage hooks and the opt-in `drive-stop.sh` hook run as part of transitions and at stop.

## Preconditions
- A `kf drive` is running for the item (see UC-004) and has reached the `testing` or `review` step.
- `harness.verify.stage` is configured, and `harness.maxLoops` (default 2) and `harness.budget.maxRuns` (default 30) are in effect.
- The driver holds the hash of `harness.roles`, `harness.runners`, `harness.verify` and `worktree.enabled` and the approval fingerprint taken when the drive started.
- A testing or review worker has just written its report for the current execution.

## Trigger
After a testing or review role finishes, `kf validate` reads the report and finds a verdict of FAIL or REJECT.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf driver | Reads the verdict of the testing or review report via `kf validate` and finds FAIL or REJECT. | A repair loop is needed. |
| 2 | kf driver | Compares the loop count with `harness.maxLoops`. | Loop count is below the limit; the loop proceeds. |
| 3 | kf driver | Checks the stop conditions at the step boundary: approval fingerprint, config hash (`harness.roles`, `runners`, `verify`, `worktree.enabled`), and run count against `harness.budget.maxRuns`. | All unchanged and within budget. |
| 4 | kf driver | Moves the item back to `implementation` through the typed stage transition (gates and hooks apply; it has no `--force` or `--skip-hooks` option). | Item is in `implementation`; loop count is incremented and stored in the drive state. |
| 5 | kf driver | Runs one repair run of the implementation role (resolved per FR-004) in the item worktree, using the existing repair-loop prompt pointed at the failing report. | Run record is written; run count is incremented. Worker returns DONE or DONE_WITH_CONCERNS. |
| 6 | kf driver | Runs the `harness.verify.stage` commands in the item worktree. | All commands exit 0. |
| 7 | kf driver | Moves the item to `testing` and runs the testing role(s), then `kf validate`. | A new report is written for the new execution. |
| 8 | kf driver | On PASS continues to `review` and the review role(s) as in UC-004; on FAIL or REJECT returns to step 1. | The drive reaches "ready for ship decision" or loops again within the bound. |

## Alternative Flows
### A1
- Trigger: The review report (not testing) is FAIL or REJECT.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The driver treats the review report exactly like a testing report: moves back to `implementation`, repairs, verifies. | Same bounded loop; the loop counter is shared between testing and review. |
| A1.2 | After the repair the driver re-enters `testing`, not `review`. | Return to main flow step 7. |

### A2
- Trigger: `harness.verify.stage` fails after the repair run (step 6).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The driver does not enter testing. It records the verify failure with the output tail in the drive event log. | The drive stops with code `verify_failed`, the verify output tail as the reason and one next command; it does not consume another loop on its own. |

### A3
- Trigger: The loop count has already reached `harness.maxLoops` when a FAIL or REJECT arrives.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The driver stops at the step boundary without moving the item back. | Stop code `loop_limit`, reason "maxLoops reached (N)" with the report path and the next command; `drive-stop.sh` (opt-in hook) runs with `KFW_DRIVE_RESULT=stopped` when present. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Report verdict is REQUIREMENT_BUG | Driver stops at the step boundary; no repair run, since the defect is in the requirement, not the code. | Stop code `requirement_bug`; reason names the report and the human step to revise the requirement. |
| A worker (repair, testing or review) reports BLOCKED or NEEDS_CONTEXT | Driver stops at the step boundary and surfaces the worker's STATUS text. | Stop code `worker_blocked`; reason names the role and the question. |
| The stage transition back to `implementation` or onward is refused (gate failure) | Driver stops with the transition's refusal message; it never retries with a bypass. | Stop code `transition_refused`; reason holds the refusal text. |
| A stage hook fails during a transition (for example `.kf/hooks/testing.sh` exits 1) | Driver stops and includes the hook's output. | Stop code `transition_refused`; reason holds the hook output. |
| The approval fingerprint changed since the drive started (the plan was edited) | Driver stops at its next step boundary; no new run starts. | Stop code `approval_changed`; next command is `kf approve <feature>`, then `kf drive <feature>`. |
| `harness.roles`, `harness.runners`, `harness.verify` or `worktree.enabled` differ from the hash taken at drive start | Driver stops at its next step boundary; no new run starts and a worker already running finishes its current run. With `worktree.enabled` flipped to `false`, the drive finishes its running tasks, then stops. | Stop code `config_changed`; reason names which section changed; re-running `kf drive` re-takes the hash and continues (UC-008). |
| `harness.budget.maxRuns` is reached (task runs, retries and repair runs count) | Driver starts no further worker run. | Stop code `budget`; reason names the run count (for example 2/2). |

## Postconditions
- On eventual PASS of both reports: item is in `review` with a PASS report, nothing shipped or archived, and `kf drive --status` says "ready for ship decision".
- On any stop: the item is left in the stage it was in, the drive state holds the loop count, run count, stop code and stop reason, and `drive-stop.sh`, when present, has run with `KFW_DRIVE_RESULT=stopped`.
- The number of repair loops in a drive never exceeds `harness.maxLoops`; the number of worker runs never exceeds `harness.budget.maxRuns`.
- Every loop step (stage move, repair run, verify result, stop) is recorded as one line in `runs/drive-<id>.jsonl`.

## Business Rules
- A repair loop is one pass: back to implementation, one implementation-role repair run, `verify.stage`, then testing. Testing and review share one loop counter.
- The loop limit is `harness.maxLoops` (default 2); after that many repair loops the driver stops rather than starting another.
- The run limit is `harness.budget.maxRuns` (default 30) and counts task runs, task retries and repair runs.
- The driver never passes `--force` or `--skip-hooks` (observable: a spy on stage transitions sees no bypass flag, TC-034) and never edits reports or the plan.
- A change to `harness.roles`, `harness.runners`, `harness.verify` or `worktree.enabled` is detected by comparing a hash taken at drive start, so the executed commands and roles stay what the human pinned.
- Stops happen at the next step boundary: no new run starts after a stop condition is seen.
- Stop codes used here: `loop_limit`, `requirement_bug`, `worker_blocked`, `verify_failed`, `transition_refused`, `approval_changed`, `config_changed`, `budget` (the full set, with `plan_change_needed`, `tasks_blocked`, `git_error`, `stopped_by_user` and `crashed`, is in UC-004).
- Every stop prints one stop code, one reason and one next command; `--status` shows all three.

## Data
- Drive state (`.kfw.json`): current step, loop count, run count, stop code, stop reason, config hash (roles, runners, verify, `worktree.enabled`) and approval fingerprint.
- Testing / review report: carries the verdict (PASS, FAIL, REJECT, REQUIREMENT_BUG) and the findings used by the repair prompt.
- Run record: one per worker run, with role, status and run id.
- Drive event log: `runs/drive-<id>.jsonl` in the item folder.
- Config: `harness.maxLoops`, `harness.budget.maxRuns`, `harness.verify.stage`.

## Acceptance Criteria
- [ ] A FAIL testing report followed by PASS triggers exactly one repair loop: the item moves to implementation, one implementation-role run happens whose prompt names the FAIL report, `verify.stage` runs, the item re-enters testing, then review PASS (TC-021).
- [ ] With `maxLoops: 1` and a tester that always FAILs, the drive stops with code `loop_limit` after one loop and the item is not moved back again (TC-021).
- [ ] A REJECT review report is repaired through the implementation and testing steps before review PASS (TC-021).
- [ ] Each variant stops with its code and no new run record appears after the stop: REQUIREMENT_BUG report `requirement_bug`; `.kf/hooks/testing.sh` exiting 1 `transition_refused`; `harness.roles` edited mid-drive `config_changed`; plan edited mid-drive `approval_changed`; `verify.stage` failing after the DAG `verify_failed` (TC-034).
- [ ] A task worker editing `harness.verify` in `.kf/config.json` mid-drive stops the drive at the next step boundary with `config_changed` and no further run starts; a worker printing `STATUS: BLOCKED` stops it with `worker_blocked` (TC-023).
- [ ] With `budget.maxRuns: 2`, `parallel: 1` and three independent tasks, the drive stops with code `budget` naming 2/2 runs and there is no third run record; `drive-stop.sh`, when present, receives `KFW_DRIVE_RESULT=stopped` (TC-022, TC-030).
- [ ] Every stop prints one reason and one next command, and a spy on stage transitions shows no call carrying `--force` or `--skip-hooks` (TC-034).

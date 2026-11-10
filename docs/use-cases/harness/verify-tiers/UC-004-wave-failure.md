---
feature: verify-tiers
context: harness
created: 20261109_1701
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Trace a wave failure back to a task |
| Requirement reference | FR-005 (builds on FR-003, FR-004) |
| Goal | A failed wave verify is traced to the task(s) that broke it, or ruled flaky, so the loop reopens the right work and the wave verify runs again |
| Primary actor | Agent session |

## Supporting Actors
- kf CLI (`kf verify`, `kf next`, `kf record`, `kf loop-stats`)

## Preconditions
- `harness.verify.stage` is pinned, so the wave tier exists.
- Every task of wave `<w>` is complete and `kf next` printed `verify wave <w>: kf verify <f> --wave <w>`.
- The session ran `kf verify <f> --wave <w>`, which wrote a stage record tagged with the wave and `loop/wave-<w>-verify.log`.

## Trigger
`kf verify <f> --wave <w>` exits 1 (a stage command failed).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent session | Records `wave <w>: verify done exit=1` through `kf record … wave-verify-done <w> --exit 1` | The ledger holds the failed run |
| 2 | kf CLI | `kf next` reads the ledger and the latest wave-`<w>` record | Prints `decide (Wave verify): wave <w> failed — closes with Note TASK-NNN: reopened — wave <w> or Note wave <w>: decided — <what>` |
| 3 | kf CLI | Applies the barrier (FR-004) | Every later-wave developer stays held as `wait TASK-NNN: wave <w> verify`; later-wave test-writers are not held |
| 4 | Agent session | Reads `loop/wave-<w>-verify.log` and traces the failing test files to a task's Files by the evidence rule (else a `Ruling:`) | One or more tasks of wave `<w>` are named |
| 5 | Agent session | Writes `Note TASK-NNN: reopened — wave <w>` through `kf record … line` | The Wave verify decide is closed for that task |
| 6 | kf CLI | Treats the line as a reopen source beside `testing\|review\|ci`, carrying a wave number and no execution id | The task reopens as a review reopen does: its round count continues and a new `complete` line is owed; `kf loop-stats` reads it as a reopen |
| 7 | Agent session | Runs the reopened task through the loop until it is complete again | Its new commit is not contained in the failed record's sha |
| 8 | kf CLI | `kf next` sees every task of wave `<w>` complete | Prints `verify wave <w>: kf verify <f> --wave <w>` again; later waves stay held until a passing record contains every wave commit |

## Alternative Flows
### A1
- Trigger: the evidence names several tasks of the wave

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The session writes one `Note TASK-NNN: reopened — wave <w>` per traced task | Each task reopens independently |
| A1.2 | The wave verify is owed again only once every reopened task is complete again | Returns to step 8 |

### A2
- Trigger: the failure is flaky or environmental and no task owns it

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The session writes `Note wave <w>: decided — <what>` through `kf record … line` | The Wave verify decide is closed; no task reopens |
| A2.2 | `kf next` owes a new wave verify run | Prints `verify wave <w>: kf verify <f> --wave <w>`; returns to step 8 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf verify <f> --wave <w>` exits 3 (bad wave, bad option combination, missing worktree path) | Nothing ran and nothing was written, so no failed record exists | `kf next` prints a decide naming the call to fix; it is closed by a new `wave <w>: verify started` or by `Note wave <w>: decided — <what>` |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A task named in `Note TASK-NNN: reopened — wave <w>` is already at its round cap | The existing cap stop applies; this use case adds no new rule | The loop stops on that task as it does for a review reopen |

## Postconditions
- Each traced task is reopened with its round count continued and owes a new `complete` line, or the decided note closed the decide.
- A new wave verify is owed; later-wave developers stay held until a passing record contains every wave commit.
- Exit 2 cannot occur for a wave verify.

## Business Rules
- Tracing uses the existing evidence rule: failing test files against each task's Files, else a `Ruling:`; kf does not trace.
- Both new lines go through `kf record … line`; `TASK-NNN:` readers (travel, `kf loop-stats`) keep working unchanged.
- The wave verify runs in a detached worktree, so later-wave failing tests written ahead do not affect the run.

## Data
- Ledger `loop/progress.md`: `wave <w>: verify started|done exit=<n>`, `Note TASK-NNN: reopened — wave <w>`, `Note wave <w>: decided — <what>`.
- Stage record `<item>/loop/stage-verify.jsonl`: `wave`, `sha`, `exit`, `clean`.
- Log `<item>/loop/wave-<w>-verify.log`: the failing output the session traces.

## Acceptance Criteria
- [ ] A wave verify exit 1 makes `kf next` print `decide (Wave verify): wave <w> failed — closes with Note TASK-NNN: reopened — wave <w> or Note wave <w>: decided — <what>` while later-wave developers stay held with `wait TASK-NNN: wave <w> verify`. (TC-019)
- [ ] `Note TASK-NNN: reopened — wave <w>` is accepted by `kf record` and `kf next`, reopens that task as a review reopen does (round count continues, a new `complete` line owed), and the wave verify is owed again once every reopened task is complete. (TC-019)
- [ ] Several reopened tasks each reopen, and the wave verify is owed only after all are complete again. (TC-019)
- [ ] `Note wave <w>: decided — <what>` closes the Wave verify decide, reopens no task and owes a new wave verify run. (TC-020)
- [ ] After exit 3 `kf next` prints a decide naming the call to fix, closed by a new `wave <w>: verify started` or the decided note. (TC-020)
- [ ] A reopened task at its round cap hits the existing cap stop. (TC-019)

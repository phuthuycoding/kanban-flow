---
feature: loop-throughput
context: harness
created: 20261101_1349
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Resume a loop with two tasks in flight |
| Requirement reference | FR-010, FR-011, FR-014 |
| Goal | Continue a pipelined loop after compaction or in a new session from the ledger alone |
| Primary actor | Controller |

## Supporting Actors
- Travel (reads the same ledger)

## Preconditions
- `loop/progress.md` has timestamped lines in the FR-014 grammar

## Trigger
A session loads `kanban-implement` for an item already in implementation.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Reads the ledger and rebuilds each incomplete task's state | States known |
| 2 | Controller | Takes only the head and next task (the two earliest incomplete); resumes each at its first unmet step in FR-011's eleven-step order: test-writer missing / open, developer missing (under FR-004's gates, queued) / open, verify not started / unfinished, reviewer missing / open, latest findings or kept exit 1 with no later developer dispatch → next fix round (queued; breaker at the cap), `fix queued` → re-queue, owed cascade → its re-review | Loop resumes inside the window |
| 3 | Controller | Sends a task to the completion check only after step 2 finds nothing unmet; it completes with `developer done`, a latest verify `exit=0` (or fully routed to the other task), a `clean` latest review or every open finding parked at the cap, and no unanswered cascade | Completion earned |
| 4 | Controller | Never re-dispatches a seat of a `complete` task; never adds a second ` @ ` suffix | Ledger consistent |

## Alternative Flows
### A1
- Trigger: The ledger has no timestamps (written before this feature)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Resume by the old rule: the last line per task; `kf loop-stats` will report the ledger untimed | Continues |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A line does not parse | Controller reads it as prose and records a `Ruling:` on how it resumed | No silent skip |

## Postconditions
- Exactly the in-flight seats were re-dispatched

## Business Rules
- Every line after the header ends with ` @ <ISO with offset>`
- Commit fields are commit lists

## Data
- The nine FR-014 shapes: seat dispatched/done, verify started/done, developer waits, fix queued, fix round R/5, cascade re-review owed, complete

## Acceptance Criteria
- [ ] Every ledger line after the header ends with ` @ <ISO>` and seat lines match the grammar; `grep -c "fix round"` equals the fix rounds (FR-010, FR-014)
- [ ] A fresh session resumes each incomplete task at its first unmet step (open seat, missing developer, unfinished verify, queued fix, owed cascade); no task completes without `developer done`, `verify done exit=0` and a clean review (FR-011)

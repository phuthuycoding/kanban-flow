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
| ID | UC-004 |
| Name | Cascade re-review after a fix of an earlier task |
| Requirement reference | FR-005 |
| Goal | Re-check the next task X when the head task H changed after X started building on it |
| Primary actor | Controller |

## Supporting Actors
- code-reviewer seat
- `review-package --commits`

## Preconditions
- Developer N+1 was dispatched before a fix round of task N committed

## Trigger
A fix commit of task N lands after `TASK-N+1: developer dispatched`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Ledgers `TASK-N+1: cascade re-review owed — after <fix sha7> of TASK-N` | Cascade owed |
| 2 | Controller | After task N+1's own review, dispatches `TASK-N+1: code-reviewer dispatched model=… round=<R> cascade=<fix sha7>` with `references/re-review-brief.md`, N+1's commit list and N's fix diff | Scoped re-review |
| 3 | Code-reviewer | Judges whether N+1 still holds against the fixed N | Findings or clean |
| 4 | Controller | Its `code-reviewer done` answers the owed line; clean → N+1 may complete once N is complete; findings → N+1's fix loop (queued per FR-003) | Resolved |

## Alternative Flows
### A1
- Trigger: Several fixes of N land after N+1's dispatch

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | One `cascade re-review owed` line per fix, each answered by its own re-review with `cascade=` that fix's sha7 | Rejoins at step 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| N+1's own review comes back clean before N's fix commits | N+1 is not marked complete: it waits for `TASK-N: complete` and then for the cascade re-review (FR-005) | N+1 completes after N |

## Postconditions
- N+1 has been reviewed against the post-fix N

## Business Rules
- Unconditional: no file intersection decides it
- Task N+1 never completes before task N

## Data
- Cascade line; N's fix diff in the re-review brief

## Acceptance Criteria
- [ ] A fix of TASK-001 after `TASK-002: developer dispatched` produces `TASK-002: cascade re-review owed — after <sha7> of TASK-001`, answered by a `cascade=<sha7>` re-review and a re-review of TASK-002 whose brief holds TASK-001's fix diff
- [ ] No fix after N+1's dispatch → no cascade line
- [ ] `TASK-N+1: complete` is never written before `TASK-N: complete` or before the owed line's answer

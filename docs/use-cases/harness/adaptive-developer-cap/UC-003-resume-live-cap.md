---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Resume rebuilds the live cap from the ledger |
| Requirement reference | FR-005 |
| Goal | Continue after compaction or in a new session with the same N and owed re-runs |
| Primary actor | Controller session |

## Supporting Actors
- `kf` CLI

## Preconditions
- The item has a ledger `<item>/loop/progress.md`

## Trigger
The controller resumes the loop

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Takes N from the latest `Ruling: developer cap` line, or min(2, max) when there is none | N rebuilt |
| 2 | Controller | Caps N at the current `developers.max`; a lowered max is ledgered as a cap ruling | N ≤ ceiling |
| 3 | Controller | A `Note TASK-NNN: verify rerun` with no later `verify started` of that task → runs the re-run, never a fix round | Owed re-run done |
| 4 | Controller | A latest contention-shaped `verify done exit=1` with no later rerun note → owes UC-002 steps | Step-down applied once |
| 5 | Controller | Decides, in wave order, the step-up of each complete wave with none decided | Missed step-ups applied |

## Alternative Flows
### A1
- Trigger: Ledger predates this feature

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | No cap ruling: start at min(2, max); old `4 developers in flight` lines still parse in `kf loop-stats` | Return to the main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Seats in flight above a lowered N | They finish; no new developer until fewer than N | Never cancelled |

## Postconditions
- Two controllers reading the same ledger reach the same N

## Business Rules
- The ledger is the only source of N

## Data
- Ledger: `<item>/loop/progress.md` cap rulings, wait lines, rerun notes
- Config: `.kf/config.json` `harness.developers.max`

## Acceptance Criteria
- [ ] The skill states resume rules (a)–(d)
- [ ] `kf loop-stats` parses a live-cap ledger with an empty unparsed list

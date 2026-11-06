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
| ID | UC-001 |
| Name | Start the loop at the low cap and step up after clean waves |
| Requirement reference | FR-001, FR-002, FR-004, FR-007 |
| Goal | Run as many developers in parallel as the project has shown it can take |
| Primary actor | Controller session |

## Supporting Actors
- `kf` CLI

## Preconditions
- The item is in implementation with an approved plan whose `Execution:` lines name the waves
- `kf tasks <f> --json` returns `developers.max`

## Trigger
The controller starts the task loop of an item (first developer dispatch)

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Reads `developers.max` from `kf tasks <f> --json` | Ceiling known (default 6) |
| 2 | Controller | Ledgers `Ruling: developer cap <min(2,max)> — start — cost if wrong: …` | N set |
| 3 | Controller | Dispatches developers under the dispatch conditions while fewer than N developer seats are in flight; a held seat ledgers `developer waits — <N> developers in flight` | At most N developers run |
| 4 | Controller | When a parallel wave w and every earlier wave are complete and w had no contention-shaped failure, raises N by 1 | `Ruling: developer cap <old> → <new> — wave <w> clean — cost if wrong: …` |
| 5 | Controller | Repeats per wave, in wave order | N grows one step per clean parallel wave |

## Alternative Flows
### A1
- Trigger: A later wave completes before an earlier one

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Its step-up waits until every earlier wave is complete and decided, then is decided in wave order | Return to the main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| N already equals the ceiling or the widest incomplete wave | No step-up; nothing ledgered | N unchanged |
| The wave is inline | No step-up | N unchanged |

## Postconditions
- N ≤ ceiling at all times
- Every change of N has a `Ruling: developer cap` line

## Business Rules
- Start = min(2, `harness.developers.max`)
- Only parallel waves step up
- Step-ups are decided in wave order

## Data
- Ledger: `<item>/loop/progress.md` cap rulings, wait lines, rerun notes
- Config: `.kf/config.json` `harness.developers.max`

## Acceptance Criteria
- [ ] The skill states the start ruling, the ceiling source, the wave-order step-up, the parallel-only rule and both bounds
- [ ] With `harness.developers.max: 1` the start ruling names 1 and no step-up is possible

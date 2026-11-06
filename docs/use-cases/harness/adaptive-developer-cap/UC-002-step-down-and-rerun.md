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
| ID | UC-002 |
| Name | Step down on a contention-shaped verify failure and re-run once |
| Requirement reference | FR-003 |
| Goal | Tell contention apart from a real failure and lower the load |
| Primary actor | Controller session |

## Supporting Actors
- `kf` CLI

## Preconditions
- A task's controller verify (`verify started` … `verify done exit=1`) has failed

## Trigger
The verify output contains a contention signature

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Matches the output against the signature list (`EADDRINUSE`, `index.lock`, `database is locked`, `SQLITE_BUSY`, `Lock wait timeout exceeded`, `ETIMEDOUT`, `ECONNREFUSED`, `Test timed out`, `Hook timed out`) | Failure classified contention-shaped |
| 2 | Controller | Unless N already dropped since that verify started, sets N = max(1, ⌊N/2⌋) and ledgers `Ruling: developer cap <old> → <new> — <signature> in TASK-NNN verify — cost if wrong: …` | N halved once per contention event |
| 3 | Controller | Ledgers `Note TASK-NNN: verify rerun — contention <signature>` | Re-run owed |
| 4 | Controller | Dispatches no new developer, and waits, until fewer than N developer seats are in flight | Load reduced; seats in flight finish, none cancelled |
| 5 | Controller | Re-runs the verify once (`verify started` / `verify done`) | Pass: check completes with no fix round |

## Alternative Flows
### A1
- Trigger: The re-run fails

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The failure is ordinary: fix loop, or the other-task routing rule, which applies only after the re-run | Return to the main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No signature in the output | Ordinary failure, no step-down, no re-run | Fix loop as today |
| N is 1 | N stays 1; the re-run still happens | N = 1 |

## Postconditions
- N ≥ 1
- The wave of the failing task is not clean

## Business Rules
- Only ledgered controller verifies count; `kf verify --stage` and developers' own runs do not
- One halving per contention event

## Data
- Ledger: `<item>/loop/progress.md` cap rulings, wait lines, rerun notes
- Config: `.kf/config.json` `harness.developers.max`

## Acceptance Criteria
- [ ] The skill lists the exact signatures, the counting rule, the once-per-event halving, the Note line, the dispatch hold and the single re-run

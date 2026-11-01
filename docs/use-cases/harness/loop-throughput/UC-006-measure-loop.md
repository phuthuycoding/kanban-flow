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
| ID | UC-006 |
| Name | Measure a loop and record it |
| Requirement reference | FR-012, FR-014, FR-015, FR-016, FR-017 |
| Goal | Turn a finished loop's ledger into time buckets, keep them in the history and hand them to travel |
| Primary actor | Controller |

## Supporting Actors
- `kf loop-stats`
- Travel `measure`
- Human

## Preconditions
- All tasks have a `complete` line
- The ledger is timestamped

## Trigger
The last task completes.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Runs `kf loop-stats <f> --record` | Report printed; row written to `.works/loop-metrics.md` |
| 2 | `kf loop-stats` | Computes wall-clock, per-seat and verify count/sum/median, seat, busy (seat ∪ verify), saved, controller, waits, fix rounds, cascades, tasks, per-model minutes; pairs each `done` with the latest unmatched `dispatched`; lists orphan `dispatched`, unparsed and untimed lines | Figures |
| 3 | Controller | Runs `kf loop-stats --all` and prints the item report and the `largest:` line beside "Rulings I made" | Human sees where time went |
| 4 | Travel | At measure, takes implementation `--work`/`--review` from `kf loop-stats <f> --json` (seat minutes with verify excluded, code-reviewer minutes) | Learned factor gets measured input |

## Alternative Flows
### A1
- Trigger: `kf loop-stats <f>` without `--record` mid-loop

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Reports with wall-clock to the last timestamped line and says `in progress`; writes nothing | Informational |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Ledger missing or no timestamped seat line | Exit 1 saying so | Travel falls back to notifications |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `--record` while a task lacks `complete` | Exit 1 naming the tasks | Nothing written |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| History file header differs | Exit 1 naming the file; other rows untouched | Human decides |

## Postconditions
- `.works/loop-metrics.md` holds one row for the feature

## Business Rules
- Intervals computed in UTC from offset timestamps
- The loop reports; it changes no rule from the numbers

## Data
- History row: date · feature · tasks · wall · busy · controller · saved · waits · test-writer · developer · automation-writer · code-reviewer · verify · rounds · cascades · untimed (integer minutes)

## Acceptance Criteria
- [ ] On a fixture ledger the figures equal hand-computed values; orphan, unparsed and untimed lines are listed (FR-012)
- [ ] `--record` twice leaves one row; incomplete loop exits 1 (FR-015)
- [ ] The final message carries the report and `largest:` (FR-016)
- [ ] Travel's measure uses `kf loop-stats` seat minutes when timestamped (FR-017)

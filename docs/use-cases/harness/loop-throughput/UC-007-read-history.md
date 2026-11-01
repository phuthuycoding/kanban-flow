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
| ID | UC-007 |
| Name | Read the history across loops |
| Requirement reference | FR-015 |
| Goal | See which time bucket dominates across loops, to choose the next improvement |
| Primary actor | Human |

## Supporting Actors
- `kf loop-stats --all`

## Preconditions
- `.works/loop-metrics.md` has at least one row

## Trigger
The human (or the controller at loop end) runs `kf loop-stats --all`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | `kf loop-stats` | Reads the history rows | Rows |
| 2 | `kf loop-stats` | Prints the rows, the median of each column, and the median minutes per task of controller, test-writer, developer, code-reviewer, verify and waits | Summary |
| 3 | `kf loop-stats` | Prints `largest: <bucket> <n> min/task` | Next-lever candidate named |

## Alternative Flows
### A1
- Trigger: `--json`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Same data as JSON | Machine-readable |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No history file | Exit 1 `no loop measured yet` | Nothing printed beyond the message |

## Postconditions
- Nothing written

## Business Rules
- Read-only

## Data
- Seat buckets overlap in time, so buckets are compared in median minutes per task, not as shares of wall-clock

## Acceptance Criteria
- [ ] With two fixture rows, `--all` prints the column medians, the six per-task bucket minutes and a `largest:` line naming the bucket with the biggest median minutes per task (FR-015)

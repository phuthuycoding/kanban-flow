---
feature: loop-throughput
context: harness
created: 20261101_1349
status: archived
---
# Use Case

> **Partly superseded by `parallel-developers`:** same-wave developers are no longer held to one at a time — up to 4 run when their Files are disjoint. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Run the test-writers of same-wave tasks with disjoint Files at the same time |
| Requirement reference | FR-006 |
| Goal | Write the failing tests of several same-wave tasks at once when their Files cannot collide |
| Primary actor | Controller |

## Supporting Actors
- test-writer seats
- `kf tasks --json`

## Preconditions
- The head task and the next task are in one wave (FR-003 window: no third task starts)

## Trigger
The controller reaches a wave with several ready tasks.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Reads `kf tasks <f> --json`; checks the head and next task's `overlaps` | Disjoint pairs known |
| 2 | Controller | Ledgers `wave <w>: parallel test-writers TASK-A, TASK-B — disjoint Files` and dispatches both test-writers | Two test-writers in flight |
| 3 | Controller | Runs the developers of TASK-A then TASK-B one after another (FR-003), pipelined as in UC-001 | One developer at a time |

## Alternative Flows
### A1
- Trigger: `overlaps` of TASK-A names TASK-B

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Ledger `wave <w>: sequential TASK-A, TASK-B — Files overlap <entry> / <entry>` (or `— Files unknown`) | Test-writers run one after another |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf tasks` reports an invalid task graph | Controller stops: a plan too broken to act on | Reported to the human |

## Postconditions
- Every test-writer ran inside its own Files

## Business Rules
- Disjoint means `filesOverlap(a, b)` in `src/workflow/allowlist.ts` is false
- A task without Files overlaps every other

## Data
- `overlaps`: `{ task, entries: [this entry, other entry] | null }[]`

## Acceptance Criteria
- [ ] `kf tasks --json` lists `overlaps` with the entry pair; `src/**/*.ts` vs `src/x` overlap
- [ ] A disjoint pair shows a `parallel test-writers` line and overlapping test-writer intervals; an overlapping pair shows a `sequential … Files overlap` line
- [ ] Developer intervals of the wave never overlap

---
feature: loop-throughput
context: harness
created: 20261101_1349
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Pipeline two neighbouring tasks in one worktree | [UC-001](UC-001-pipeline-neighbour-tasks.md) | Controller | implemented |
| UC-002 | Run the test-writers of same-wave tasks with disjoint Files at the same time | [UC-002](UC-002-parallel-same-wave.md) | Controller | implemented |
| UC-003 | Verify a task by its commit list in a clean checkout | [UC-003](UC-003-verify-by-commits.md) | Controller | implemented |
| UC-004 | Cascade re-review after a fix of an earlier task | [UC-004](UC-004-cascade-re-review.md) | Controller | implemented |
| UC-005 | Resume a loop with two tasks in flight | [UC-005](UC-005-resume-in-flight.md) | Controller | implemented |
| UC-006 | Measure a loop and record it | [UC-006](UC-006-measure-loop.md) | Controller | implemented |
| UC-007 | Read the history across loops | [UC-007](UC-007-read-history.md) | Human | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-003, FR-004, FR-007, FR-008, FR-009 | TC-016, TC-017, TC-018, TC-019, TC-020, TC-025, TC-030, TC-039 | Pipeline order, one developer, staging, controller work, verify beside review |
| UC-002 | FR-006 | TC-013, TC-014, TC-015, TC-021 | `overlaps`, parallel/sequential lines |
| UC-003 | FR-001, FR-002, FR-013 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-032, TC-038 | Commit-list verify and package, clean checkout |
| UC-004 | FR-005 | TC-022, TC-028 | Cascade line and brief |
| UC-005 | FR-010, FR-011, FR-014 | TC-023, TC-024, TC-029, TC-033 | Timestamps, grammar, per-task resume |
| UC-006 | FR-012, FR-015, FR-016, FR-017 | TC-026, TC-027, TC-031, TC-034, TC-035, TC-036 | `kf loop-stats`, `--record`, end report, travel input |
| UC-007 | FR-015 | TC-037 | `kf loop-stats --all`, `largest:` |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 7 |
| Actors | 5 |
| Functional requirements covered | 17 |
| Test cases linked | 39 |

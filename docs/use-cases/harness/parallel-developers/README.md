---
feature: parallel-developers
context: harness
created: 20261101_2158
status: archived
---
# Use Case Index

> **Partly superseded by `kf-next`:** the scheduling rules this doc puts in the `kf:implement` skill text (dispatch order, the live developer cap, contention, resume, fix-round and cascade routing) are now computed by `kf next` and ledger lines are written through `kf record`; the skill no longer states them. The behaviour itself still holds. Kept for history.

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Dispatch concurrent developers on ready, disjoint tasks | [UC-001](UC-001-dispatch-concurrent-developers.md) | Controller | implemented |
| UC-002 | Wait on an overlap or the cap | [UC-002](UC-002-wait-overlap-or-cap.md) | Controller | implemented |
| UC-003 | Commit a task with a shared index | [UC-003](UC-003-commit-shared-index.md) | Developer | implemented |
| UC-004 | Run focused tests while other developers edit | [UC-004](UC-004-focused-tests-concurrent.md) | Developer | implemented |
| UC-005 | Cascade a late fix to the fixed task's dependents | [UC-005](UC-005-cascade-to-dependents.md) | Controller | implemented |
| UC-006 | Resume with several developers in flight | [UC-006](UC-006-resume-open-seats.md) | Controller | implemented |
| UC-007 | Measure the parallelism | [UC-007](UC-007-measure-parallelism.md) | Human | implemented |
| UC-008 | Keep the controller working while seats run | [UC-008](UC-008-controller-work-list.md) | Controller | implemented |
| UC-009 | Show the plan's parallelism before approval | [UC-009](UC-009-plan-parallelism.md) | Planner | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-004, FR-005, FR-010 | TC-018, TC-019, TC-020, TC-027 | Cap, dispatch conditions, test-writers ahead, old rule gone, scenario run |
| UC-002 | FR-004 | TC-029 | Both wait lines parse; the wait rules themselves are pinned under UC-001 (TC-018) and run in TC-027 |
| UC-003 | FR-002, FR-003, FR-013 | TC-004, TC-005, TC-006, TC-007, TC-025 | `commit-task.mjs` behaviour, git command list |
| UC-004 | FR-001, FR-006 | TC-001, TC-002, TC-003, TC-021, TC-030 | Build setup exit codes, focused tests, `not mine:` |
| UC-005 | FR-007 | TC-022 | Out-of-order completion, dependency-only cascade |
| UC-006 | FR-008 | TC-023 | Every open seat re-dispatched first |
| UC-007 | FR-009, FR-010 | TC-013, TC-014, TC-017, TC-026 | Peak, overlap, report and JSON, docs |
| UC-008 | FR-011, FR-012 | TC-015, TC-016, TC-024, TC-028 | Work list, background rule, dispatch lag |
| UC-009 | FR-014 | TC-008, TC-009, TC-010, TC-011, TC-012 | `kf tasks --graph`, approval block |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 9 |
| Actors | 5 |
| Functional requirements covered | 14 |
| Test cases linked | 30 |

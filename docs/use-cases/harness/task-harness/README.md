---
feature: task-harness
context: harness
created: 20261024_1105
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Plan declares a task DAG with roles and files; validate catches bad graphs | [UC-001](UC-001-plan-task-graph.md) | Main agent (planning) | implemented |
| UC-002 | Inspect the task graph and progress | [UC-002](UC-002-inspect-tasks.md) | Owner / operator | implemented |
| UC-003 | Run one planned task by hand | [UC-003](UC-003-run-single-task.md) | Owner / operator | implemented |
| UC-004 | Drive an approved item from implementation to the ship gate | [UC-004](UC-004-drive-to-ship-gate.md) | Main agent / owner | implemented |
| UC-005 | Task fails allowlist or verification, retries, then blocks | [UC-005](UC-005-task-failure-retry.md) | kf driver | implemented |
| UC-006 | Task merge conflicts with a concurrent item-branch commit | [UC-006](UC-006-merge-conflict.md) | kf driver | implemented |
| UC-007 | Testing or review fails and the driver runs bounded repair loops | [UC-007](UC-007-repair-loops.md) | kf driver | implemented |
| UC-008 | Stop, crash, and resume a drive | [UC-008](UC-008-stop-resume-drive.md) | Owner / operator | implemented |
| UC-009 | Configure verify commands, limits and the drive-stop hook | [UC-009](UC-009-configure-harness.md) | Owner / operator | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-004, FR-019 | TC-001, TC-002, TC-003, TC-004, TC-005 | Graph errors reported separately; old plans parse; role resolution deterministic |
| UC-002 | FR-002 | TC-006, TC-007 | JSON and tasks.md agree; Baseline kept |
| UC-003 | FR-003, FR-004, FR-005, FR-006, FR-017 | TC-008, TC-009, TC-010, TC-033 | Dependency and worktree refusals; task run recorded with task id |
| UC-004 | FR-005, FR-006, FR-008, FR-011, FR-013, FR-017, FR-019 | TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-032, TC-036 | Parallel bound and overlap; ends at review PASS without shipping; bug path; worktree list/archive aware |
| UC-005 | FR-007, FR-010 | TC-017, TC-018 | Allowlist and verify failures; reset to pre-merge; retry then blocked |
| UC-006 | FR-008 | TC-019, TC-020 | Conflict blocks one task; dirty item worktree refused |
| UC-007 | FR-012, FR-015 | TC-021, TC-022, TC-023, TC-034 | Repair loop bounded; budget and config-change stops |
| UC-008 | FR-013, FR-014 | TC-024, TC-025, TC-026, TC-027, TC-035 | Resume skips done tasks; half merge recovered; lock; no lost records |
| UC-009 | FR-006, FR-009, FR-011, FR-015, FR-016, FR-018 | TC-028, TC-029, TC-030, TC-031 | Verify validation; refuse without verify.stage; hook env; doctor findings |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 9 |
| Actors | 4 |
| Functional requirements covered | 19 |
| Test cases linked | 36 |

---
feature: kf-next
context: harness
created: 20261107_2254
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Run a task loop from `kf next` | [UC-001](UC-001-run-loop.md) | Controller session | implemented |
| UC-002 | Resume a loop after compaction | [UC-002](UC-002-resume-loop.md) | Controller session | implemented |
| UC-003 | Handle a verify failure, a fix round and a cascade | [UC-003](UC-003-handle-failure.md) | Controller session | implemented |
| UC-004 | Run a bug's tasks | [UC-004](UC-004-run-bug.md) | Controller session | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-015, FR-018, FR-019, FR-021, FR-022 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-029, TC-030, TC-031, TC-036, TC-039, TC-040, TC-041, TC-043, TC-044, TC-048, TC-049, TC-050, TC-051, TC-052 | 25 cases |
| UC-002 | FR-012, FR-013, FR-015, FR-016, FR-020, FR-024 | TC-025, TC-026, TC-027, TC-032, TC-033, TC-037, TC-038, TC-053 | 8 cases |
| UC-003 | FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-014, FR-023, FR-025, FR-026 | TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024, TC-028, TC-045, TC-046, TC-047, TC-049, TC-054, TC-055 | 20 cases |
| UC-004 | FR-017 | TC-034, TC-035, TC-042 | 3 cases |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 3 |
| Functional requirements covered | 26 |
| Test cases linked | 55 |

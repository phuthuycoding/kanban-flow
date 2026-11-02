---
feature: researcher-agent
context: harness
created: 20261102_1044
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | A skill dispatches the researcher on its own | [UC-001](UC-001-auto-research.md) | Controller session | implemented |
| UC-002 | The human asks a spike question and the spike skill answers it | [UC-002](UC-002-spike-question.md) | Human | implemented |
| UC-003 | The controller unblocks a developer with research | [UC-003](UC-003-unblock-developer.md) | Controller session | implemented |
| UC-004 | A user with an old install runs kf install and moves to the kf plugin | [UC-004](UC-004-migrate-install.md) | Human | implemented |
| UC-005 | The controller runs a one-task wave inline | [UC-005](UC-005-inline-wave.md) | Controller session | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-010, FR-011 | TC-001, TC-002, TC-003, TC-005, TC-006, TC-007, TC-020 | every acceptance criterion in the UC file has a TC |
| UC-002 | FR-005, FR-008, FR-010 | TC-008, TC-010 | every acceptance criterion in the UC file has a TC |
| UC-003 | FR-001, FR-002, FR-005, FR-009 | TC-009 | every acceptance criterion in the UC file has a TC |
| UC-004 | FR-004, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016 | TC-004, TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-021, TC-022, TC-023, TC-024 | every acceptance criterion in the UC file has a TC |
| UC-005 | FR-017 | TC-025, TC-026, TC-027 | every acceptance criterion in the UC file has a TC |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 5 |
| Actors | 5 |
| Functional requirements covered | 17 |
| Test cases linked | 27 |

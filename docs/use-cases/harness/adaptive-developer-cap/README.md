---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Start the loop at the low cap and step up after clean waves | [UC-001](UC-001-start-and-step-up.md) | Controller session | implemented |
| UC-002 | Step down on a contention-shaped verify failure and re-run once | [UC-002](UC-002-step-down-and-rerun.md) | Controller session | implemented |
| UC-003 | Resume rebuilds the live cap from the ledger | [UC-003](UC-003-resume-live-cap.md) | Controller session | implemented |
| UC-004 | Plan records parallel waves at wave width | [UC-004](UC-004-plan-wave-width.md) | Controller session (plan skill) | implemented |
| UC-005 | Set the ceiling in config and read it from kf tasks --json | [UC-005](UC-005-configure-ceiling.md) | Human (project owner) | implemented |
| UC-006 | Turn the worktree domain layer off | [UC-006](UC-006-domains-off.md) | Human (project owner) | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-004, FR-007 | TC-004, TC-005, TC-010 | all acceptance criteria |
| UC-002 | FR-003 | TC-006 | all acceptance criteria |
| UC-003 | FR-005 | TC-007, TC-008 | all acceptance criteria |
| UC-004 | FR-006 | TC-009 | all acceptance criteria |
| UC-005 | FR-004, FR-007, FR-008 | TC-001, TC-002, TC-003, TC-010, TC-011 | all acceptance criteria |
| UC-006 | FR-009, FR-010, FR-011, FR-012 | TC-012, TC-013, TC-014, TC-015, TC-016 | all acceptance criteria |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 6 |
| Actors | 3 |
| Functional requirements covered | 12 |
| Test cases linked | 16 |

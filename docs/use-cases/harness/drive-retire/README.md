---
feature: drive-retire
context: harness
created: 20261101_1210
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Verify a task and a stage with kf verify | [UC-001](UC-001-verify-task-and-stage.md) | In-session controller | implemented |
| UC-002 | Implement an item in session with kf verify gates | [UC-002](UC-002-implement-in-session.md) | In-session controller | implemented |
| UC-003 | Run the day with travel as controller | [UC-003](UC-003-travel-as-controller.md) | Travel session | implemented |
| UC-004 | Clean leftover drive config and state with kf doctor | [UC-004](UC-004-doctor-cleans-drive-leftovers.md) | Human operator | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-002, FR-003 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006 | Allowlist exit 2, verify pass/fail, bad input exit 3, stage verify, no worktree, empty Files |
| UC-002 | FR-001, FR-004, FR-006, FR-007, FR-011, FR-012 | TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-019 | Removed commands, leftover meta ignored, Next: text, Role column ignored, skill text |
| UC-003 | FR-008, FR-009 | TC-013 | Travel skill text: slots, states, no kf drive |
| UC-004 | FR-005, FR-006, FR-010 | TC-014, TC-015, TC-016, TC-017, TC-018 | Legacy keys load, doctor warns and fixes, init keeps keys, meta leftovers fixed, docs grep |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 4 |
| Functional requirements covered | 12 |
| Test cases linked | 19 |

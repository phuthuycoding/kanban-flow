---
feature: verify-evidence
context: harness
created: 20261109_1326
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Record a stage verify run | [UC-001](UC-001-record-stage-run.md) | Agent session | implemented |
| UC-002 | Enter review on a passing record at HEAD | [UC-002](UC-002-enter-review-on-record.md) | Agent session | implemented |
| UC-003 | Enter review with a waiver when no stage verify is pinned | [UC-003](UC-003-waive-stage-verify.md) | Human (project owner) | implemented |
| UC-004 | See the record or waiver in status and review | [UC-004](UC-004-show-evidence.md) | Reviewer | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001 | TC-001, TC-002, TC-003, TC-004, TC-021, TC-022, TC-023 | Record content, pass and fail runs, no record on exit 3 or no config, clean flag, not read as a task log |
| UC-002 | FR-002, FR-005 | TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-018, TC-020 | Move on a valid record without re-running; each refusal cause; `--force` bypass; table check retired; no-worktree item |
| UC-003 | FR-003 | TC-013, TC-014, TC-015, TC-016 | Not-configured refusal, waiver write and refusals, metadata shape, waiver ignored once stage is pinned |
| UC-004 | FR-004, FR-006 | TC-017, TC-019 | Status line and JSON for each state; skills, template and help describe the record and waiver |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 4 |
| Functional requirements covered | 6 |
| Test cases linked | 23 |

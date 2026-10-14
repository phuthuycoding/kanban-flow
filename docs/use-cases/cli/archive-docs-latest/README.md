---
feature: archive-docs-latest
context: cli
created: 20261013_1513
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Archive stamps every canonical doc as archived | [UC-001](UC-001-archive-stamps-canonical-docs.md) | Maintainer/agent | implemented |
| UC-002 | Re-archive in dones stays idempotent with stamped docs | [UC-002](UC-002-rearchive-idempotent.md) | Maintainer/agent | implemented |
| UC-003 | Agent reconciles docs superseded by the new feature | [UC-003](UC-003-reconcile-superseded-docs.md) | Agent running kanban-archive | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-007 | TC-001, TC-002, TC-003, TC-009 | Stamped status, `implemented` rows, no `planning` left in repo docs |
| UC-002 | FR-003 | TC-004, TC-005, TC-006 | Idempotent re-archive, hand edits detected, legacy upgrade |
| UC-003 | FR-004, FR-005, FR-006, FR-007 | TC-007, TC-008, TC-009 | Skill step + reference, report section, Git handoff, done-trigger banners |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 3 |
| Actors | 2 |
| Functional requirements covered | 7 |
| Test cases linked | 9 |

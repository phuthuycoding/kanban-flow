---
feature: cli-refactor
context: harness
created: 20261024_1322
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Maintainer finds driver, archive and cancel logic in the layer named after it | [UC-001](UC-001-layered-modules.md) | Maintainer | implemented |
| UC-002 | CLI users see identical behaviour | [UC-002](UC-002-identical-behaviour.md) | kf CLI user / agent | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006 | TC-001, TC-002, TC-003, TC-004 | Module layout, layering, no cmdArchive from other commands |
| UC-002 | FR-005, FR-006, FR-007, FR-008 | TC-005, TC-006, TC-007 | Byte-identical output, full suite green |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 2 |
| Actors | 2 |
| Functional requirements covered | 8 |
| Test cases linked | 7 |

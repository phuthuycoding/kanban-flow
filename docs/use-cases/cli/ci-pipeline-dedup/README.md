---
feature: "ci-pipeline-dedup"
context: "cli"
created: "20261009_1920"
status: planning
---

# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Push to a PR branch produces one non-redundant CI run | [UC-001](UC-001-one-ci-run-per-commit.md) | Contributor | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-003 | TC-001, TC-002, TC-003 | All three FRs exercised by UC-001 |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 1 |
| Actors | 1 |
| Functional requirements covered | 3 |
| Test cases linked | 3 |

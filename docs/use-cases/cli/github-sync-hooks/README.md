---
feature: "github-sync-hooks"
context: "cli"
created: "20261010_1217"
status: planning
---

# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Maintainer onboards a project to GitHub sync | [UC-001](UC-001-onboard-github-sync.md) | Maintainer | planned |
| UC-002 | Work item mirrors to issue and board across stages | [UC-002](UC-002-mirror-work-item.md) | Agent | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-005 | TC-001, TC-004 | onboard produces working config + hooks |
| UC-002 | FR-003, FR-004 | TC-002, TC-003 | stages mirror to issue/board |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 2 |
| Actors | 2 |
| Functional requirements covered | 5 |
| Test cases linked | 4 |

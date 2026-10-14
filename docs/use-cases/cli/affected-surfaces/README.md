---
feature: affected-surfaces
context: cli
created: 20261012_1935
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Spec gate refuses unfilled surfaces | [UC-001](UC-001-spec-gate-refuses-unfilled-surfaces.md) | Human maintainer (via kf stage / validate) | implemented |
| UC-002 | Declared surfaces flow into the plan | [UC-002](UC-002-surfaces-flow-into-plan.md) | Agent | implemented |
| UC-003 | Validate warns on uncovered surface | [UC-003](UC-003-validate-warns-uncovered-surface.md) | Agent / maintainer | implemented |
| UC-004 | N/A escape for code-only changes | [UC-004](UC-004-na-escape.md) | Human maintainer | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002 | TC-001…TC-004 | Missing section, placeholder-only, comment-only and emptied body all refuse brainstorm-exit |
| UC-002 | FR-004, FR-005 | TC-005, TC-006 | Plan template + skills carry the convention |
| UC-003 | FR-003 | TC-007, TC-008 | WARNING on uncovered, silent when covered |
| UC-004 | FR-002 | TC-009, TC-010 | `N/A` passes the gate; bug and legacy specs unaffected |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 2 (human maintainer, agent) + kf validate/stage machinery |
| Functional requirements covered | 5 |
| Test cases linked | 10 |

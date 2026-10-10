---
feature: "skill-scope"
context: "cli"
created: "20261010_1832"
status: planning
---

# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Fresh init defaults to global skills | [UC-001](UC-001-fresh-init-global.md) | maintainer | planned |
| UC-002 | Onboarding asks scope and persists the answer | [UC-002](UC-002-onboarding-scope-choice.md) | maintainer | planned |
| UC-003 | Install global cleans the project copies | [UC-003](UC-003-install-global-cleans-project.md) | maintainer | planned |
| UC-004 | Install project leaves global copies untouched | [UC-004](UC-004-install-project-keeps-global.md) | maintainer | planned |
| UC-005 | Uninstall at a chosen scope | [UC-005](UC-005-uninstall-by-scope.md) | maintainer | planned |
| UC-006 | Autoconfig and doctor report scope, status and stale skills | [UC-006](UC-006-scope-status-report.md) | maintainer | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-003, FR-005 | TC-001, TC-002, TC-003 | init paths land global skills, no project copies |
| UC-002 | FR-002, FR-005 | TC-004, TC-005, TC-006 | question asked, `skills.scope` persisted, defaults global |
| UC-003 | FR-001, FR-003 | TC-007, TC-008, TC-009, TC-010 | link-or-copy lands globally; project copies removed per configured-scope rule |
| UC-004 | FR-003 | TC-011, TC-012 | project install never touches `~` copies |
| UC-005 | FR-004 | TC-013, TC-014, TC-015 | uninstall removes only the chosen scope; global warns |
| UC-006 | FR-006, FR-007 | TC-016, TC-017, TC-018, TC-019, TC-020 | scope + linked/copied/stale/broken/missing reported; `--fix` repairs |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 6 |
| Actors | 2 (maintainer, AI agents as consumers) |
| Functional requirements covered | 8 (FR-001..FR-008) |
| Test cases linked | 20 |

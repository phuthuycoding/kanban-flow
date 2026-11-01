---
feature: harness-agents
context: harness
created: 20261101_0917
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Install the six agents | [UC-001](UC-001-install-six-agents.md) | Human operator | implemented |
| UC-002 | Run one task through test-writer, developer and code-reviewer | [UC-002](UC-002-run-task-seats.md) | Controller session | implemented |
| UC-003 | Resolve a test dispute | [UC-003](UC-003-resolve-test-dispute.md) | Controller session | implemented |
| UC-004 | Cover UI test cases with automation-writer | [UC-004](UC-004-cover-ui-cases.md) | Controller session | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-009 | TC-001, TC-002, TC-010 | install/uninstall six, help text, docs name six |
| UC-002 | FR-002, FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-010 | TC-003, TC-004, TC-006, TC-008, TC-009, TC-011, TC-012, TC-013, TC-014 | order, skip rule, fix-loop split, models, frozen worker text, seat briefs |
| UC-003 | FR-005 | TC-005 | dispute route, Ruling and stop rules |
| UC-004 | FR-007 | TC-007 | automation-writer in implement and test, evidence rows, MCP rule |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 5 |
| Functional requirements covered | 10 |
| Test cases linked | 14 |

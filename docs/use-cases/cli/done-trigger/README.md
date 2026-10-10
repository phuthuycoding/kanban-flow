---
feature: "done-trigger"
context: "cli"
created: "20261010_2012"
status: planning
---

# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Archive leaves issue open and board at intermediate status | [UC-001](UC-001-archive-leaves-issue-open.md) | Maintainer/agent | planned |
| UC-002 | Link a pull request to the work item | [UC-002](UC-002-link-pull-request.md) | Maintainer/agent | planned |
| UC-003 | `kf issues done` delivers the work item | [UC-003](UC-003-issues-done-delivers.md) | Maintainer/agent | planned |
| UC-004 | `kf issues done` refuses when PR not merged | [UC-004](UC-004-issues-done-refuses-unmerged.md) | Maintainer/agent | planned |
| UC-005 | Doctor/status surfaces an archived-but-undelivered item | [UC-005](UC-005-undelivered-warning.md) | Maintainer/agent | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001 | TC-013 | Archive does not close issue; board moves only via statusMap.dones |
| UC-002 | FR-002 | TC-002 | `/pull/` URL → `pr`; numeric → `issue`; overwrite refused |
| UC-003 | FR-003, FR-004 | TC-004, TC-005, TC-007, TC-008, TC-009, TC-010, TC-011, TC-014 | Verify merged → close → board delivered → flag; idempotent |
| UC-004 | FR-003 | TC-006 | Unmerged PR → refuse, no side effects |
| UC-005 | FR-005 | TC-012 | dones + issue + !delivered → warning; silent otherwise |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 5 |
| Actors | 3 (maintainer/agent, hook pack, gh) |
| Functional requirements covered | 6 of 6 (FR-006 is docs — covered by TASK-008, no UC needed) |
| Test cases linked | 14 |

---
feature: "affected-surfaces"
context: "cli"
created: "20261012_1935"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Declared surfaces flow into the plan |
| Requirement reference | FR-004, FR-005 |
| Goal | Every declared surface gets planned work — a task row or a Documentation Impact entry |
| Primary actor | Agent |

## Supporting Actors
- `phase-2-implementation-plan.md` template
- `kanban-plan` skill

## Preconditions
- Spec confirmed with a filled `## Affected surfaces` section

## Trigger
Agent authors the Phase-2 contract in planning.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | Read the spec's declared surfaces | surface list in hand |
| 2 | Agent | For each surface, add a task row or a `## Documentation Impact` entry | plan names every declared surface |
| 3 | `kanban-plan` skill | Instructions tell the agent to do step 2 | convention is taught, not remembered |

## Alternative Flows
### A1 — surface genuinely needs no task
- Trigger: declared surface needs no change after all (mistake in brainstorm)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Agent notes it in plan Documentation Impact as "no change needed" | coverage check sees the surface's words → no warning; human sees it at approval |

## Postconditions
- Plan's task/doc-impact text contains each declared surface's name
- `kf validate`'s coverage check (UC-003) stays silent for this item

## Acceptance Criteria
- [ ] Plan template line documents the convention
- [ ] `kanban-plan` skill instructs carrying declared surfaces into tasks/doc-impact
- [ ] `kanban-brainstorm` skill instructs filling the section (asking the human when ambiguous)

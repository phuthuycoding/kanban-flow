---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case

> **Superseded by `workflow-slim`.** The `shipping` stage, the `kf ship` pipeline, the `ship` config block and the `kanban-ship` skill with its ship-or-archive gate are gone: review opens the PR after the independent code-reviewer passes and watches CI, the human merges on GitHub, and the next `kf status --change <feature>` or `kf sync` closes the item into `done` (`kf ship` is a deprecated alias that exits 1; a release is a manual `gh release create`). Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-006 |
| Name | Archive a non-code item directly from review |
| Requirement reference | FR-003 |
| Goal | Docs/config/research items skip shipping entirely — `review → dones` stays a first-class path |
| Primary actor | Agent |

## Supporting Actors
- Human (chooses "archive directly" at the ship gate)

## Preconditions
- Item in `review` with current PASS report; nothing to ship (no PR intent)

## Trigger
`kf archive <feature>` while item is in `review`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | at ship gate, human picks "archive directly" | no shipping entry |
| 2 | kf | `archive` accepts stage `review` (unchanged) | delivery gate runs as today |
| 3 | kf | docs/issue/board/delivered | item → `dones` |

## Alternative Flows
### A1
- Trigger: a `meta.pr` exists anyway (edge: code item archived without shipping stage)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | merged-PR check applies as today | archives only when merged/confirmed |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf validate` on a review-stage item | no shipping artifact demanded — shipping has no gates | unchanged validation |

## Postconditions
- Item in `dones` without ever occupying `shipping`

## Business Rules
- `shipping` is opt-in per item; absence of ship steps is legitimate.

## Data
- none beyond standard delivery fields

## Acceptance Criteria
- [ ] `kf archive` from `review` behaves byte-for-byte as before the feature

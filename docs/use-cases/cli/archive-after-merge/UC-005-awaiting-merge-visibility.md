---
feature: "archive-after-merge"
context: "cli"
created: "20261011_1108"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Awaiting-merge state is visible |
| Requirement reference | FR-005, FR-007 |
| Goal | "Reviewed, awaiting delivery" and "dones but never delivered" are surfaced by read commands — no stage invented, no side effects from reads |
| Primary actor | Human maintainer |

## Supporting Actors
- none (read-only surfaces)

## Preconditions
- Item in `review` with a PASS review report + linked `issue`, or item in `dones` without `delivered`.

## Trigger
`kf status --change <feature>`, `kf status --all`, or `kf doctor`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | Runs `kf status --change <feature>` on a review-stage PASS item with a linked issue | Output shows "awaiting merge — run `kf archive`" |
| 2 | maintainer | Runs `kf status --change <feature>` on a dones item without `delivered` | Output points at `kf archive` to finalize |
| 3 | maintainer | Runs `kf doctor` | Same two states surface as WARNING findings with `kf archive` as the action |

## Alternative Flows
### A1
- Trigger: review-stage item without a PASS report yet

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | No awaiting-merge hint — item is still being reviewed | Normal status output |

### A2
- Trigger: project config carries inert `statusMap.delivered`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf doctor` warns the key is dead config | Action: remove the key; recommended map is `dones → "Done"` |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Review report missing/unreadable | Treated as no-PASS → no hint | No crash on malformed artifacts |

## Postconditions
- None — read paths perform zero side effects.

## Business Rules
- `delivered` is never written or cleared by status/doctor.
- An awaiting-merge card sitting in `review` is honest board state; no pseudo-stage.

## Data
- `phase-5-review-report.md` frontmatter `status: PASS` — the awaiting-merge predicate
- `.kfw.json.issue`, `.delivered`

## Acceptance Criteria
- [ ] `kf status` shows awaiting-merge guidance for review-PASS items with a linked issue
- [ ] `kf status`/`kf doctor` point legacy undelivered dones items at `kf archive`
- [ ] `kf doctor` warns on inert `statusMap.delivered`
- [ ] Skills (`kanban-archive`, `kanban-flow`) and `cli-reference.md` describe archive as the post-delivery step

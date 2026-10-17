---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Archive a shipped item (`shipping → dones`) |
| Requirement reference | FR-003 |
| Goal | Deliver a shipping-stage item to `dones` through the existing delivery gate |
| Primary actor | Agent |

## Supporting Actors
- `gh` (PR merge verification)

## Preconditions
- Item in `shipping`; recorded PR merged (or human confirms delivery)

## Trigger
`kf archive <feature>` (or `kf stage <f> dones` which routes to archive)

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | runs `kf archive <f>` | delivery gate starts |
| 2 | kf | item stage `shipping` accepted as archivable | proceeds |
| 3 | kf | recorded PR verified merged | gate satisfied |
| 4 | kf | canonical docs sync, issue close, board Done, `delivered` stamp, move → `dones` | delivered |

## Alternative Flows
### A1
- Trigger: no `meta.pr` recorded (item parked in shipping without publish)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | human-confirm path (unchanged rule) | archives on confirmation |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Recorded PR still open/unmerged | archive refuses (existing rule) | stays in shipping |

## Postconditions
- Item in `.works/dones/`; `delivered: true` stamped

## Business Rules
- Shipping does not weaken the delivery gate — same merged-PR check as review-stage archive.

## Data
- `.kfw.json.status`: `archived`; `delivered`, `deliveredAt`

## Acceptance Criteria
- [ ] `kf archive` succeeds from `shipping` with merged PR or human confirm
- [ ] Unmerged recorded PR refuses exactly as from `review`

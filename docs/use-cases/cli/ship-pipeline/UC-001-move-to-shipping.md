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
| ID | UC-001 |
| Name | Move a PASS-reviewed item into shipping |
| Requirement reference | FR-001, FR-002 |
| Goal | Route a code-bearing item whose review PASSed into the `shipping` stage |
| Primary actor | Agent |

## Supporting Actors
- Human (decides "ship now?" at the third gate)

## Preconditions
- Item in `review` stage
- `phase-5-review-report.md` carries `status: PASS` for the current execution

## Trigger
`kf stage <feature> shipping`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | runs `kf stage <f> shipping` | transition requested |
| 2 | kf | `TRANSITIONS.review` includes `shipping` | edge allowed |
| 3 | kf | directional gate: review report is PASS for current execution | allowed |
| 4 | kf | moves `.works/review/<f>` → `.works/shipping/`, runs `shipping` hook | item in shipping |

## Alternative Flows
### A1
- Trigger: review report is FAIL/REJECT

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | directional gate refuses | item stays in review; loops per existing rules |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Item in any stage other than `review` | `TRANSITIONS` has no such edge | refused: unknown transition |
| `shipping → dones` via `kf stage` | routed into `cmdArchive` (existing stage→dones route) | delivery gate applies |

## Postconditions
- Item folder under `.works/shipping/`; `status`/board show `shipping`

## Business Rules
- Shipping entry is gated on a current PASS review — never on artifact presence alone.

## Data
- `.kfw.json.stage`: `shipping`

## Acceptance Criteria
- [ ] `kf stage <f> shipping` succeeds only from review with current PASS
- [ ] Refused from every other stage and on FAIL/REJECT/stale report
- [ ] `.works/shipping/` exists (init/doctor provide it)

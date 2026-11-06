---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Plan records parallel waves at wave width |
| Requirement reference | FR-006 |
| Goal | Let the plan state the most a wave can use, leaving the run to the live cap |
| Primary actor | Controller session (plan skill) |

## Supporting Actors
- `kf` CLI

## Preconditions
- Task breakdown written; `kf tasks <f> --graph` available

## Trigger
The plan skill writes the Execution lines

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Writes `Execution: wave <w> inline` for one-task waves | Inline waves marked |
| 2 | Controller | Writes `Execution: wave <w> parallel, <N> developers` with N = the wave width, no clamp | Width recorded |
| 3 | Controller | States in the approval summary that the cap starts at min(2, `harness.developers.max`) and scales itself | Human informed |

## Alternative Flows
### A1
- Trigger: Wave width above the ceiling

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The line still states the width; the live cap bounds the run | Return to the main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No graph available | Plan skill behaviour as today | — |

## Postconditions
- Approval summary lists the Execution lines and the adaptive cap

## Business Rules
- N in the Execution line is the wave width

## Data
- Ledger: `<item>/loop/progress.md` cap rulings, wait lines, rerun notes
- Config: `.kf/config.json` `harness.developers.max`

## Acceptance Criteria
- [ ] The plan skill no longer says `min(wave width, 4)`

---
feature: researcher-agent
context: harness
created: 20261102_1044
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | The controller unblocks a developer with research |
| Requirement reference | FR-001, FR-002, FR-005, FR-009 |
| Goal | Supply missing outside knowledge so the task loop continues |
| Primary actor | Controller session (implement skill) |

## Supporting Actors
- Developer agent
- kf:researcher agent

## Preconditions
- The item is in implementation and a developer seat is running

## Trigger
The developer reports `NEEDS_CONTEXT` or `BLOCKED` because outside knowledge is missing (not a plan defect, a test dispute or an architectural choice)

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Classifies the stop as missing outside knowledge | Research path chosen |
| 2 | Controller | Dispatches `Agent(kf:researcher)` with a brief; the report goes to `<item>/reviews/research-<slug>.md` | Named line |
| 3 | Controller | Writes a `Ruling:` line in `loop/progress.md` that cites the report | Ledger updated; seat grammar unchanged |
| 4 | Controller | Re-dispatches the same developer with the conclusion and the report path as the supplied context | The task continues; not counted as a fix round |

## Alternative Flows
### A1
- Trigger: The stop is a plan defect or an architectural choice

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The existing ruling or human path applies | No research dispatch |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The researcher returns `BLOCKED` | The controller escalates under the existing BLOCKED rules | No retry with an unchanged brief |

## Postconditions
- The developer gets the context; the fix-round count is unchanged

## Business Rules
- Research is never a fix round and never uses a fix brief

## Data
- Ruling line: `Ruling:` text citing the research report path

## Acceptance Criteria
- [ ] Implement 3.2 states the trigger and the `Ruling:` line
- [ ] `kf loop-stats` parses a ledger that holds such a line

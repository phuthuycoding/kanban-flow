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
| ID | UC-002 |
| Name | The human asks a spike question and the spike skill answers it |
| Requirement reference | FR-005, FR-008, FR-010 |
| Goal | Answer a question without opening a work item |
| Primary actor | Human |

## Supporting Actors
- Controller session running `kf:spike`
- kf:researcher agent

## Preconditions
- The `kf` plugin is installed

## Trigger
The flow skill classifies the request as a spike ("can we…", "what does X return today")

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Flow skill | Loads `Skill(kf:spike)` | Named line |
| 2 | Spike skill | States in two sentences what it will probe, then starts without waiting for a nod | Probing begins |
| 3 | Spike skill | Dispatches `Agent(kf:researcher)` for the research questions; report path under `$CLAUDE_JOB_DIR/tmp` or the OS temp dir | Sourced findings |
| 4 | Spike skill | Writes any throwaway code only in a scratch dir under the temp root | No tracked file changes |
| 5 | Spike skill | Reports a recommendation, sources and the exact commands | Answer delivered |

## Alternative Flows
### A1
- Trigger: The answer turns into a change

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Hands back to the flow skill to reclassify | Bounded or architectural path, with `kf new` |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The next step is irreversible (delete a release, flip a live setting) | Stops and asks for an explicit "go" | Nothing irreversible runs without the human's word |

## Postconditions
- No work item was created
- No tracked file changed

## Business Rules
- Read-only probing needs no nod; irreversible steps always do

## Data
- Scratch dir: temp-root throwaway code
- Report: temp-root research report

## Acceptance Criteria
- [ ] `skills/spike/SKILL.md` holds the 7 steps
- [ ] The flow skill's Spike row names `Skill(kf:spike)` with no inline procedure

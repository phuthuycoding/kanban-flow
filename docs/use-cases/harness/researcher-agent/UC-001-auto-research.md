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
| ID | UC-001 |
| Name | A skill dispatches the researcher on its own |
| Requirement reference | FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-010, FR-011 |
| Goal | Get a sourced answer to an outside-knowledge question without asking the user |
| Primary actor | Controller session (brainstorm or plan skill) |

## Supporting Actors
- kf:researcher agent
- Human (reads the conclusion at the gate)

## Preconditions
- The `kf` plugin is installed (or the copies are, in another runtime)
- A work item exists, in brainstorm or planning

## Trigger
Brainstorm meets an external library, API, service or standard that the repo does not define, or a how-do-others question. Or planning chooses between approaches or libraries, or names an external dependency.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Writes a brief from `researcher-brief.md`: mode, question, the decision it feeds, time box, report path `<item>/reviews/research-<slug>.md` | Brief ready |
| 2 | Controller | Dispatches `Agent(kf:researcher)`; at planning, in the same message as the scouts | Named line in the transcript |
| 3 | Researcher | Researches in the requested mode, citing a URL or `file:line` for each claim | Findings |
| 4 | Researcher | Writes the full report and replies in at most 40 lines: conclusion, confidence, sources, verified/inferred/unverified lists, `STATUS:` | Report on disk |
| 5 | Controller | Cites the report in the spec (Assumptions/Open Questions) or in the plan's approval summary | The human sees the sourced choice |

## Alternative Flows
### A1
- Trigger: The question is really about blast radius

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The researcher stops with `NEEDS_CONTEXT` and names scout | The controller dispatches scout instead |

### A2
- Trigger: Sources conflict

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The researcher reports both and lowers the confidence | The controller presents both at the gate |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No web tool in the runtime | `web`/`prior-art` stop with `BLOCKED` and the reason | The controller records the gap and never makes up a source |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The time box runs out | The researcher returns what it has, with `DONE_WITH_CONCERNS` | The open points are listed in the report |

## Postconditions
- A report file exists for each trigger that fired
- No question was put to the user that a report answered

## Business Rules
- A plan that makes a choice with no research report fails the plan's self-review
- The researcher never edits tracked files, commits or decides scope

## Data
- Brief: mode, question, decision, time box, report path
- Report: the full findings under `<item>/reviews/`

## Acceptance Criteria
- [ ] The brainstorm skill states the FR-006 trigger and dispatches `Agent(kf:researcher)`
- [ ] The plan skill states the FR-007 trigger and the self-review failure rule
- [ ] The researcher body holds the reply contract and the guardrails

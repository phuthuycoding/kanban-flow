---
feature: harness-agents
context: harness
created: 20261101_0919
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Cover UI test cases with automation-writer |
| Requirement reference | FR-007 |
| Goal | UI/E2E TCs under `Level: full` get Playwright specs from a dedicated seat, proved by a headless run |
| Primary actor | Controller session (kanban-implement or kanban-test) |

## Supporting Actors
- automation-writer, Playwright MCP (selector discovery only)

## Preconditions
- Spec Test Strategy `Level: full`.
- A task or the test stage has TCs whose Test type is `UI` or `E2E`.

## Trigger
kanban-implement reaches a task with UI/E2E TCs, or kanban-test finds the UI/E2E suite missing or a UI TC without a spec.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Writes the brief with the Test Strategy, the UI TCs, the worktree and the domain or `127.0.0.1:<port>` URL | Brief on disk |
| 2 | Controller | Dispatches `Agent(automation-writer)` with `references/automation-writer-brief.md` after the developer built the screen (or before, against a plan-fixed `data-testid` contract) | Spec files and an e2e report |
| 3 | automation-writer | Runs `npx playwright test` headless | Real command, exit code, pass/fail count |
| 4 | kanban-test | Puts the rows into `## Commands and Evidence` of the testing report | Evidence with real exit codes |

## Alternative Flows
### A1
- Trigger: Test Level is not `full`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | No automation-writer dispatch | UC ends |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A Playwright row exits non-zero | The report is not PASS | FAIL/REJECT loop as today |
| The MCP browser is busy with another agent | Wait or report BLOCKED | No concurrent MCP use |

## Postconditions
- The MCP was used for selector discovery only; the evidence is the headless run.

## Business Rules
- automation-writer never edits production code or the test-writer's tests.

## Data
- Report: `<item>/loop/task-NNN-e2e-report.md` (implement) or the brief's report file (test)

## Acceptance Criteria
- [ ] kanban-implement dispatches automation-writer for a UI/E2E task under full.
- [ ] kanban-test section 2 names `Agent(automation-writer)` and the Commands and Evidence rows.
- [ ] Both state the MCP-for-selectors-only rule.

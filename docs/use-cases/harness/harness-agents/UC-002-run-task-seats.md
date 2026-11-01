---
feature: harness-agents
context: harness
created: 20261101_0919
status: archived
---
# Use Case

> **Partly superseded by `drive-retire`:** the statements that `kf drive`, `kf run --task`, `harness.roles` and the `kf-run:` worker paragraphs of `kanban-implement` stay unchanged no longer hold — all are removed; the in-session loop is the only path. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Run one task through test-writer, developer and code-reviewer |
| Requirement reference | FR-002, FR-003, FR-004, FR-006, FR-008, FR-010 |
| Goal | Tests for a task are written from its TCs by a seat other than the one writing the code |
| Primary actor | Controller session (kanban-implement section 3) |

## Supporting Actors
- test-writer, developer, code-reviewer agents

## Preconditions
- Item in implementation with an approved plan; the in-session loop runs (not `kf drive`).
- The task's `FR / UC references` map to `## TC-###` blocks in `phase-2-test-case.md`.

## Trigger
The controller reaches the next task in the ledger.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Records BASE, writes `<item>/loop/task-NNN-brief.md` with the task row and the TC blocks whose Test type is Unit or Integration | Brief on disk |
| 2 | Controller | Dispatches `Agent(test-writer)` with `references/test-writer-brief.md`, naming the model | test-writer writes failing tests and `task-NNN-tests-report.md` |
| 3 | Controller | Checks every test fails for the right reason; copies test files and failing output into the developer brief | Developer brief ready |
| 4 | Controller | Dispatches `Agent(developer)` with `references/developer-brief.md`, naming the model | developer makes the tests pass without editing them, commits the task, writes `task-NNN-report.md` |
| 5 | Controller | Builds the review package and dispatches `Agent(code-reviewer)` | Spec and quality verdicts |
| 6 | Controller | Review clean → ticks the task and ledgers `TASK-NNN: complete` | Next task |

## Alternative Flows
### A1
- Trigger: the task has no Unit or Integration TC (docs, config, glue)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Controller ledgers `TASK-NNN: no test-writer — <why>` and skips step 2 | Developer reports `No TDD: <why>` with real-run output; continue at step 5 |

### A2
- Trigger: the task review has HIGH/MEDIUM findings or a spec ❌

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Code findings → developer (rounds 1–3 resume it, 4–5 fresh one tier up); test findings → test-writer; scoped re-review | Up to five rounds total, then the breaker; return to step 6 |

### A3
- Trigger: the item is a bug

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The test-writer brief carries the bug report's reproduction and regression scope instead of TCs | Continue at step 2 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A new test passes before implementation | Controller rules (behaviour exists or test wrong) before dispatching the developer | `Ruling:` in the ledger |
| test-writer reports `NEEDS_CONTEXT` (TC has no concrete expected value) | Controller rules on the plan defect or stops; the developer never invents the value | Ledgered |
| Runtime has no subagent tool | The session does not write both tests and code and claim a seat | Ledger `review seat: none` / no test-writer seat; review stage treats tasks as unreviewed |

## Postconditions
- One commit per task, made by the developer, holding the test files and the code; a UI task under full adds a second developer commit holding the automation-writer's spec files unchanged.
- `kf drive`, `kf run --task`, the `kf-run:` worker paragraphs and `implementer-brief.md` are unchanged.

## Business Rules
- Whoever writes a file owns it.
- Every dispatch names its model (sonnet default; opus for design judgement or a test failing twice).

## Data
- Ledger: `<item>/loop/progress.md`
- Briefs and reports: `<item>/loop/task-NNN-brief.md`, `task-NNN-tests-report.md`, `task-NNN-report.md`

## Acceptance Criteria
- [ ] kanban-implement section 3 dispatches test-writer, developer, code-reviewer in that order.
- [ ] The skip rule writes `TASK-NNN: no test-writer — <why>`.
- [ ] The fix loop splits code and test findings within five rounds.
- [ ] Each seat template names a model.
- [ ] The `kf-run:` worker paragraphs and `implementer-brief.md` are byte-identical to main.

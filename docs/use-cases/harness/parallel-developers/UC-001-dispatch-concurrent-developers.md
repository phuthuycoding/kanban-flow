---
feature: parallel-developers
context: harness
created: 20261101_2200
status: archived
---
# Use Case

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Dispatch concurrent developers on ready, disjoint tasks |
| Requirement reference | FR-004, FR-005, FR-010 |
| Goal | Dispatch concurrent developers on ready, disjoint tasks |
| Primary actor | Controller |

## Supporting Actors
- Developer seats (up to 4 at once, in the work item's single worktree).
- Test-writer seats, which prepare the tests of the next tasks.
- `kf tasks --json` (`overlaps`, `dependencies`) and the ledger `loop/progress.md`, the only source of in-flight state.

## Preconditions
- The item is started and implementation is under way: the approved plan lists tasks with Files and dependencies.
- The ledger holds the lines of the tasks already handled.
- At least one task has no `developer dispatched` line yet.

## Trigger
The controller gets a turn (a seat reports, a background command exits, or it has just dispatched something) and works through its ordered work list. Item 1 is "dispatch every seat that is ready now".

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Counts developer seats in flight in the worktree, fix-round developers and developers resumed to commit specs or fixed tests included. | Free slots = 4 minus that count. |
| 2 | Controller | Runs `kf tasks --json` and lists the tasks with a `test-writer done` line and no developer yet. | Candidate tasks in plan order. |
| 3 | Controller | Checks dispatch condition 1 per candidate: every dependency's developer reported DONE, so its task commit exists. | Candidates with unmet dependencies are skipped. |
| 4 | Controller | Checks condition 2: the task's test-writer is done and its test hashes are ledgered. | Candidates without hashes are skipped. |
| 5 | Controller | Checks condition 3: the task's Files overlap no open task (a `test-writer dispatched` or `developer dispatched` line, no `complete` line yet) per `overlaps`; a test-written task does not hold back an earlier task's developer, and a task whose test-writer is in flight holds back every overlapping task (amended at review FINDING-005). Unknown Files (null) overlap everything. | Disjoint candidates are ready. |
| 6 | Controller | Dispatches one developer per ready task, up to the free slots, in the same turn, and ledgers `TASK-NNN: developer dispatched model=<m> @ <ts>`. | Several developers run at once; each task's overlap gate now includes the others. |
| 7 | Controller | Dispatches test-writers for the next 4 tasks in plan order with no `test-writer done` line and not complete, each told not to write inside the Files of any open task other than its own. | Tests are ready ahead of the developers; test-writer runs are advisory while a developer is in flight. |
| 8 | Controller | Continues the work list (verify, review package, next brief, scouts, ledger) and ends the turn only when nothing applies and a seat or background command is running. | The loop waits for the next report. |

## Alternative Flows
### A1
- Trigger: a ready task is held back only by an overlap with an open task.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Controller ledgers `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` and dispatches no developer for it. | Returns to step 6 for the other ready tasks; handled in UC-002. |

### A2
- Trigger: a ready developer seat, a fix round included, finds all 4 slots taken.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Controller ledgers `TASK-NNN: developer waits — 4 developers in flight` and dispatches nothing for it. | Re-evaluated at the next `developer done`; handled in UC-002. |

### A3
- Trigger: the plan is a chain (each task depends on the previous one).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Step 3 leaves one candidate at a time. | One developer in flight, as today. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A task has unknown Files (null) | It overlaps every open task and is overlapped by them, so it is dispatched only when nothing else is open. | It runs alone; the wait line names the overlap if it had to wait. |
| Two tasks edit an undeclared shared file (for example `package-lock.json`) | The overlap check cannot see it. `kf verify --commits` exits 2 for the task whose Files lack it. | A plan change, as today. Not prevented at dispatch. |

## Postconditions
- Up to 4 developers are in flight; none is on a task whose Files overlap an open task.
- Every dispatch has a `developer dispatched` line, every hold a wait line.
- No doc or skill file states "one developer seat in flight per worktree" or "at most two tasks in flight" as the rule.

## Business Rules
- The cap is 4, counting fix-round and resume-commit developers.
- Gating is on open tasks, not in-flight developers, so a later fix round of an overlapping task never edits files another developer is changing.
- No plan-order barrier and no 2-task window; the worktree stays single for all roles.
- Test-writers never write inside the Files of an open task other than their own.
- The loop stays skill prose (`skills/kanban-implement/SKILL.md`, `references/task-loop.md`); no controller binary.

## Data
- Ledger lines: `TASK-NNN: developer dispatched model=<m> @ <ts>`, `TASK-NNN: developer waits — <reason> @ <ts>`, `TASK-NNN: test-writer done`, `TASK-NNN: complete`.
- `kf tasks --json`: per task `files`, `overlaps`, `dependencies`; `files: null` means unknown.
- Cap constant: 4 (one number in the skill prose, pinned by a test).

## Acceptance Criteria
- [ ] kanban-implement prose states the cap of 4, the three dispatch conditions, both wait lines and the open-task overlap rule, and surface tests pin each (FR-004, FR-010).
- [ ] No doc or skill file still states "one developer seat in flight per worktree" or "at most two tasks in flight" as the rule; `loop-parallel-surface.test.ts` pins the new rule (FR-010).
- [ ] A scratch scenario with 3 ready disjoint tasks and 1 overlapping task shows overlapping developer intervals for the 3 and a `developer waits — Files overlap` line for the 4th (FR-004).
- [ ] A fix round arriving with 4 developers in flight writes `developer waits — 4 developers in flight` (FR-004).
- [ ] The prose lets test-writers run for the next 4 tasks and forbids writing inside another open task's Files (FR-005).

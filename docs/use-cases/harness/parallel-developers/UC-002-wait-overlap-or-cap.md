---
feature: parallel-developers
context: harness
created: 20261101_2201
status: archived
---
# Use Case

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Wait on an overlap or the cap |
| Requirement reference | FR-004 |
| Goal | Wait on an overlap or the cap |
| Primary actor | Controller |

## Supporting Actors
- Developer seats (their `developer done` lines free a cap slot)
- `kf tasks --json` (supplies `overlaps` and `dependencies`)
- The ledger (`loop/progress.md`), the only source of in-flight state

## Preconditions
- The work item is started, and its approved plan has tasks with declared Files (or `files: null`).
- A task's developer is otherwise ready: every dependency's developer has reported DONE, and the task's test-writer is done with its test hashes ledgered.
- Either the task's Files overlap an open task (a task with a `test-writer dispatched` or `developer dispatched` line and no `complete` line yet; amended at review FINDING-005), or 4 developer seats are already in flight in the worktree.

## Trigger
The controller reaches the "dispatch every ready seat" item of its work list (FR-011) with a task or fix round that satisfies the dispatch conditions except for an overlap or the cap.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Checks the task's dependencies and its test-writer gate | Both hold, so only the overlap and cap conditions remain |
| 2 | Controller | Reads `kf tasks --json` `overlaps` for the task against every open task | Finds TASK-MMM as an open task whose Files overlap (`files: null` overlaps everything); a later task whose tests are written and whose developer is not dispatched does not hold back this earlier task (tie-break, amended at review FINDING-005) |
| 3 | Controller | Writes `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` and does not dispatch | The task is held with the blocking task named in the line |
| 4 | Controller | Continues the work list for other ready seats instead of idling | Other ready seats are dispatched or started in the meantime |
| 5 | Controller | Sees `TASK-MMM: complete` in the ledger | The overlap is gone |
| 6 | Controller | Re-checks the dispatch conditions, then dispatches the developer | `TASK-NNN: developer dispatched` follows the wait line |

## Alternative Flows
### A1
- Trigger: No open task overlaps, but 4 developer seats are in flight (fix-round and resume-commit developers count), including when the held seat is a fix round.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Controller writes `TASK-NNN: developer waits — 4 developers in flight` and does not dispatch | The seat is held by the cap only |
| A1.2 | Controller waits for the next `developer done` of any task | A slot is free |
| A1.3 | Controller re-checks the overlap gate and the cap, then dispatches | Returns to main flow step 6 |

### A2
- Trigger: A task is held by an overlap and, after the overlap clears, the cap is reached.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Controller writes the cap wait line when the overlap line is superseded | The line names the condition that still holds |
| A2.2 | Controller proceeds as A1.2 and A1.3 | Returns to main flow step 6 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The task has unknown Files (`files: null`) | Treated as overlapping every open task, so it waits until none is open | Runs alone; the wait line names the open task(s) as `<theirs>` |
| The held task's dependency lacks a `developer done` | Not an overlap or cap wait, so no wait line is written | The task is not dispatchable yet and stays out of this flow |
| Context compacts while a task waits | Resume rebuilds the wait from the ledger and re-applies the gates (UC-006) | No duplicate dispatch; the existing wait line stands |

## Postconditions
- While waiting: the ledger holds exactly one wait line for the task naming the blocker, and no developer is dispatched for it.
- After the gate clears: the developer is dispatched with the task's open-task Files overlap and the in-flight count both respecting the cap of 4.
- Never more than 4 developers in flight, and no two open tasks with overlapping Files are edited at once.

## Business Rules
- The cap is 4 developer seats per worktree, counting fix-round developers and developers resumed to commit specs or fixed tests.
- Overlap is judged against open tasks, not in-flight developers, so a later fix round of an overlapping task never edits files another developer is changing.
- Dispatch needs all three conditions: dependencies' developers DONE, test-writer done with hashes ledgered, Files overlapping no open task.
- Tie-break: a test-written task does not hold back an earlier task's developer, which goes first; a task whose test-writer is in flight holds back every overlapping task (amended at review FINDING-005).
- The two wait lines use existing ledger shapes. `LEDGER_SHAPES` is unchanged.
- Wait lines are the gate input for `kf loop-stats` dispatch lag (FR-012): the `(TASK-MMM)` of an overlap wait is read with `/\((TASK-\d+)\)$/`, and a cap wait is closed by the first later `developer done`.
- The legacy `fix queued — developer TASK-MMM in flight` line is no longer written.

## Data
- Ledger lines: `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)`, `TASK-NNN: developer waits — 4 developers in flight`, `TASK-MMM: complete`, `TASK-NNN: developer done`.
- `kf tasks --json` rows: `overlaps` (per task, other task ids with overlapping Files), `dependencies`, `files` (null means overlaps everything).
- Open task: derived from the ledger, a `developer dispatched` line without a `complete` line.

## Acceptance Criteria
- [ ] A ready task whose Files overlap an open task is not dispatched, and `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` is ledgered.
- [ ] After `TASK-MMM: complete`, the held task's developer is dispatched.
- [ ] With 4 developers in flight, a ready developer (including a fix round) is not dispatched and `TASK-NNN: developer waits — 4 developers in flight` is ledgered; it is dispatched after the next `developer done`.
- [ ] A task with unknown Files waits behind every open task.
- [ ] In the scratch scenario (3 ready disjoint tasks and 1 overlapping task), the 4th task gets a `developer waits — Files overlap` line.
- [ ] The kanban-implement prose states both wait lines verbatim and the open-task overlap rule; surface tests pin each.

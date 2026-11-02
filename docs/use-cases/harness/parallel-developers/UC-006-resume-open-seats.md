---
feature: parallel-developers
context: harness
created: 20261101_2201
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-006 |
| Name | Resume with several developers in flight |
| Requirement reference | FR-008 (with FR-004, FR-007) |
| Goal | Resume with several developers in flight |
| Primary actor | Controller |

## Supporting Actors
- Developer, test-writer, code-reviewer and automation-writer seats, re-dispatched from the ledger
- The ledger (`<item>/loop/progress.md`) and `git log`, the only source of in-flight state

## Preconditions
- The item is in implementation and its worktree exists.
- The controller's context was lost (compaction or a new session) while several tasks were open: tasks with a `dispatched` line and no `complete` line.
- The ledger holds the lines written before the interruption; the commits it names exist in `git log`.

## Trigger
The controller starts or resumes kanban-implement on an item whose ledger already has task lines, with no `complete` line for some of them.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Reads `<item>/loop/progress.md`, `git log` and `kf tasks --json` (`dependencies`, `overlaps`). Trusts them over its own recollection. | The open tasks are known: every task with a `dispatched` line and no `complete` line. |
| 2 | Controller | Re-runs every `TASK-NNN: verify started` that has no `verify done`, with the runtime's background option. | Interrupted verifies run again, off the foreground. |
| 3 | Controller | Re-dispatches every non-developer seat with a `dispatched` line and no `done`: test-writers, code-reviewers, cascade re-reviews, automation-writers. | Those seats run again; none is skipped. |
| 4 | Controller | Re-dispatches every developer with a `developer dispatched` line and no `developer done`, up to the cap of 4. | Open developers run again, each on its own task. |
| 5 | Controller | Resumes each other open task at its first unmet step, in the numbered resume order, from its ledger lines. | Each task continues where it stopped; a task with a `complete` line is never re-dispatched. |
| 6 | Controller | Only after steps 2-5, dispatches new developers by the FR-004 rule (dependencies done, test hashes ledgered, Files overlap no open task) while a slot is free. | New work starts after the interrupted work, never ahead of it. |
| 7 | Controller | Applies the FR-007 order rules: a task completes when its own gates pass and its dependencies are complete; cascades are owed only to dependents. | Independent tasks complete in any order. |

## Alternative Flows
### A1
- Trigger: A fix round is queued (latest review `findings`, or `verify done exit=1` kept) while 4 developers are still open.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Re-dispatch the 4 open developers first (step 4). | All 4 slots are taken. |
| A1.2 | Ledger `TASK-NNN: developer waits — 4 developers in flight @ <ts>` for the fix round; no `fix queued` line is written. | The fix waits for the next `developer done`, then returns to step 6. |

### A2
- Trigger: A task has a `complete` line.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Skip every seat and verify of that task. | Nothing is re-dispatched; continue with the next open task in step 5. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| More than 4 developer lines are open (the cap cannot hold them all) | Re-dispatch 4 in plan order; the rest wait. | `TASK-NNN: developer waits — 4 developers in flight @ <ts>` per waiting task. |
| An open task's Files are unknown (null) or overlap another open task's | The overlap gate applies to new dispatches only; open developers are re-dispatched, and a held-back new task waits. | `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM) @ <ts>`; it waits for `TASK-MMM: complete`. |
| The ledger and `git log` disagree (a named commit is missing) | The controller does not re-dispatch from memory or guess; it stops and reports to the human. | No dispatch; the mismatch is reported. |

## Postconditions
- Every open seat of every kind and every unfinished verify has been re-dispatched or re-run before any new developer.
- At most 4 developers are in flight, fix-round and resume-commit developers included.
- The ledger is the only source used; no `complete` task was re-run.

## Business Rules
- The ledger stays the only source of in-flight state on resume.
- Open work comes back before new work: every seat of any kind, then developers up to the cap, then new dispatches.
- A held-back developer is always ledgered with one of the two wait lines (`Files overlap` or `4 developers in flight`).
- `fix queued — developer TASK-MMM in flight` is not written any more; older ledgers still carry it, and `parseLedger` still reads it.
- Resume keeps the numbered per-task resume list, generalised from "H and X" to every open task.

## Data
- Ledger lines: `TASK-NNN: <seat> dispatched model=<model>[ round=<R>][ cascade=<sha7>] @ <ts>`, `<seat> done status=<STATUS>`, `verify started`, `verify done exit=<n>`, `developer waits — <reason>`, `complete (…)`.
- `kf tasks --json`: `dependencies` and `overlaps` per task; `files: null` overlaps everything.
- `git log` on the item branch: the commits the ledger names.

## Acceptance Criteria
- [ ] The resume rule re-dispatches every seat that has a `dispatched` line and no `done` (test-writers, code-reviewers, cascade re-reviews, automation-writers) and every developer up to the cap, before any new developer. (FR-008)
- [ ] Every `verify started` with no `verify done` is re-run on resume. (FR-008)
- [ ] With 4 open developers and a queued fix, the 4 are re-dispatched first and the fix writes `developer waits — 4 developers in flight`. (FR-008, FR-004)
- [ ] The resume list in kanban-implement covers every open task, not only H and X, and a task with a `complete` line is never re-dispatched. (FR-008)
- [ ] Surface tests pin the generalised resume rule and the retired `fix queued` line. (FR-008, FR-010)

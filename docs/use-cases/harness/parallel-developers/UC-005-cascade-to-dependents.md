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
| ID | UC-005 |
| Name | Cascade a late fix to the fixed task's dependents |
| Requirement reference | FR-007 |
| Goal | Cascade a late fix to the fixed task's dependents; independent tasks complete out of order |
| Primary actor | Controller |

## Supporting Actors
- Developer seat of the fixed task H (writes the fix commit).
- Code-reviewer seat (answers the cascade re-review of a dependent X).
- Developer seats of other open tasks (independent of H, unaffected).

## Preconditions
- The item is started and the controller runs the in-session loop with several tasks open (developer dispatched, no `complete` line yet).
- `kf tasks <feature> --json` is available and carries `dependencies` for every task.
- Task H has a fix commit landing after the developer of task X was dispatched.

## Trigger
A fix commit of task H lands (a fix round of H) while at least one other task X is open or already committed.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Reads `dependencies` from `kf tasks --json` and finds every task X that depends on H, directly or transitively, whose developer was dispatched before the fix commit. | The dependent set of H is known. |
| 2 | Controller | Writes `TASK-X: cascade re-review owed — after <sha7> of TASK-H @ <ts>` for each dependent X. | One owed line per dependent; a fan-out of 3 gives 3 lines. |
| 3 | Controller | Dispatches a re-review for each owed X (`code-reviewer dispatched … cascade=<sha7>`), in the background and without waiting on other seats. | Each re-review is in flight. |
| 4 | Code-reviewer | Reports `clean` or `findings` for X. | The owed line is answered; findings enter X's normal fix loop. |
| 5 | Controller | Completes X only when its own gates pass: review clean or parked, `verify done exit=0` after its last commit, every owed cascade answered, and its dependencies complete. | `TASK-X: complete (commits …, review clean) @ <ts>` is written. |
| 6 | Controller | Completes independent tasks as soon as their own gates pass, in any order, with no plan-order barrier. | An independent task Y completes before an earlier task in plan order. |

## Alternative Flows
### A1
- Trigger: A task depends on H only transitively (H to M to X).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The controller treats X as a dependent per `dependencies` and writes the owed line for X as well as M. | Both owe a re-review. Return to step 3. |

### A2
- Trigger: A task Y is in flight and does not depend on H, directly or transitively.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The controller writes no owed line for Y and does not delay Y's completion. | Y completes on its own gates. Return to step 6. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Re-review of X returns `findings` | X runs its normal fix round; X stays open and does not complete. | `TASK-X: fix round <R>/5 (…)` ledgered; its own dependents then owe a cascade after the new fix commit. |
### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Undeclared coupling: X and H share a file the plan did not declare | Not detected by the cascade. The stage gate's full build and suite (kanban-implement § 4) catches it. | Failure surfaces at the stage gate, not per task. |
### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A dependency of X is not yet complete | X is not completed even when its own gates pass. | X stays open until `TASK-<dep>: complete` is written. |

## Postconditions
- Every dependent of H has an answered `cascade re-review owed` line before its `complete` line.
- No independent task owes a cascade for H's fix.
- Completed tasks may appear in the ledger in an order different from the plan order.

## Business Rules
- A cascade is owed only to tasks that depend on the fixed task, directly or transitively, per `kf tasks --json` `dependencies`; Files overlap alone does not owe one.
- A task completes when its own gates pass and its dependencies are complete. There is no plan-order barrier (this replaces "the head completes before the next").
- The owed line uses the existing ledger shape; `LEDGER_SHAPES` is unchanged.
- The stage gate's full build and suite is the backstop for coupling the plan did not declare.
- The controller never fills a review seat; the re-review is a code-reviewer dispatch.

## Data
- Ledger `<item>/loop/progress.md`: `cascade re-review owed — after <sha7> of TASK-MMM`, `code-reviewer dispatched … cascade=<sha7>`, `TASK-NNN: complete (…)`.
- `kf tasks --json` `dependencies`: per-task dependency list used to find dependents.
- Fix commit sha7 of the fixed task H.

## Acceptance Criteria
- [ ] A fix commit of H after X's developer was dispatched ledgers `TASK-X: cascade re-review owed — after <sha7> of TASK-H` for X when X depends on H directly or transitively. (FR-007)
- [ ] A cascade fanning out to 3 dependents writes 3 owed lines and 3 re-reviews; an independent task in flight owes none. (FR-007)
- [ ] X does not complete until the re-review is answered and its dependencies are complete. (FR-007)
- [ ] An independent task completes before an earlier task in plan order, and the surface test pins the no-barrier rule and the dependents-only cascade. (FR-007)

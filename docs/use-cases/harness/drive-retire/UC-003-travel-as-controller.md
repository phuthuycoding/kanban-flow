---
feature: drive-retire
context: harness
created: 20261101_1211
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Run the day with travel as controller |
| Requirement reference | FR-008, FR-009 |
| Goal | After the human approves the morning plan, the travel session itself keeps up to N items in flight, each in its own worktree, runs each item's phase skills, dispatches their seats in the background, and sorts every stop into blocked or waiting-to-merge, without `kf drive`. |
| Primary actor | Travel session |

## Supporting Actors
- Human: approves the morning plan, answers Needs you lines, runs the merge, archive and approve commands travel prints.
- Seat subagents: test-writer, developer, code-reviewer and the review seats, dispatched in the background by the travel session.
- kf CLI: `kf status`, `kf tasks` and `kf verify` give state and gates; travel never calls `kf approve`, `kf archive` or `kf stage`.

## Preconditions
- The morning plan (carry-over, actionable kf items, red CI, buckets, sizes, budget) has been printed and the human approved or edited it.
- Each candidate item is started (implementation, testing or review) with a current approval.
- `slots=N` is set (default 3); the ledger `.kf/travel/progress.md` has today's `## YYYY-MM-DD` section.

## Trigger
The human approves the morning plan.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Travel session | Appends today's section to `.kf/travel/progress.md` with one `queued` line per planned item. | The ledger holds the day. |
| 2 | Travel session | Takes the next dispatchable `queued` line (not XL, approval current, sequential partners `done`) while live items < N, and works in that item's own worktree. | The line becomes `driving`; at most N items are in flight. |
| 3 | Travel session | Runs the item's phase skills itself (implementation, testing, review) and dispatches their seats as background subagents. | The item advances; each item's `loop/progress.md` records its progress. |
| 4 | Travel session | While an item's seats run in the background, advances another `driving` item. | Slots stay busy; no item blocks the session. |
| 5 | Travel session | When a phase skill stops for the human (REQUIREMENT_BUG, plan change, fix-loop breaker), marks the line `blocked` with the reason and the next command. | The stop appears under Needs you; the slot is freed. |
| 6 | Travel session | When review is PASS and the PR is open, marks the line `waiting-to-merge` with the PR URL and the merge command. | The line appears under Waiting to merge; the slot is freed. |
| 7 | Travel session | Prints the progress block each tick, refreshes `kf status --all --json`, and refills freed slots from `queued`. | The human sees Needs you, Running and Waiting to merge. |
| 8 | Human | Merges the PR; `kf status` closes the item. | The next refresh turns the line `done` and travel measures it. |
| 9 | Travel session | At end of day prints the summary and rewrites unfinished lines as `carry-over`. | Tomorrow's plan starts from the ledger. |

## Alternative Flows
### A1
- Trigger: `slots=1`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Travel keeps one item in flight and runs its phases in order. | Behaves like one kanban-flow session; returns to main flow step 7 when the item stops. |

### A2
- Trigger: Context compaction or a re-entered session mid-day.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Travel reads `.kf/travel/progress.md` for today's lines, then each `driving` item's `loop/progress.md`. | The position of every item is recovered. |
| A2.2 | Travel continues each item from its recorded task or phase. | No item restarts from scratch; returns to main flow step 3. |

### A3
- Trigger: The human fixes a `blocked` item and says it is done.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Travel sets the line back to `queued`. | The item is dispatched again when a slot is free; returns to main flow step 2. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A phase skill returns REQUIREMENT_BUG, needs a plan change, or its fix-loop breaker trips. | Travel stops that item, records the reason and the exact next command (such as a `kf stage ... planning` it prints but never runs). | Line `blocked`; Needs you shows the reason and next command. Other items keep running. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A sequential pair shares files and its partner is not `done`. | Travel does not dispatch the second item. | Line stays `queued`; reported until the partner is `done`. |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The line needs a merge, archive, approve or push to main. | Travel does not run it; it prints the exact command. | Line `waiting-to-merge` or a Needs you decision; the human runs the command. |

## Postconditions
- Every started item is `driving`, `blocked`, `waiting-to-merge` or `done` in the ledger, and no state is read from `kf drive --status`.
- Every `blocked` line carries a reason and a next command; every `waiting-to-merge` line carries the PR URL and merge command.
- Nothing was approved, archived, merged or pushed to main by travel.
- The ledger and each item's `loop/progress.md` are enough to resume after compaction.

## Business Rules
- Travel never approves, archives, merges or pushes to main (`kf approve`, `kf archive`, `kf stage`, `gh pr merge`, `git merge`, `git push` to main belong to the human).
- `slots=1` behaves like one kanban-flow session.
- Resume after compaction reads `.kf/travel/progress.md`, then the item's `loop/progress.md`, and never restarts an item.
- One started item is one slot and one item worktree; at most N items are in flight.
- The travel session is the controller; an item is never handed to a background controller agent, because subagents cannot spawn subagents.
- States: `driving` (session is running the item's phases), `blocked` (reason and next command), `waiting-to-merge` (review PASS, PR open).
- Morning plan, Needs you, Waiting to merge and carry-over behave as before.

## Data
- `.kf/travel/progress.md`: the day ledger, one `## YYYY-MM-DD` section of lines with id, feature, kind, size, state and note.
- `<item>/loop/progress.md`: the item's task-loop ledger used to resume.
- Line state: `queued`, `driving`, `blocked`, `waiting-to-merge`, `done`, `carry-over`.
- `kf status --all --json`: needsYou, waitingToMerge, item stage and PR.

## Acceptance Criteria
- [ ] After plan approval the travel skill keeps up to `slots=N` started items in flight, each in its own worktree, and runs each item's phase skills itself.
- [ ] The skill dispatches the seats in the background and advances another item while they run.
- [ ] The skill text never calls `kf drive` or `kf drive --status`; its states are defined without them.
- [ ] `driving`, `blocked` and `waiting-to-merge` are defined as above, and a blocked line states a reason and a next command for REQUIREMENT_BUG, plan change and fix-loop breaker.
- [ ] Travel never approves, archives, merges or pushes to main, and prints those commands for the human.
- [ ] `slots=1` is documented as behaving like one kanban-flow session.
- [ ] Resume reads `.kf/travel/progress.md`, then the item's `loop/progress.md`, and does not restart an item.
- [ ] Morning plan, Needs you, Waiting to merge and carry-over behaviour is unchanged.

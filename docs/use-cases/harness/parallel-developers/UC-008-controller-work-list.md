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
| ID | UC-008 |
| Name | Keep the controller working while seats run |
| Requirement reference | FR-011, FR-012 |
| Goal | Keep the controller working while seats run (ordered work list, background commands, dispatch lag) |
| Primary actor | Controller |

## Supporting Actors
- Developer, test-writer and code-reviewer seats, whose reports and `done` lines give the controller its turns.
- Background commands (`kf verify --commits`, a full suite, a build), which exit and give the controller a turn.
- The human, who reads `kf loop-stats` to see `dispatch lag`.

## Preconditions
- The item is started and kanban-implement is running the in-session loop (TASK-005 prose in `skills/kanban-implement/SKILL.md` and `references/task-loop.md`).
- The ledger (`loop/progress.md`) holds the task lines the work list reads: `test-writer done`, `developer done`, `developer waits`, `complete`.
- At least one seat or background command is running, or the controller has just received a turn.

## Trigger
The controller gets a turn: a seat reports, a background command exits, or the controller has just dispatched something.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Dispatches every seat that is ready now: developers per FR-004, test-writers per FR-005, code-reviewers and re-reviews for committed tasks, owed cascades. | No ready seat waits on the controller. |
| 2 | Controller | Starts `kf verify --commits` and builds the review package for every newly committed task, with the runtime's background option. | `verify started` is ledgered; the controller is free. |
| 3 | Controller | Writes the brief of the next task that has none. | The next dispatch finds its brief ready. |
| 4 | Controller | Runs the scouts a later task needs. | Scout results are ready before that task is dispatched. |
| 5 | Controller | Writes the ledger lines and reports that are owed. | The ledger is current, so resume and `kf loop-stats` read true state. |
| 6 | Controller | Re-checks items 1-5. If any still applies, repeats from item 1. | No applicable item is left behind. |
| 7 | Controller | Ends the turn only when no item applies and at least one seat or background command is running. | The next seat report or background exit gives the next turn. |
| 8 | Human | Runs `kf loop-stats` and reads `dispatch lag: developer median <m> max <m> (n=<k>), code-reviewer median <m> max <m> (n=<k>)`. | The wait of ready work on the controller is visible. |

## Alternative Flows
### A1
- Trigger: A slow command (`kf verify`, a full suite, a build) is needed while an item above still applies.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The controller runs the command with the runtime's background option, never in the foreground. | Ready seats are not held behind it; returns to main flow item 1. |
| A1.2 | The command exits and the exit gives the controller a turn. | The controller handles the result and continues from item 1. |

### A2
- Trigger: A task is held by an overlap or the cap (UC-002).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The controller ledgers the wait line `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` or `TASK-NNN: developer waits — 4 developers in flight`. | The gate line that `dispatch lag` reads is set. |
| A2.2 | On `TASK-MMM: complete` or the next `developer done`, the controller dispatches the waiting developer in the same turn. | The developer lag runs from that gate line to the dispatch; returns to main flow. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The controller would end its turn with an applicable item and nothing running, or runs `kf verify`, a suite or a build in the foreground while an item still applies. | This breaks the work-list rule. It shows as dispatch lag, because the ready seat waits. | `dispatch lag` developer `max` above 1.0 min in the scratch scenario run fails the acceptance criterion. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A dispatch has no parsable gate line in the ledger (for example a malformed wait line). | `kf loop-stats` does not count that dispatch in the lag. | `n` in `(n=<k>)` shows the counted dispatches; `n: 0` gives `median: null, max: null`, printed as `-`. |

## Postconditions
- No seat that was ready sat idle at the end of a controller turn.
- The ledger holds every owed line, so a resume rebuilds the work list from it alone.
- `kf loop-stats` reports `dispatch lag` for developers and code-reviewers; `--json` carries `dispatchLag.developer` and `dispatchLag.codeReviewer`, each `{ median, max, n }`; the `.works/loop-metrics.md` header is byte-identical.

## Business Rules
- The work list is ordered: dispatch ready seats, verify and review packages, next brief, scouts, owed ledger lines and reports.
- `kf verify`, a full suite and a build run in the background while any item applies.
- The controller ends its turn only when no item applies and a seat or background command is running.
- Developer lag is measured for each `TASK-NNN: developer dispatched` line without `round=`. It runs from the latest of: that task's `test-writer done`; each dependency's last `developer done`; the `TASK-MMM: complete` named by a `developer waits — Files overlap … (TASK-MMM)` line (read with `/\((TASK-\d+)\)$/`); the first `developer done` of any task after a `developer waits — 4 developers in flight` line.
- Code-reviewer lag is measured for each code-reviewer dispatch without `round=` or `cascade=`. It runs from the latest `developer done` or `automation-writer done` of that task.
- The lag measures the gap between the controller handling one event and dispatching the next seat. The time a notification takes to reach the controller is not visible in the ledger.
- `LEDGER_SHAPES` is unchanged; every gate line is an existing ledger shape.
- `loopStats(parsed, deps?)` takes the dependency map from `taskView(item)` `dependencies`. Without it the dependency gate is skipped.

## Data
- Ledger `loop/progress.md`: the lines `test-writer done`, `developer dispatched`, `developer done`, `developer waits`, `complete`, `automation-writer done`, `verify started` and `verify done`.
- `dispatchLag`: `{ developer: { median, max, n }, codeReviewer: { median, max, n } }`, in minutes with one decimal.
- Text line: `dispatch lag: developer median <m> max <m> (n=<k>), code-reviewer median <m> max <m> (n=<k>)`.
- Fixture `three-developers` ledger with its hand-computed `.expected.json`.

## Acceptance Criteria
- [ ] The kanban-implement prose carries the ordered five-item work list, the background rule for verify, suite and build, and the "end the turn only when nothing applies" rule, and surface tests pin each. (FR-011)
- [ ] On a fixture ledger, `kf loop-stats` prints `dispatch lag:` with the hand-computed developer and code-reviewer median and max, `--json` carries `dispatchLag`, and the history header is byte-identical. (FR-012)
- [ ] Each of the four developer gate lines and the code-reviewer gate (`developer done`, `automation-writer done`) is covered by a fixture dispatch. (FR-012)
- [ ] A dispatch with no gate line is not counted, and `n: 0` prints `-` in text and `null` in JSON. (FR-012)
- [ ] In the scratch scenario run, no ready developer waits more than 1 min for its dispatch: the developer `max` of `dispatch lag` is at most 1.0. (FR-011, FR-012)

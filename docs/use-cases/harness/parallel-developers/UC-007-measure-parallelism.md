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
| ID | UC-007 |
| Name | Measure the parallelism |
| Requirement reference | FR-009, FR-012, FR-010 |
| Goal | Measure the parallelism with `kf loop-stats` (developers peak, developer overlap) and the dispatch lag, so the human can see that concurrent developers actually ran |
| Primary actor | Human |

## Supporting Actors
- `kf loop-stats` (`src/workflow/loop-stats.ts`, `src/cli/commands/loop-stats.ts`): reads the ledger and computes the figures.
- `kf tasks` view (`taskView` `dependencies`): supplies the dependency map for the developer-lag gate.
- The controller: wrote every ledger line the figures are computed from.

## Preconditions
- A work item has a `loop/progress.md` ledger with `developer dispatched` and `developer done` lines, written by the in-session loop.
- For `--record`, `.works/loop-metrics.md` may exist; its header is the loop-throughput header and is not changed here.

## Trigger
The human runs `kf loop-stats <feature>` (optionally `--json`) after or during an implementation loop.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Human | Runs `kf loop-stats <feature>` | The command parses the ledger and passes `taskView(item)` `dependencies` to `loopStats` |
| 2 | System | Sweeps the developer seat intervals (`developersPeak`): an interval ending at t and another starting at t do not overlap | Peak = most developer intervals open at one instant |
| 3 | System | Sums the minutes with two or more developer intervals open (`developerOverlapMinutes`) | One-decimal minutes, like the other minute figures |
| 4 | System | For each first `TASK-NNN: developer dispatched` (no `round=`), takes the latest gate line before it: `test-writer done`, each dependency's last `developer done`, `TASK-MMM: complete` from a `developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` line, or the first `developer done` after a `developer waits — 4 developers in flight` line | Developer lag per dispatch (minutes) |
| 5 | System | For each code-reviewer dispatch without `round=` or `cascade=`, takes the latest `developer done` or `automation-writer done` of that task | Code-reviewer lag per dispatch |
| 6 | System | Prints `developers peak: <n>`, `developer overlap: <x.x> min` and `dispatch lag: developer median <m> max <m> (n=<k>), code-reviewer median <m> max <m> (n=<k>)` | The human reads whether developers overlapped and whether ready work waited on the controller |

## Alternative Flows
### A1
- Trigger: the human passes `--json`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The command prints `developersPeak`, `developerOverlapMinutes`, and `dispatchLag.developer` / `dispatchLag.codeReviewer`, each `{ median, max, n }` | Same figures as the text report; flow ends |

### A2
- Trigger: the human passes `--record`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The command appends the usual row to `.works/loop-metrics.md` | `HEADER`, `historyRow`, `recordRow`, `readHistory` and `summarise` are untouched; the header is byte-identical and carries no peak, overlap or lag column |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No developer interval overlaps (chained tasks, or one end equals the next start) | Sweep reports peak 1 (or 0 with no developers) and overlap 0 | `developers peak: 1`, `developer overlap: 0.0 min`; not an error |
| A dispatch has no gate line in the ledger, or the wait line has no parsable `(TASK-MMM)` | The dispatch is not counted | `n` is lower; with `n: 0` the median and max are `null` in JSON and `-` in text |
| `loopStats` called without a dependency map | The dependency gate is skipped | Remaining gates still apply |
| Unknown feature or no ledger | Existing `kf loop-stats` behavior | Unchanged exit code and message |

## Postconditions
- The human knows the peak number of concurrent developers, the minutes of real overlap and the dispatch lag of developers and code-reviewers.
- Nothing is written unless `--record` was given; `.works/loop-metrics.md` header unchanged.
- The ledger and its `LEDGER_SHAPES` are unchanged; the figures use existing line shapes only.

## Business Rules
- `developers peak` is the largest number of overlapping developer intervals; `developer overlap` counts minutes with two or more open (FR-009).
- Dispatch lag is measured only from ledger lines the controller wrote, so it shows the controller gap, not notification transit time (FR-012).
- Developer lag counts only first dispatches (no `round=`); code-reviewer lag excludes `round=` and `cascade=` dispatches.
- Medians use the existing median helper; minutes are rounded to one decimal.
- The docs that carry these figures (`docs/workflow/cli-reference.md`, `docs/workflow/harness.md`, `README.md`) must name `developers peak` and `dispatch lag`, pinned by `open-source-surface.test.ts` (FR-010).

## Data
- Ledger `loop/progress.md`: `developer dispatched`, `developer done`, `test-writer done`, `automation-writer done`, `developer waits — …`, `complete` lines with timestamps.
- Dependency map: `taskView(item)` `dependencies` per task.
- Output keys: `developersPeak`, `developerOverlapMinutes`, `dispatchLag.developer`, `dispatchLag.codeReviewer` (`{ median, max, n }`).
- Fixture: `src/tests/fixtures/loop-stats/three-developers` with a hand-computed `.expected.json`.

## Acceptance Criteria
- [ ] On the fixture ledger with 3 overlapping developer intervals, `kf loop-stats` prints `developers peak: 3` and the hand-computed `developer overlap` minutes; `--json` carries `developersPeak` and `developerOverlapMinutes` with the same values (FR-009).
- [ ] An interval ending at t and another starting at t give peak 1 and overlap 0 (FR-009).
- [ ] `dispatch lag:` prints the hand-computed developer and code-reviewer median and max, and `--json` carries `dispatchLag` (FR-012).
- [ ] A dispatch with no gate line is not counted and `n` shows the count; `n: 0` gives null/`-` (FR-012).
- [ ] The `.works/loop-metrics.md` header is byte-identical before and after (FR-009, FR-012).
- [ ] The docs (`docs/workflow/cli-reference.md`) describe the new figures, and surface tests pin them (FR-010).

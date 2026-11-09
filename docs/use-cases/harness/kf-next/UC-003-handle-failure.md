---
feature: kf-next
context: harness
created: 20261107_2256
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Handle a verify failure, a fix round and a cascade |
| Requirement reference | FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-014 |
| Goal | When a task's verify fails, its review finds problems, a seat ends with a status other than DONE, or a fix commit lands, the session is told the one correct next step by `kf next`, writes the owed ledger lines through `kf record`, and takes each judgement itself, so that no task completes early and no task gets a sixth round. |
| Primary actor | Controller session |

## Supporting Actors
- Human: re-approves the plan after a verify exit 2, and ends a `cap reached` stop.
- `kf next`: read-only query that names the due actions (`dispatch`, `verify`, `write`, `complete`, `wait`, `decide`, `stop`).
- `kf record`: writes one ledger line with the real clock and refuses a line the ledger contradicts.
- `kf verify`: runs the task's checks and returns exit 0, 1, 2 or 3.
- Developer, test-writer, automation-writer and code-reviewer seats: dispatched by the session as `Agent()` calls.

## Preconditions
- The item is in implementation, and at least one task has a `developer done` line with a commit.
- The ledger `loop/progress.md` is readable. Any line `kf next` cannot read is repaired first (FR-016), otherwise `kf next` exits 1 and schedules nothing.
- The plan's task graph is valid and `harness.developers` is valid. A failure of another config key reads the ceiling as 1 with a `decide`.
- The session has run the `verify` action `kf next` named, or a seat has ended and its status is in the ledger.

## Trigger
The session calls `kf next <feature>` after a `verify done exit=<n>` line, a code-reviewer's findings, a seat's ended status, a `reopened` note, or a fix commit. The output holds an action that belongs to failure handling: a held re-run, a fix round, a `stop`, a `decide`, a cascade re-review or a `complete`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller session | Runs the `verify` action `kf next` named, then records the result with `kf record <feature> verify done exit=<n>`, using the exit code `kf verify` itself returned. | The ledger holds the exit code, and `kf loop-stats` can check it against the verify log. |
| 2 | `kf next` | Routes by exit code. Exit 0: the verify passes and the task waits only for its review. Exit 1: if the verify log block is contention-shaped, step 3 comes first; otherwise a fix round is named once the task's review reports. Exit 2: a `stop`. Exit 3: a `decide`. | The session gets either a pass, a fix round, a `stop` or a `decide`, never a guess. |
| 3 | `kf next` | On a contention-shaped exit 1, names a `write` action for the `verify rerun` event and halves N once for that event. It then names the earliest held re-run once fewer than N developers are in flight, one re-run at a time, and releases no developer until the last held re-run has finished. | N is lowered, and each failed verify has exactly one plain re-run. A re-run that fails again never steps N down and goes on to step 2 as an ordinary exit 1. |
| 4 | Controller session | For an exit 1 that is not contention, waits for the code-reviewer's findings, then reads the `dispatch` action for the next fix round. | The verify output joins the review findings as one fix round. |
| 5 | `kf next` | Names the next fix round for a task with open findings, a kept verify failure, or a `reopened` note with no round seat after it. Rounds 1 to 3 resume the original developer. Rounds 4 and 5 dispatch a fresh developer, one tier up. It names the `fix round <R>/5` line as a `write` action. | The round number is read from the ledger and counts across the task, a reopened task's earlier rounds included. No sixth round is ever named. |
| 6 | Controller session | Dispatches the named developer with the open findings verbatim, or sends a finding about a test to the test-writer or a finding about a spec to the automation-writer, which stays the session's choice. A done seat of a `round=` is followed by a `test hashes` line and the resume-commit developer. Records the dispatch and the `fix round <R>/5` line with `kf record`. | The fix commit lands and is recorded in the task's `commits` line. |
| 7 | Controller session | Runs the scoped re-review the next `kf next` names, with `round=<R>`, over the round's fix commits only, and records its result. | Each finding is ADDRESSED or NOT ADDRESSED. New breakage joins the open list, and low findings are written as `minor (deferred)`. |
| 8 | `kf next` | Derives the cascade. When a fix commit of H landed after X's developer was dispatched and X depends on H directly or transitively, and X has no standing `complete` line, it names the owed `cascade re-review owed — after <sha7> of TASK-H` line as a `write` action, and then the re-review with `round=<R>` of H and `cascade=<sha7>`. | Only a dependent of H owes a re-review. An independent task owes nothing. Each owed line is answered by its own re-review, matched by its sha7. |
| 9 | `kf next` | Names a task's `complete` line as due only when, counting only lines after its latest `reopened` note: its developer is done, a verify passed after its last commit (or its failure was routed to another task whose next verify passed or parked it, or it was parked at the cap), its review is clean or every open finding is parked, no cascade of its own is unanswered, and every dependency is complete. | The task completes by this check alone. A task with all its own checks met is not complete while a dependency is incomplete. |
| 10 | Controller session | Records the `complete` line with `kf record`, and calls `kf next` again. | The next failure, or the next task, is named. |

## Alternative Flows
### A1
- Trigger: A verify exits 1 on tests in the Files of another open task X, or on a file another task has not committed yet.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The session applies the evidence rule of 3.2: it waits for X's running verify, and checks whether X's latest verify on a tree without H's fix commit passed those same tests. It is a judgement, so `kf next` does not decide it. | The cause is known: H broke the tests, X broke them, or H needs a file X has not committed. |
| A1.2 | If X caused it, the session writes `Note TASK-H: verify routed — TASK-X` and a `Ruling:` line naming the tests and the evidence, with `kf record`. `kf next` then names a fix round for X and keeps H unverified until X's next verify passes or X parks the failure at the cap. | H completes once X's next verify passes or X parks it, with the parked failure named in H's `complete` line. Return to main flow step 9. |
| A1.3 | If H needs a file X has not committed, the session writes `Note TASK-H: verify waits — <file> (TASK-X)`. `kf next` names an `--at-head` verify once X commits. | Neither note counts as a round. A `verify waits` note is never a fix round. Return to main flow step 1 with the new verify. |
| A1.4 | When the task the note names is held by this task's own overlap, the session stops and reports a plan defect, as `kf:implement` 3.2 says. `kf next` does not decide this. | |

### A2
- Trigger: A seat ends with `NEEDS_CONTEXT`, `BLOCKED` or `DONE_WITH_CONCERNS` (a `TEST_DISPUTE` reaches the ledger as `status=BLOCKED`).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf next` gives a `decide` action naming the status and the section 3.2 rule. The decide holds only its own task's later actions. | Other tasks keep running, and the task does not wait for ever. |
| A2.2 | For `NEEDS_CONTEXT` and `BLOCKED`, the session supplies the missing context, or a more capable model, or splits the task, then re-dispatches the seat. A `BLOCKED` that quotes `commit made` is closed by recording the `commits` line for that sha, not a re-commit. A `TEST_DISPUTE` goes to the test-writer, or to the human when it says a TC contradicts an FR. | The decide closes when the ledger gains a new dispatch of that seat, or the `commits` line. |
| A2.3 | For `DONE_WITH_CONCERNS`, the session reads the concerns. If the task goes on as for DONE, it records `Note TASK-NNN: decided — <what>`. | The decide closes. Return to main flow step 1. |

### A3
- Trigger: The task already has a `reopened` note because testing, review or CI failed, and a repair is due.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | `kf next` names a round for the reopened task even after a clean review, and the reopened task's first round seat waits for earlier overlapping tasks. | The repair is a normal fix round that continues the task's round count. |
| A3.2 | Any `complete` line before the latest `reopened` note is ignored by the completion check. | Return to main flow step 9 for the new `complete`. |

### A4
- Trigger: A verify failed and has no log block.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | `kf next` names one plain re-run before any step-down. | Return to main flow step 1. |

### A5
- Trigger: The session dispatches the cascade re-review for X, and H's repair was itself on a reopened H.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | `kf next` owes the re-review only to an X with no standing `complete` line. A complete dependent is reviewed again only after its own `reopened` note. | Return to main flow step 8. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `verify done exit=2`: a changed file is outside the task's Files. | `kf next` gives a `stop` that holds every new dispatch of the item. The session lets every seat in flight report and be recorded, then moves the item to planning with `kf stage <feature> planning`, edits the plan's Files, and the human re-approves with `kf approve`. The session records `Note TASK-NNN: decided — <what>`, after which `kf next` names the verify again. The session never widens Files and never commits to get past it. | The item is held until the `decided` note is written. The exit is never a fix round. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `verify done exit=3`: bad input such as an unknown task, a commit that is not a commit, an empty list or a missing worktree. | `kf next` gives a `decide`. The session fixes its own call and re-runs the verify. An exit 3 with `kf verify could not run: …` is reported to the human. | No round is counted, and the task's count of rounds is unchanged. |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Round 5 still leaves findings open for a task that was never reopened. | `kf next` gives a `decide` for the breaker and names no sixth round. The session adjudicates each open finding: a contestable one is parked as `TASK-NNN: parked — <finding> — Ruling: <why>`, and a load-bearing one gets a ruling on the smallest unblocking change. It then records `Note TASK-NNN: decided — <what>` after its `parked` lines. | The breaker is closed and the task can complete. A HIGH finding that is neither fixed nor parked with a ruling blocks completion, and so blocks every task that depends on it. Silent discards are forbidden. |

### E4

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A reopened task is found at the five-round cap. | `kf next` gives a `stop`, and the session writes `Note TASK-NNN: cap reached — <failure>` as a `write` action. The session lets seats in flight finish and reports to the human. That note with no later `complete` holds every new dispatch of the item. A reopened task never completes by parking. | The human ends the stop with `kf cancel`, or with `kf stage <feature> planning`, where the re-approved contract gives a new task its own five rounds. A `complete (… superseded by TASK-MMM)` or `… superseded by contract` line ends it. |

### E5

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A contention-shaped failure repeats for the same signature on the same task before a pass, or `harness.developers.max` is lowered mid-run, or its value is invalid. | N halves at most once per contention event and once per signature per task until a pass, never below 1. A lowered ceiling owes a ruling: seats above it finish and none are cancelled. An `invalid-config` ceiling reads 1 and a `decide` reports it, closed by a `Ruling:` quoting the error. | N stays the same or steps to 1, and no developer is cancelled. |

### E6

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf record` is given an event the ledger contradicts, for example a `done` with no open dispatch, or a repeat of a wait already recorded. | `kf record` refuses and writes nothing. The session reads the refusal, corrects the event, and calls `kf next` again. | The ledger is unchanged. Exit 1 from `kf record`. |

## Postconditions
- Every failure of the task is one of: passed, routed to another task, parked at the cap, or stopped for a human, and the ledger says which.
- No task has more than five rounds, and a fresh developer was used for rounds 4 and 5.
- Every owed cascade line has a re-review matched by its sha7, or the dependent is not complete.
- No task is `complete` while a dependency is incomplete, a cascade is unanswered, or its latest verify failed with no routing or parking.
- N reflects each contention event, and no developer was released while a held re-run was pending.
- An exit 2 `stop` or a `cap reached` stop has been reported, and the item dispatches nothing new until the human ends it.

## Business Rules
- Exit codes route only: 0 passes, 1 enters a fix round when the task's review reports, 2 is a `stop` for a plan change, and 3 is a `decide` and never a round.
- A contention-shaped failure goes before the routing of exit 1. A failed verify with no log block gets one plain re-run first. A re-run's failure never steps N down.
- A verify exit 1 inside another open task's Files is decided by the evidence rule, which stays with the session. `kf next` acts on the `verify waits` or `verify routed` note the session writes, and neither note counts as a round.
- Five rounds is the whole life of a task. Rounds count across the task, a reopened task's earlier rounds included, and all seats share one counter.
- Rounds 1 to 3 resume the original developer. Rounds 4 and 5 use a fresh developer one tier up.
- A re-review is scoped to the commits since the previous review and carries `round=<R>`.
- A cascade is derived from commits and dependencies only. Coupling the plan did not declare is not a cascade; the stage gate's full build and suite catch it.
- A `decide` holds its own task and no other task, and repeats until the ledger gains the line it names.
- Judgement stays with the session: the evidence rule, choosing which seat fixes a finding, the breaker's parking decision, routing a failure to another task, and `TEST_DISPUTE` handling.
- Where the spec does not restate a rule, `kf:implement` at 543cd17 governs.

## Data
- Ledger `loop/progress.md`: holds `verify done exit=<n>`, `verify rerun`, `verify waits`, `verify routed`, `fix round <R>/5`, `cascade re-review owed`, `reopened`, `cap reached`, `parked`, `decided` and `complete` lines. Written only through `kf record`.
- Verify log `loop/task-NNN-verify.log`: the block `kf next` reads to classify a failure as contention-shaped.
- Task report `loop/task-NNN-report.md`: the `Commits created` list used when a task has no `commits` line.
- Plan task graph: `dependencies` and `Files` of each task, read through the existing `kf tasks` code.
- `harness.developers.max`: the ceiling for N.
- `kf next --json` output: `{ "feature", "n", "actions": Action[] }`, with action kinds `dispatch`, `verify`, `write`, `complete`, `wait`, `decide`, `stop`.

## Acceptance Criteria
- [ ] A contention failure halves N once per event, and two failing verifies give two held re-runs with no developer released until both finish (FR-006, FR-007).
- [ ] A failed verify with no log block gets one plain re-run first, and a failed re-run never steps N down (FR-007).
- [ ] Verify exit 2 gives a `stop` that holds the item until its `decided` note, and exit 3 gives a `decide`; neither counts as a round (FR-008).
- [ ] A `verify routed` note moves the failure to the named task, and a `verify waits` note gives an `--at-head` verify once the named task commits and is never a fix round (FR-008).
- [ ] Rounds 1 to 3 resume the original developer, round 4 is a fresh developer, and no sixth round appears (FR-009).
- [ ] A task at the cap that was never reopened gets a breaker `decide`, closed by a `decided` note after its `parked` lines (FR-009).
- [ ] A reopened task at the cap gets a `stop` with its `cap reached` note as a `write`, and that note with no later `complete` holds every new dispatch (FR-009).
- [ ] A `reopened` note with no round seat names a round, even after a clean review, and a round counts across the reopen (FR-009).
- [ ] A fix commit of H owes a re-review to a dependent X dispatched before it, and not to an independent task or a complete one (FR-010).
- [ ] A task with an unanswered cascade is not complete (FR-010, FR-011).
- [ ] A task with all its own checks met is not complete while a dependency is incomplete (FR-011).
- [ ] A `complete` line before the latest `reopened` note does not count, and a reopened task never completes by parking (FR-011).
- [ ] A verify whose failure was routed to X completes once X's next verify passed or X parked it (FR-011).
- [ ] A seat ending in `NEEDS_CONTEXT`, `BLOCKED` or `DONE_WITH_CONCERNS` gives a `decide`, not a wait, that holds only its own task and repeats until the line it names is written (FR-014).
- [ ] A `BLOCKED` quoting `commit made` is closed by the `commits` line for that sha (FR-014).
- [ ] `kf record` refuses a contradicting event and writes nothing (FR-015).

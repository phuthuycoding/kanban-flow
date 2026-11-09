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
| ID | UC-001 |
| Name | Run a task loop from `kf next` |
| Requirement reference | FR-001, FR-002, FR-003, FR-004, FR-005, FR-015, FR-018, FR-019, FR-021 |
| Goal | The controller session runs an approved item's task loop by asking `kf next` what is due, dispatching every seat itself with `Agent()`, and writing each ledger line through `kf record`, until `kf next` reports the item finished. |
| Primary actor | Controller session |

## Supporting Actors
- `kf next`: the read-only query that prints the actions due now. It changes no file and leaves no process running.
- `kf record`: the writer that appends one stamped ledger line per call.
- Seats: the test-writer, developer, automation-writer and code-reviewer subagents, each started by the session as an `Agent()` call.
- Human: watches each seat in the transcript. Gains no new gate.

## Preconditions
- The item is in implementation: `kf approve` has started it, or the session started it from backlog on the human's decision.
- The plan holds a valid task graph with `Execution:` lines, a Test Strategy level and Test types in `phase-2-test-case.md`.
- The ledger `loop/progress.md` is absent or holds only lines `kf next` can read. A missing file reads as an empty ledger.
- `harness.developers.max` is valid. Otherwise `kf next` refuses like `kf tasks`.

## Trigger
The session runs `kf:implement` for the item, and after each seat returns, after each `kf record`, and after each verify it ran, it asks again with `kf next <feature> --json`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller session | Runs `kf next <feature> --json` for the item. | `kf next` reads the plan, the ledger, the task reports, the verify logs and the branch history. It prints every action due now and writes nothing. |
| 2 | `kf next` | On an empty ledger, names the pre-task conflict scan as a `decide` and releases no seat. | No test-writer or developer is released before the scan is closed. |
| 3 | Controller session | Does the scan, then runs `kf record` to write the `Scan:` line (`Scan: clean` for a clean scan or a plan with one task). | The scan is closed and the ledger has its first line, with the header written by that first `kf record`. |
| 4 | Controller session | Runs `kf next` again. | The output names test-writers for at most 4 tasks at once, counting those in flight, in wave then plan order, and never for a task held by an overlap. |
| 5 | Controller session | Writes each brief, then dispatches every named test-writer as its own `Agent()` call, and runs `kf record` for the dispatch and for the `wave <w>:` line that `kf next` names for same-wave test-writers. | The seats are visible in the transcript and the ledger holds one line per dispatch. |
| 6 | Controller session | For a task with no Unit or Integration test case, runs `kf record` for the `no test-writer` line with a reason it supplies. | The task is eligible for a developer. |
| 7 | Controller session | When a test-writer returns, runs `kf record` for `done` and for the `test hashes` line that `kf next` names as owed. | The task has hashes after its test-writer. |
| 8 | `kf next` | Releases a developer for a task only when its dependencies' developers have finished with a commit, it has hashes or a `no test-writer` line, its Files overlap no open task, no earlier overlapping task is incomplete, and fewer than N developers are in flight. | The session sees a `dispatch` action for each released developer. |
| 9 | Controller session | Writes the brief, dispatches each released developer with `Agent()`, and runs `kf record` for the dispatch. | Developer seats run, and the live count of developers in flight stays at or below N. |
| 10 | Controller session | When a developer returns, runs `kf record` for `done` and, from the report, for the `commits` note. | `kf next` can see the task's commit list in history order. |
| 11 | `kf next` | At the task's last commit, names the review package, the verify and the code-reviewer together. For a UI task under `Level: full` it first names the automation-writer after the developer's commit, then the resume-commit developer once the specs are done. | One call gives the session the whole post-commit step. |
| 12 | Controller session | Builds the review package, runs `kf record` for the `review package` line, runs the named `kf verify`, and dispatches the code-reviewer with `Agent()`. | Verify evidence and the review result are in the ledger and the task reports. |
| 13 | Controller session | Repeats from step 1 for every action `kf next` returns, writing each owed `write` action through `kf record` before asking again. | The loop advances task by task. |
| 14 | `kf next` | Names a `complete` action for a task when its developer is done, its verify passed after its last commit, its review is clean, no cascade is unanswered and its dependencies are complete. | The session runs `kf record` for the `complete` line. |
| 15 | `kf next` | When every task is complete, prints the `finished` action. A plan with no tasks is refused and never prints `finished`. | The session leaves the loop and goes on to the build verification that `kf:implement` defines. |

## Alternative Flows
### A1
- Trigger: `kf next` returns a `wait` action, for example because a task's Files overlap an open task, or N developers are in flight.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The session reads the reason in the `wait`, which names the holding task or the cap. It dispatches nothing for the held task. | No seat is started for the held task. |
| A1.2 | If the held developer's only cause is an overlap or the cap, `kf next` also returns a `write` action for its `developer waits` line. The session runs `kf record` for it once. | The wait is on the ledger once, and a repeat is not accepted. |
| A1.3 | The session dispatches any other released seats, waits for a running seat to return, then asks `kf next` again. | Return to step 1 of the main flow. |

### A2
- Trigger: `kf next` returns a `decide` action, which names a judgement rule by its `kf:implement` section.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The session applies the named rule, such as the conflict scan, a seat that ended with `NEEDS_CONTEXT`, `BLOCKED` or `DONE_WITH_CONCERNS`, or a DONE with no commit. | The judgement is made by the session, not by `kf next`. |
| A2.2 | The session runs `kf record` for the line the action names, such as `Scan:`, a `decided` note, or the `commits` note. | The ledger holds the answer. |
| A2.3 | The session asks `kf next` again. The `decide` holds only its own task and repeats until the line it names is written. | Return to step 1 of the main flow. Other tasks keep moving. |

### A3
- Trigger: the plan declares `Execution: wave <w> inline` and `kf next` marks a task in that wave as inline.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The session fills the developer seat itself, with no `Agent()` call, and does the same for that task's fix rounds. | The marked seat is outside the cap, so an inline task still starts when N is 1. |
| A3.2 | The session runs `kf record` for the dispatch, the inline note, `done` and the `commits` note, as for any developer. | The ledger shows the seat was inline. |
| A3.3 | If the session instead chooses a chain subagent for an inline wave, its `developer dispatched` line has no inline note after it, so it counts against N. | The count of developers in flight stays correct. Return to step 1 of the main flow. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf next` finds a ledger line it cannot read, or an unstamped line of one of the nine shapes, or a malformed scheduler line. This behaviour is specified in FR-016 and covered in UC-002. | `kf next` refuses to schedule and exits non-zero, naming each bad line. The session does not guess a schedule and does not dispatch a seat. It repairs the named lines and calls `kf next` again. | No seat is dispatched. The ledger is unchanged by `kf next`. The loop resumes at step 1 once every line reads. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf record` is given an event that is not in its fixed list, or that the ledger contradicts, such as `done` with no open dispatch or a repeat of a wait already recorded. | `kf record` writes nothing and exits non-zero with a message naming the contradiction. The session checks the latest `kf next` output, corrects the event or drops it, and does not edit `loop/progress.md` by hand. | The ledger is unchanged. If the event was real, the session records it after the correction, then asks `kf next` again. |

## Postconditions
- Every seat in the loop was an `Agent()` call from the session, or an inline seat the plan marked, and each is on the ledger.
- Every ledger line was written by `kf record` with the real clock, so `kf loop-stats` reads the ledger with no refusal.
- Each completed task has `developer done`, a passing verify after its last commit, a clean review or a closed breaker, and complete dependencies.
- No file was changed by `kf next`, and no process outlives either command.

## Business Rules
- The session is the only process that spawns seats. `kf next` names a seat and never fills it.
- `kf next` is a read-only query. Called twice with no change between the calls, it prints the same actions (FR-002).
- The live cap N counts developers in flight and never counts an inline seat. Fix-round and resume-commit developers count and take a freed seat before new tasks.
- At most 4 test-writers run at once, counting those in flight.
- A task with Files unknown overlaps everything, so its developer runs alone.
- Judgement stays with the session: briefs, model choice, judging findings, the conflict scan result and the reason for a `no test-writer` line.
- Where the spec does not restate a scheduling rule, `kf:implement` at 543cd17 governs, and a difference from it is a defect (FR-021).
- The ledger is changed only through `kf record`, and the nine ledger shapes do not change.

## Data
- Plan task graph: tasks, dependencies, Files, `Execution:` lines and the Test Strategy level, read from the implementation plan.
- Test cases: the Test types in `phase-2-test-case.md`, which decide whether a task gets a test-writer.
- Ledger `loop/progress.md`: the only scheduling state, read by `kf next` and appended by `kf record`.
- Task reports and verify logs: `loop/task-NNN-report.md` for `Commits created`, and `loop/task-NNN-verify.log` for verify results.
- Action: one item of `kf next` output, of kind `dispatch`, `verify`, `write`, `complete`, `wait`, `decide`, `stop` or `finished`, with a reason where the kind needs one. The JSON shape is settled in the plan.
- Live cap N: derived from `harness.developers.max` and the rulings on the ledger.

## Acceptance Criteria
- [ ] Given a plan and an empty ledger, `kf next --json` names the conflict scan and no seat. After a `Scan:` line, including `Scan: clean`, it names the first eligible test-writers, a `no test-writer` line for a task with no Unit or Integration test case, and no developer.
- [ ] Two runs of `kf next` in a row print identical output and leave every file's mtime unchanged.
- [ ] A task whose Files overlap an open task gets a `wait` naming the holding task, not a dispatch.
- [ ] With N developers in flight no further developer is released, and an inline task still starts at N = 1.
- [ ] After a non-UI developer's commit, one call names the review package, the verify and the code-reviewer together.
- [ ] A UI task under `Level: full` gets the automation-writer, then the resume-commit developer, then the package, verify and reviewer, and a task whose automation-writer ran ahead still gets the resume-commit developer.
- [ ] `kf record` refuses `done` with no open dispatch and writes nothing, and its first event writes the header.
- [ ] A `kf record` refusal and a `kf next` refusal each leave the session with a message that names what to correct, and neither lets a seat start.
- [ ] A ledger written through `kf record` is read by `kf loop-stats` with no refusal.
- [ ] A surface test finds none of the plan's moved-paragraph phrases in `skills/implement/SKILL.md`.

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
| ID | UC-002 |
| Name | Resume a loop after compaction |
| Requirement reference | FR-012, FR-013, FR-016, FR-019, FR-020 (also FR-015 for the `kf record` rules the resume relies on) |
| Goal | After compaction or in a new session, the controller session rebuilds the state of a task loop from the ledger and the item's files alone, and continues without a second source of truth, without re-dispatching a seat that already finished, and without losing track of a seat that did not. |
| Primary actor | Controller session |

## Supporting Actors
- `kf next --resume`: the read-only query that lists what is open and what is due. It changes no file and leaves no process running.
- `kf record`: the writer the session uses to close an open seat or note a decision. It refuses a line the ledger contradicts.
- Human: watches each re-dispatched seat in the transcript. No new gate is added.

## Preconditions
- The item is in implementation and its plan is approved. Its worktree, if it has one, exists.
- The session lost its context (compaction or a new session), so only `loop/progress.md`, the `loop/task-NNN-report.md` and `loop/task-NNN-verify.log` files, the plan and the item's branch history remain.
- The ledger may be empty, or may hold dispatches with no `done`, a verify with no `verify done`, a held re-run, or an inline task.
- An in-flight item with a well-formed ledger continues as it is. No migration is run.

## Trigger
The controller session starts again on an item that has ledger lines and calls `kf next <feature> --resume`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller session | Runs `kf next <feature> --resume` (adds `--json` when it wants structured data). | `kf next` reads the plan, the ledger, the reports, the verify logs and the branch history. It writes nothing. |
| 2 | `kf next` | Reads the ledger. If every line can be read, it goes on. | A ledger that cannot be read is Exception flow E1. A readable ledger gives the state of every task. |
| 3 | `kf next` | Rebuilds the live cap N from the latest `Ruling: developer cap` line and the decisions owed after it. | N is known before anything else is listed. Owed ruling lines come back as `write` actions. |
| 4 | `kf next` | For each seat that is open, meaning a dispatch with no `done` and no later dispatch of the same task and seat, decides between drift and re-dispatch (step 5). | Each open test-writer, code-reviewer, cascade re-review, automation-writer and developer is covered. |
| 5 | `kf next` | Where a task's report names a commit dated after that task's latest `developer dispatched` line and no `developer done` follows that line, it gives a `decide` for drift. Otherwise it lists the open seat for re-dispatch. | A drift `decide` holds its own task only. Every other open seat is listed as a re-dispatch. A lost developer is listed whatever N is, because N gates only new developers. |
| 6 | `kf next` | Lists every `verify started` that has no `verify done` for a re-run. A pending re-run is not listed. It stays held by the one-at-a-time rule for contention re-runs. | Open verifies are re-run before any new developer. A held re-run keeps its hold and releases no developer until it has finished. |
| 7 | `kf next` | For an open inline task, lists the seat for the session to resume itself. It is never listed as a spawn. | The inline task stays outside the cap and is not a spawn action. |
| 8 | `kf next` | Lists new work (test-writers, new developers up to N, completion lines, `finished`) only after the open seats and open verifies. | Resume work comes first, in the order the ledger implies. |
| 9 | Controller session | Dispatches each listed seat as an `Agent()` call, re-runs each listed verify itself, and records each new dispatch with `kf record`. For a drift `decide`, it inspects the report and the commit and records the `done`, or the decision, through `kf record`. | Each seat is visible in the transcript. The ledger gains the lines that close the actions. |
| 10 | Controller session | Calls `kf next <feature>` (or `--resume` again) and repeats until it prints `finished` or a `stop`. | The loop continues as it would in a session that never lost context. |

## Alternative Flows
### A1
- Trigger: a seat was open, but its dispatch was re-dispatched earlier (an honest orphan: a later dispatch of the same task and seat exists, and the earlier one never got a `done`).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf next --resume` reads the earlier dispatch as closed by the later one and lists only the latest dispatch if that one is still open. | The orphan appears neither in `--resume` nor in plain `kf next`. |
| A1.2 | The session later records a `done`. `kf record` ties it to the latest dispatch. | The earlier dispatch stays an honest orphan. Return to main flow at step 8. |

### A2
- Trigger: the session calls plain `kf next` (no `--resume`) while a seat is open.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf next` reads the open seat and open verify as in flight, because kf cannot tell a running seat from a lost one. | The seat is not listed for re-dispatch. A `wait` or an in-flight note is shown instead. |
| A2.2 | Where a drift condition holds (a report commit dated after the latest dispatch, no `done`), `kf next` still reads the seat as in flight and adds a hint that the report holds a commit. | A forgotten `done` is visible without a resume. The session may run `--resume` to turn the hint into a `decide`. Return to main flow at step 1 if it does. |

### A3
- Trigger: a held re-run is pending after a contention-shaped verify failure.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | `kf next --resume` does not list the held re-run while the cap or the one-at-a-time rule holds it. | The re-run stays held. Nothing in the resume path drops that hold. |
| A3.2 | No new developer is listed until the last held re-run has finished. Once fewer than N developers are in flight, the earliest held re-run is named. | The orphan re-run uses `--at-head` when a `verify waits` note comes after the task's last `verify done`. Return to main flow at step 8. |

### A4
- Trigger: the same `kf next --resume` is called twice with no change between the calls, because the session has not yet recorded the new dispatch.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | `kf next --resume` prints the same actions both times and lists the same open seat again. | The seat stays listed until the session records the new dispatch. Repeated calls are safe. Return to main flow at step 9. |

### A5
- Trigger: the plan was re-approved after the ledger was written, and the ledger names a task the plan no longer has.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A5.1 | `kf next --resume` gives a `decide` action naming that task and dispatches no seat for it. | The session decides what to do with the old task. The rest of the plan continues. Return to main flow at step 8. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The ledger has a line `kf next` cannot read: a line `parseLedger` marks unparsed, an unstamped line of the nine shapes, or a malformed or unstamped line the scheduler reads (cap rulings, `no step-up`, `verify rerun`, `verify waits`, `verify routed`, `no test-writer`, `test hashes`, `commits`, `decided`, `parked`, `reopened`, `cap reached`, or the inline note). A fixture such as `src/tests/fixtures/loop-stats/resumed.ledger.md` is in this group. | `kf next` refuses to schedule, whether or not `--resume` is given. It names each line it could not read and tells the session to repair it. It writes nothing and lists no action. The session repairs the ledger lines (by hand or by the repair route the skill names) and calls `kf next --resume` again. | Non-zero exit, no actions printed, each bad line named. A wrong schedule costs more than a stop, so an old ledger with such a line is repaired, never auto-accepted. After the repair, the flow resumes at main step 1. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The session calls `kf record` for a `done` with no open dispatch, or a repeat of a wait already recorded. | `kf record` refuses the event and writes nothing. | Non-zero exit and the reason given. The ledger is unchanged. The session calls `kf next --resume` to see what is actually open. |

## Postconditions
- Every open seat has been re-dispatched, resumed inline, or covered by a `decide`, and the ledger holds a new line for each.
- Every open verify has been re-run, or is held with the hold intact.
- No task with a `complete` line was re-dispatched unless a later `reopened` note reopened it.
- No file was changed by `kf next`. The only writes were the `kf record` lines the session made.
- The loop is back in its normal cycle, or has stopped on a ledger refused for repair (E1).

## Business Rules
- `kf next` and `kf next --resume` read only. They change no file, start no process and print the same actions when called twice with no change between them.
- "Open" means a dispatch with no `done` and no later dispatch of the same task and seat. An honest orphan stays closed.
- Without `--resume`, open seats and open verifies read as in flight, and a drift hint is added. Only the session knows it lost context.
- A drift `decide` takes precedence over a re-dispatch. It closes when the session records the `done`.
- A lost developer is listed whatever N is. N gates only new developer dispatches.
- A pending re-run keeps its hold, and no new developer is released until the last held re-run has finished.
- An inline developer is listed for the session to resume itself and is never a spawn. It does not count against N.
- A ledger line `kf next` cannot read stops scheduling. It is never skipped or guessed.
- Every seat stays an `Agent()` call from the session. `kf next` names seats and never spawns them.
- Where this use case does not restate a scheduling rule, `kf:implement` at 543cd17 governs, and a difference from it is a defect.

## Data
- `loop/progress.md`: the ledger. It is the only source of in-flight state and the input `kf next` reads first.
- `loop/task-NNN-report.md`: holds `Commits created`, used for the drift check and the commit list.
- `loop/task-NNN-verify.log`: the block of each verify run, used to tell a contention failure from another one.
- Plan inputs: the task graph, `Execution:` lines, Test Strategy level and `harness.developers.max`.
- Branch history: `git log` of the item's branch, read from its worktree when it has one.
- Fixture set under `src/tests/fixtures/kf-next/`: each fixture holds a ledger, the plan inputs and the expected actions. It covers a resume with an honest orphan, and the legacy `fix queued` shape.

## Acceptance Criteria
- [ ] `kf next --resume` lists an open seat for re-dispatch, and plain `kf next` lists it as in flight. An honest orphan appears in neither.
- [ ] A lost developer is listed under `--resume` even when N developers are in flight. A pending re-run stays held, and an inline developer is listed for the session to resume, not as a spawn.
- [ ] A report commit dated after the latest `developer dispatched` line, with no `developer done` after it, gives a drift `decide` under `--resume` and a hint without it. An older commit gives a re-dispatch.
- [ ] A `done` recorded after a resume re-dispatched the seat answers the latest dispatch, and the earlier dispatch stays an honest orphan.
- [ ] A malformed scheduler line or an unstamped `developer done` makes `kf next` exit non-zero, naming each line, and lists no action. `resumed.ledger.md` is refused.
- [ ] `kf next` returns the expected actions on every committed fixture of the set, including a resume with an honest orphan and the legacy `fix queued` shape. An in-flight item with a well-formed ledger continues without migration.
- [ ] `skills/implement/SKILL.md` no longer states the 12-step resume procedure, and its resume step points at `kf next --resume`. `kf:travel`'s resume reference points at the same command.

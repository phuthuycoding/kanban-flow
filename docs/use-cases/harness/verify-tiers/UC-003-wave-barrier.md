---
feature: verify-tiers
context: harness
created: 20261109_1701
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Hold the next wave until its predecessor's suite passes |
| Requirement reference | FR-004 |
| Goal | No developer builds on wave `w` until the full suite passed at a HEAD that contains every wave-`w` commit |
| Primary actor | kf CLI (`kf next`) |

## Supporting Actors
- Agent session (controller): runs the printed `kf verify <f> --wave <w>` and records `wave-verify-started` / `wave-verify-done`.

## Preconditions
- `harness.verify.stage` is pinned in `.kf/config.json`.
- The plan has at least two waves; `kf next` reads `<item>/loop/stage-verify.jsonl` as an input beside the ledger.

## Trigger
The controller runs `kf next <f>` while every task of wave `w` is complete and a task of a later wave is ready.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf CLI | Folds the ledger: every task of wave `w` has its `complete` line; no record with `wave: <w>` passes at a sha containing every wave-`w` commit | Wave `w` is not verified |
| 2 | kf CLI | Prints the action `verify wave <w>: kf verify <f> --wave <w>` (kind `verify-wave`, also in `--json`) | The controller has one wave verify to run |
| 3 | kf CLI | For each developer seat of a task in a later wave prints `wait TASK-NNN: wave <w> verify` | No later-wave developer is dispatched |
| 4 | kf CLI | Keeps dispatching test-writers of later waves | Failing tests for the next wave are written ahead |
| 5 | Agent session | Records `wave-verify-started <w>`, runs `kf verify <f> --wave <w>`, records `wave-verify-done <w> --exit 0` | A stage record with `wave: <w>` exit 0 is appended |
| 6 | kf CLI | Checks the latest `wave: <w>` record: exit 0 and `git merge-base --is-ancestor` holds for every wave-`w` task commit against its `sha` | Wave `w` is verified; the `wait` lines disappear and later-wave developers are dispatched |

## Alternative Flows
### A1
- Trigger: a wave-`w` task gets a later commit (a fix round after review, a reopen) after the wave passed.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf CLI finds a wave-`w` commit not contained in the passing record's `sha` | Wave `w` is owed again: `verify wave <w>` is printed and new later-wave developers wait (step 2) |

### A2
- Trigger: later-wave developers are already running when wave `w` becomes owed again.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | kf CLI applies the hold to new dispatches only | In-flight developer runs are not cancelled; they finish and are recorded as usual |

### A3
- Trigger: `harness.verify.stage` is not pinned, or the ledger is an old one with no wave lines.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | kf CLI builds no wave tier | No `verify-wave` action, no `wait ... wave` line; output equals today's |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf next --resume` finds `wave <w>: verify started` with no `wave <w>: verify done` | Lists the wave verify, not a task verify, for a re-run | The controller re-runs `kf verify <f> --wave <w>` |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A later-wave task waits on wave `w` and nothing names a TASK id for it | A wave edge is witnessed by the wave's action, its in-flight run or its decide | `kf next` never prints a `no rule` stop for a task that is only waiting on a wave |

## Postconditions
- Every later-wave developer dispatched had all earlier waves verified at a sha containing their commits.
- Test-writers of later waves were never held.

## Business Rules
- The barrier and the `verify-wave` action exist only when `harness.verify.stage` is non-empty.
- Wave `w` is verified by a passing record (tagged `wave: w`, tagged another wave, or a plain `--stage` record) in `<item>/loop/stage-verify.jsonl` whose `sha` contains every commit of wave `w`'s tasks (`git merge-base --is-ancestor`) and that is newer than the latest failing record tagged `wave: w`; an older passing record does not count after a newer failing one tagged `wave: w`. A task reopened by `Note TASK-NNN: reopened — wave w` is not held by wave `w`'s verify, and wave `w`'s verify is owed again only when every task such a note reopened is complete.
- A failed wave verify holds later-wave developers the same way (decide in UC-004).
- Only new developer dispatches are held; nothing running is cancelled.

## Data
- `<item>/loop/stage-verify.jsonl`: stage records (`sha`, `exit`, `clean`, optional `wave`), new input of `kf next`.
- `<item>/loop/progress.md`: ledger lines `wave <w>: verify started` / `wave <w>: verify done exit=<n>`.
- Action `{ kind: "verify-wave", wave, command }`.

## Acceptance Criteria
- [ ] With `harness.verify.stage` pinned and every task of wave `w` complete, `kf next` prints `verify wave <w>: kf verify <f> --wave <w>` until the latest `wave: <w>` record has exit 0 and a sha containing every wave-`w` commit. (TC-014)
- [ ] While wave `w` is not verified, each later-wave developer prints `wait TASK-NNN: wave <w> verify` and is not dispatched; later-wave test-writers are still dispatched; developers already in flight are not cancelled. (TC-014, TC-015)
- [ ] A passing wave record whose sha contains every wave-`w` commit releases the hold; a later commit of a wave-`w` task owes the wave verify again. (TC-015)
- [ ] Without `harness.verify.stage`, or on an old ledger with no wave lines, `kf next` output is identical to today's. (TC-016)
- [ ] `kf next --resume` with `wave <w>: verify started` and no done line lists the wave verify for a re-run; a task waiting on a wave is witnessed and never ends in a `no rule` stop. (TC-017, TC-018)

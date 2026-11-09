---
feature: kf-next
context: harness
created: 20261107_2254
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`, no UI.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | kf-next |
| Context | harness |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`vitest.config.ts`), `npm test` |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 45 | 45 | Rule modules and the state machine on in-memory inputs |
| Integration | 10 | 10 | The built CLI on a temp repository |
| UI / E2E | 0 | 0 | No UI in this feature |
| **Total** | **55** | **55** | **All must pass** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-015, FR-018, FR-019, FR-021, FR-022 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-029, TC-030, TC-031, TC-036, TC-039, TC-040, TC-041, TC-043, TC-044, TC-048, TC-049, TC-050, TC-051, TC-052 | 25 | All pass |
| UC-002 | FR-012, FR-013, FR-015, FR-016, FR-020, FR-024 | TC-025, TC-026, TC-027, TC-032, TC-033, TC-037, TC-038, TC-053 | 8 | All pass |
| UC-003 | FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-014, FR-023, FR-025, FR-026 | TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024, TC-028, TC-045, TC-046, TC-047, TC-049, TC-054, TC-055 | 20 | All pass |
| UC-004 | FR-017 | TC-034, TC-035, TC-042 | 3 | All pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-003, TC-040, TC-041 | yes | - |
| FR-002 | UC-001 | TC-004 | yes | - |
| FR-003 | UC-001 | TC-005, TC-006, TC-043 | yes | - |
| FR-004 | UC-001 | TC-002, TC-008, TC-044 | yes | - |
| FR-005 | UC-001, UC-003 | TC-009, TC-010, TC-011, TC-012 | yes | - |
| FR-006 | UC-003 | TC-013, TC-014, TC-045 | yes | - |
| FR-007 | UC-003 | TC-015, TC-016 | yes | - |
| FR-008 | UC-003 | TC-017, TC-018 | yes | - |
| FR-009 | UC-003 | TC-019, TC-020, TC-021 | yes | - |
| FR-010 | UC-003 | TC-022 | yes | - |
| FR-011 | UC-003 | TC-023, TC-024, TC-046 | yes | - |
| FR-012 | UC-002 | TC-025, TC-026 | yes | - |
| FR-013 | UC-002 | TC-027 | yes | - |
| FR-014 | UC-003 | TC-028, TC-047 | yes | - |
| FR-015 | UC-001, UC-002 | TC-029, TC-030, TC-031, TC-032, TC-048 | yes | - |
| FR-016 | UC-002 | TC-033 | yes | - |
| FR-017 | UC-004 | TC-034, TC-035, TC-042 | yes | - |
| FR-018 | UC-001 | TC-007 | yes | - |
| FR-019 | UC-001 | TC-036 | yes | - |
| FR-020 | UC-002 | TC-037, TC-038 | yes | - |
| FR-021 | UC-001 | TC-039, TC-052 | yes | - |
| FR-022 | UC-001 | TC-049, TC-050, TC-051 | yes | - |
| FR-023 | UC-003 | TC-049 | yes | - |
| FR-024 | UC-002 | TC-053 | yes | - |
| FR-025 | UC-003 | TC-054 | yes | - |
| FR-026 | UC-003 | TC-055 | yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Plan with three tasks and an empty ledger |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | A `decide` for the conflict scan and no seat |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | A `decide` for the conflict scan and no seat |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Ledger holding `Scan: clean`, one task with no Unit or Integration TC |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | Test-writers for eligible tasks, a `write` for `no test-writer`, no developer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | Test-writers for eligible tasks, a `write` for `no test-writer`, no developer |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Temp repository with a plan |
| Input | `kf next` and `kf next --json` |
| Steps | See steps table below |
| Expected outcome | Both list the same actions, and JSON holds `feature`, `n` and `actions` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf next` and `kf next --json` | Both list the same actions, and JSON holds `feature`, `n` and `actions` |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Temp repository mid-loop |
| Input | `kf next` twice |
| Steps | See steps table below |
| Expected outcome | Identical output, unchanged mtimes, no child process left |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf next` twice | Identical output, unchanged mtimes, no child process left |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Task whose Files overlap an open task |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | A `wait` naming the holder, and a `developer waits` `write` owed once |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | A `wait` naming the holder, and a `developer waits` `write` owed once |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | N developers in flight, one fix round waiting |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | No new developer; the freed seat goes to the fix round first |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | No new developer; the freed seat goes to the fix round first |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-018 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Inline task at N = 1, then a chain line in an inline wave |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | The inline task starts outside the cap; the chain seat counts against N |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | The inline task starts outside the cap; the chain seat counts against N |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Six eligible tasks, one test-writer in flight |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | Three more test-writers, and the `wave <w>:` line is named |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | Three more test-writers, and the `wave <w>:` line is named |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Non-UI developer done with a commit |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | One call names the package, the verify and the code-reviewer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | One call names the package, the verify and the code-reviewer |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | UI task under `Level: full` |
| Input | `seatActions()` at each step |
| Steps | See steps table below |
| Expected outcome | Automation-writer, resume-commit developer, then package, verify and reviewer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` at each step | Automation-writer, resume-commit developer, then package, verify and reviewer |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Automation-writer dispatched ahead of the developer |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | The resume-commit developer is still named |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | The resume-commit developer is still named |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Fix round with recorded fix commits |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | The re-review covers only those commits and carries `round=<R>` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | The re-review covers only those commits and carries `round=<R>` |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Clean parallel wave, then the last wave |
| Input | `liveCap()` |
| Steps | See steps table below |
| Expected outcome | N rises by one with the ruling owed; then a `no step-up` note |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `liveCap()` | N rises by one with the ruling owed; then a `no step-up` note |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Contention events at N = 4, 2 and 1, a lowered ceiling, `invalid-config` |
| Input | `liveCap()` |
| Steps | See steps table below |
| Expected outcome | N halves once per event, stays at 1, a ceiling ruling is owed, and `invalid-config` reads 1 with a `decide` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `liveCap()` | N halves once per event, stays at 1, a ceiling ruling is owed, and `invalid-config` reads 1 with a `decide` |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-007 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Two failing verifies in one event |
| Input | `liveCap()` |
| Steps | See steps table below |
| Expected outcome | The `Contention` view holds two re-runs, one at a time, with N halved once |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `liveCap()` | The `Contention` view holds two re-runs, one at a time, with N halved once |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-007 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | A failed verify with no log block, an orphan re-run |
| Input | `liveCap()` |
| Steps | See steps table below |
| Expected outcome | One plain re-run first; the orphan stays held under N |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `liveCap()` | One plain re-run first; the orphan stays held under N |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-008 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Verify exits 0, 1, 2 and 3 |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | Pass; a round after review; a `stop` holding the item until its `decided` note; a `decide` with no round |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | Pass; a round after review; a `stop` holding the item until its `decided` note; a `decide` with no round |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-008 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `verify waits` and `verify routed` notes |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | An `--at-head` verify after the neighbour commits; the failure moves to the named task |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | An `--at-head` verify after the neighbour commits; the failure moves to the named task |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-009 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Rounds 1 to 5 |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | Rounds 1 to 3 resume, 4 and 5 are fresh, no sixth round appears |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | Rounds 1 to 3 resume, 4 and 5 are fresh, no sixth round appears |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-009 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | `reopened` after a clean review; a reopened task at the cap |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | A round is named; a `stop` with `cap reached` owed, which holds every dispatch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | A round is named; a `stop` with `cap reached` owed, which holds every dispatch |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-009 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Round 5 with open findings; a `round=` test-writer done |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | A breaker `decide` closed by a `decided` note; hashes then a resume-commit developer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | A breaker `decide` closed by a `decided` note; hashes then a resume-commit developer |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-010 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | H's fix commit, H reopened, after dependent X, independent Y and complete Z were dispatched |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | Only X owes a re-review, with `round=<R>` of H and `cascade=<sha7>` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | Only X owes a re-review, with `round=<R>` of H and `cascade=<sha7>` |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-011 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Tasks with routed, parked and clean outcomes, one with an incomplete dependency |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | `complete` is due for the first three and not for the last |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | `complete` is due for the first three and not for the last |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-011 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | All tasks complete, one superseded, one `implemented` |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | `finished` prints |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | `finished` prints |

## TC-025

| Field | Detail |
|---|---|
| Test case ID | TC-025 |
| Requirement reference | FR-012 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | A seat with no `done`, an honest orphan |
| Input | `schedule()` with and without resume |
| Steps | See steps table below |
| Expected outcome | Listed for re-dispatch with resume, in flight without; the orphan appears in neither |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` with and without resume | Listed for re-dispatch with resume, in flight without; the orphan appears in neither |

## TC-026

| Field | Detail |
|---|---|
| Test case ID | TC-026 |
| Requirement reference | FR-012 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | A lost developer above N, a pending re-run, an inline task |
| Input | `schedule()` with resume |
| Steps | See steps table below |
| Expected outcome | The developer is listed, the re-run stays held, the inline task is not a spawn |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` with resume | The developer is listed, the re-run stays held, the inline task is not a spawn |

## TC-027

| Field | Detail |
|---|---|
| Test case ID | TC-027 |
| Requirement reference | FR-013 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Report commit newer, then older, than the latest dispatch |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | Drift `decide` with resume and a hint without; the older commit gives a re-dispatch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | Drift `decide` with resume and a hint without; the older commit gives a re-dispatch |

## TC-028

| Field | Detail |
|---|---|
| Test case ID | TC-028 |
| Requirement reference | FR-014 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Seats ending `NEEDS_CONTEXT`, `BLOCKED`, `DONE_WITH_CONCERNS` |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | A `decide` holding that task only, repeating until its closing line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | A `decide` holding that task only, repeating until its closing line |

## TC-029

| Field | Detail |
|---|---|
| Test case ID | TC-029 |
| Requirement reference | FR-015 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Ledger with no open dispatch |
| Input | `kf record` a `done` |
| Steps | See steps table below |
| Expected outcome | Exit 1, naming the problem, file unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf record` a `done` | Exit 1, naming the problem, file unchanged |

## TC-030

| Field | Detail |
|---|---|
| Test case ID | TC-030 |
| Requirement reference | FR-015 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | No ledger file |
| Input | `kf record` events, then `kf loop-stats --record` |
| Steps | See steps table below |
| Expected outcome | The header comes first, lines are stamped, loop-stats accepts them |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf record` events, then `kf loop-stats --record` | The header comes first, lines are stamped, loop-stats accepts them |

## TC-031

| Field | Detail |
|---|---|
| Test case ID | TC-031 |
| Requirement reference | FR-015 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Two concurrent `kf record` calls |
| Input | Parallel calls |
| Steps | See steps table below |
| Expected outcome | Exactly two whole lines, both accepted by `parseLedger` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run Parallel calls | Exactly two whole lines, both accepted by `parseLedger` |

## TC-032

| Field | Detail |
|---|---|
| Test case ID | TC-032 |
| Requirement reference | FR-015 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | A repeat wait, a second dispatch, a `done` after a re-dispatch |
| Input | `record` validation |
| Steps | See steps table below |
| Expected outcome | The wait is refused; the dispatch is allowed; the `done` answers the latest dispatch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `record` validation | The wait is refused; the dispatch is allowed; the `done` answers the latest dispatch |

## TC-033

| Field | Detail |
|---|---|
| Test case ID | TC-033 |
| Requirement reference | FR-016 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | A malformed cap ruling, an unstamped `developer done` |
| Input | `readLedgerState()` |
| Steps | See steps table below |
| Expected outcome | Refusal naming each line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `readLedgerState()` | Refusal naming each line |

## TC-034

| Field | Detail |
|---|---|
| Test case ID | TC-034 |
| Requirement reference | FR-017 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | A bug's `tasks.md`, one with no `TASK-###` |
| Input | `readLoopInputs()` |
| Steps | See steps table below |
| Expected outcome | Tasks in file order with Files unknown and the `regression` line marked; a `tasks.md` with no ids gives a refusal naming the fix |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `readLoopInputs()` | Tasks in file order with Files unknown and the `regression` line marked; a `tasks.md` with no ids gives a refusal naming the fix |

## TC-035

| Field | Detail |
|---|---|
| Test case ID | TC-035 |
| Requirement reference | FR-017 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | A bug item in a temp repository |
| Input | `kf verify --task` with a known and an unknown id |
| Steps | See steps table below |
| Expected outcome | Exit 0 with no Files check; exit 3 for the typo |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf verify --task` with a known and an unknown id | Exit 0 with no Files check; exit 3 for the typo |

## TC-036

| Field | Detail |
|---|---|
| Test case ID | TC-036 |
| Requirement reference | FR-019 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | The repository's skill text |
| Input | Surface test |
| Steps | See steps table below |
| Expected outcome | Moved phrases are gone, both commands are named, `tasks.md` creation writes `TASK-###`, travel points at `kf next --resume` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run Surface test | Moved phrases are gone, both commands are named, `tasks.md` creation writes `TASK-###`, travel points at `kf next --resume` |

## TC-037

| Field | Detail |
|---|---|
| Test case ID | TC-037 |
| Requirement reference | FR-020 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture set under `src/tests/fixtures/kf-next/` |
| Input | `schedule()` on each |
| Steps | See steps table below |
| Expected outcome | Actions equal each fixture's expected file, legacy `fix queued` included |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` on each | Actions equal each fixture's expected file, legacy `fix queued` included |

## TC-038

| Field | Detail |
|---|---|
| Test case ID | TC-038 |
| Requirement reference | FR-020 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `src/tests/fixtures/loop-stats/resumed.ledger.md` |
| Input | `readLedgerState()` |
| Steps | See steps table below |
| Expected outcome | Refused, naming its broken lines |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `readLedgerState()` | Refused, naming its broken lines |

## TC-039

| Field | Detail |
|---|---|
| Test case ID | TC-039 |
| Requirement reference | FR-021 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture from the `adaptive-developer-cap` ledger with its plan, test cases and verify logs |
| Input | `schedule()` at the prefix right before each test-writer, developer or code-reviewer `dispatched` line |
| Steps | See steps table below |
| Expected outcome | That seat is among the actions |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` at the prefix right before each test-writer, developer or code-reviewer `dispatched` line | That seat is among the actions |

## TC-040

| Field | Detail |
|---|---|
| Test case ID | TC-040 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | A generated 1,000-line ledger in a temp git repository |
| Input | the built `kf next`, median of three runs |
| Steps | See steps table below |
| Expected outcome | Under 1 second |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the built `kf next`, median of three runs | Under 1 second |

## TC-041

| Field | Detail |
|---|---|
| Test case ID | TC-041 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | An invalid graph, a bad `harness.developers`, an empty plan, a ledger task the plan lost, a worktree item run from the main checkout |
| Input | `kf next` |
| Steps | See steps table below |
| Expected outcome | Exit 1 with the `kf tasks` message for the invalid graph and the bad value; exit 1 for the empty plan; a `decide` for the lost task; commits read from the item's branch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf next` | Exit 1 with the `kf tasks` message for the invalid graph and the bad value; exit 1 for the empty plan; a `decide` for the lost task; commits read from the item's branch |

## TC-042

| Field | Detail |
|---|---|
| Test case ID | TC-042 |
| Requirement reference | FR-017 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | A bug with two `TASK-###` lines, one `regression` |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | They run one after the other, and only the `regression` line gets a test-writer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | They run one after the other, and only the `regression` line gets a test-writer |

## TC-043

| Field | Detail |
|---|---|
| Test case ID | TC-043 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | A dependency with no commit, a task with no hashes, Files unknown, an earlier overlapping task incomplete |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | No developer for any of them, each with its reason |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | No developer for any of them, each with its reason |

## TC-044

| Field | Detail |
|---|---|
| Test case ID | TC-044 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | A test-writer's task held by an overlap |
| Input | `seatActions()` |
| Steps | See steps table below |
| Expected outcome | No test-writer for it |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `seatActions()` | No test-writer for it |

## TC-045

| Field | Detail |
|---|---|
| Test case ID | TC-045 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | An empty ledger with max 6 and max 1; a second failure with one signature before a pass; each `no step-up` reason |
| Input | `liveCap()` |
| Steps | See steps table below |
| Expected outcome | Start ruling at min(2, max); one step down per signature per task; each reason named |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `liveCap()` | Start ruling at min(2, max); one step down per signature per task; each reason named |

## TC-046

| Field | Detail |
|---|---|
| Test case ID | TC-046 |
| Requirement reference | FR-011 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | A `complete` before the latest `reopened`; a reopened task with parked findings |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | The old line is ignored, and the task never completes by parking |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | The old line is ignored, and the task never completes by parking |

## TC-047

| Field | Detail |
|---|---|
| Test case ID | TC-047 |
| Requirement reference | FR-014 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | A `BLOCKED` seat whose reply quotes `commit made` |
| Input | `routingActions()` |
| Steps | See steps table below |
| Expected outcome | A `decide` closed by the `commits` note |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `routingActions()` | A `decide` closed by the `commits` note |

## TC-048

| Field | Detail |
|---|---|
| Test case ID | TC-048 |
| Requirement reference | FR-015 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | An unknown event; free text starting with a dash after `--` |
| Input | `kf record` |
| Steps | See steps table below |
| Expected outcome | Exit 1 with the file unchanged; the line is written |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf record` | Exit 1 with the file unchanged; the line is written |

## TC-049

| Field | Detail |
|---|---|
| Test case ID | TC-049 |
| Requirement reference | FR-022 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Each ledger of the liveness audit (reviews/liveness-audit.md) with its plan and inputs |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | `finished` or a witness for every incomplete task (`checkLiveness`); every `complete` agrees with the independent oracle; recording each printed write and re-running prints that write no more |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | `finished` or a witness for every incomplete task; no silent, deadlocked, repeated or premature result |

## TC-050

| Field | Detail |
|---|---|
| Test case ID | TC-050 |
| Requirement reference | FR-022 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Every phase of every region and every ledger event |
| Input | the region tables and the judgement table |
| Steps | See steps table below |
| Expected outcome | Every (phase, event) cell exists (a missing one fails `tsc`); every closes alternative is accepted by `kf record` and changes the task's state |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the region tables and the judgement table | Every (phase, event) cell exists (a missing one fails `tsc`); every closes alternative is accepted by `kf record` and changes the task's state |

## TC-051

| Field | Detail |
|---|---|
| Test case ID | TC-051 |
| Requirement reference | FR-022 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Six small plans at ceilings 1 and 2 |
| Input | the bounded explorer over every state reachable through `kf record` events |
| Steps | See steps table below |
| Expected outcome | Within depth 80 and 30,000 states: no silent, deadlocked or repeating state; the independent oracle agrees with every printed `complete`; the liveness guard stop never appears |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the bounded explorer over every state reachable through `kf record` events | No silent, deadlocked or repeating state; the independent oracle agrees with every printed `complete`; the liveness guard stop never appears |

## TC-052

| Field | Detail |
|---|---|
| Test case ID | TC-052 |
| Requirement reference | FR-021 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | The fixture prefixes, the replay prefixes and the audit ledgers |
| Input | `schedule()` beside the legacy scheduler |
| Steps | See steps table below |
| Expected outcome | Every difference is tagged with an audit id; none otherwise. Retired with the legacy scheduler at TASK-024; its ledgers stay in TC-049 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` beside the legacy scheduler | Every difference is tagged with an audit id; none otherwise |

## TC-053

| Field | Detail |
|---|---|
| Test case ID | TC-053 |
| Requirement reference | FR-024 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | An orphan developer seat of a complete or unknown task, a chain seat, a resumed seat under a stop |
| Input | `schedule()` with and without `--resume` |
| Steps | See steps table below |
| Expected outcome | The orphan holds no cap slot; the chain seat resumes inline; the resumed seat prints under the stop |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` with and without `--resume` | The orphan holds no cap slot; the chain seat resumes inline; the resumed seat prints under the stop |

## TC-054

| Field | Detail |
|---|---|
| Test case ID | TC-054 |
| Requirement reference | FR-025 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | A task owing its own review and two cascade re-reviews; a legacy ledger with stacked reviewer dispatches |
| Input | `schedule()` |
| Steps | See steps table below |
| Expected outcome | One reviewer at a time, the others wait `code-reviewer of TASK-NNN in flight` oldest first; the overwritten review is owed again |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` | One reviewer at a time, the others wait `code-reviewer of TASK-NNN in flight`; the overwritten review is owed again |

## TC-055

| Field | Detail |
|---|---|
| Test case ID | TC-055 |
| Requirement reference | FR-026 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | A task at the Breaker and a reopened task at the cap stop, each with a minimal-fix note; the fix failing; the fix abandoned; cascade findings after the fix; a pre-fix verify finishing after the note; a compaction before the fix dispatch |
| Input | `schedule()` with and without `--resume` |
| Steps | See steps table below |
| Expected outcome | The fresh round-less fix developer is named until dispatched; failure brings back the Breaker or the stop; a pre-fix verify does not count; a second note owes nothing |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `schedule()` with and without `--resume` | The fresh round-less fix developer is named until dispatched; failure brings back the Breaker or the stop; a pre-fix verify does not count; a second note owes nothing |

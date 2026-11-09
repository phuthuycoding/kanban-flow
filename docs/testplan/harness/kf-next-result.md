---
feature: "kf-next"
context: "harness"
tested: "20261109_1150"
execution: "0a49244d-f578-4db7-a581-0bc6d9fc6374"
status: PASS
---

# Testing Result

## Feature
kf-next

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node.js v22.21.0
- Tooling: vitest 2 with @vitest/coverage-v8; tsc; oxlint; the built CLI `dist/index.js` in the item worktree `.worktrees/kf-next` (branch `phuthuycoding/kf-next`, HEAD aef4f79)

## Execution Time
2026-11-09 11:46–11:52 +07:00 (re-test after the review c212dc7b FAIL repair loop)

## Summary
| Metric | Result |
|---|---:|
| Total | 55 |
| Passed | 55 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

Test level: unit+integration (45 Unit, 10 Integration test cases). Whole suite: 115 test files, 2983 tests, 2983 passed, 0 skipped. The `next-*` files hold 1178 tests: next-audit 146, next-intents 108, next-schedule 99, next-fold 91, next-arbiter 79, next-machine-routing 77, next-machine 73, next-judgements 68, next-ledger-state 63, next-verify-region 56, next-machine-seats 49, next-cap 47, next-surface 45, next-atcap 41, next-review-region 36, next-inputs 35, next-record 33, next-liveness 25, next-liveness-check 13, next-cli 12, next-bug-verify 5.

Repair since the last execution (review c212dc7b FAIL): loop-stats gates a developer released by a later overlapping seat on that seat's done (29aad73); the audit expectations live in their fixtures, the lost-contention fixture holds its re-run behind the cap and the symptom codes are checked against fixture indexes (4ce5a3e); the overlap and dependency wait texts are pinned per seat and the minimal-fix tests assert a positive outcome (aef4f79).

Since the last execution (dad1def7): the scheduler is now one state machine (fold → intents → arbiter → liveness guard; TASK-012 to TASK-019), the seat and routing tests are ported to machine tests (TASK-020, TASK-021), the legacy scheduler and its modules are removed (TASK-024), and a bounded explorer (TASK-022) checks every state an obedient session reaches through `kf record` from six small plans at ceilings 1 and 2; the defects it found (V1–V6, S1, S2, a second minimal-fix note) are fixed in TASK-025.

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | A `decide` for the conflict scan and no seat | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-002 | Unit | PASS | Test-writers for eligible tasks, a `write` for `no test-writer`, no developer | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-003 | Integration | PASS | Both list the same actions, and JSON holds `feature`, `n` and `actions` | Passed in `next-cli.test.ts` (12), `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-004 | Integration | PASS | Identical output, unchanged mtimes, no child process left | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-005 | Unit | PASS | A `wait` naming the holder, and a `developer waits` `write` owed once | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-006 | Unit | PASS | No new developer; the freed seat goes to the fix round first | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-007 | Unit | PASS | The inline task starts outside the cap; the chain seat counts against N | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-008 | Unit | PASS | Three more test-writers, and the `wave <w>:` line is named | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-009 | Unit | PASS | One call names the package, the verify and the code-reviewer | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-010 | Unit | PASS | Automation-writer, resume-commit developer, then package, verify and reviewer | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-011 | Unit | PASS | The resume-commit developer is still named | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-012 | Unit | PASS | The re-review covers only those commits and carries `round=<R>` | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-013 | Unit | PASS | N rises by one with the ruling owed; then a `no step-up` note | Passed in `next-cap.test.ts` (47) | `npx vitest run --coverage` 2983/2983 |
| TC-014 | Unit | PASS | N halves once per event, stays at 1, a ceiling ruling is owed, and `invalid-config` reads 1 with a `decide` | Passed in `next-cap.test.ts` (47) | `npx vitest run --coverage` 2983/2983 |
| TC-015 | Unit | PASS | The `Contention` view holds two re-runs, one at a time, with N halved once | Passed in `next-cap.test.ts` (47) | `npx vitest run --coverage` 2983/2983 |
| TC-016 | Unit | PASS | One plain re-run first; the orphan stays held under N | Passed in `next-cap.test.ts` (47) | `npx vitest run --coverage` 2983/2983 |
| TC-017 | Unit | PASS | Pass; a round after review; a `stop` holding the item until its `decided` note; a `decide` with no round | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-018 | Unit | PASS | An `--at-head` verify after the neighbour commits; the failure moves to the named task | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-019 | Unit | PASS | Rounds 1 to 3 resume, 4 and 5 are fresh, no sixth round appears | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-020 | Unit | PASS | A round is named; a `stop` with `cap reached` owed, which holds every dispatch | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-021 | Unit | PASS | A breaker `decide` closed by a `decided` note; hashes then a resume-commit developer | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-022 | Unit | PASS | Only X owes a re-review, with `round=<R>` of H and `cascade=<sha7>` | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-023 | Unit | PASS | `complete` is due for the first three and not for the last | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-024 | Unit | PASS | `finished` prints | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-025 | Unit | PASS | Listed for re-dispatch with resume, in flight without; the orphan appears in neither | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-026 | Unit | PASS | The developer is listed, the re-run stays held, the inline task is not a spawn | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-027 | Unit | PASS | Drift `decide` with resume and a hint without; the older commit gives a re-dispatch | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-028 | Unit | PASS | A `decide` holding that task only, repeating until its closing line | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-029 | Integration | PASS | Exit 1, naming the problem, file unchanged | Passed in `next-record.test.ts` (33) | `npx vitest run --coverage` 2983/2983 |
| TC-030 | Integration | PASS | The header comes first, lines are stamped, loop-stats accepts them | Passed in `next-record.test.ts` (33) | `npx vitest run --coverage` 2983/2983 |
| TC-031 | Integration | PASS | Exactly two whole lines, both accepted by `parseLedger` | Passed in `next-record.test.ts` (33) | `npx vitest run --coverage` 2983/2983 |
| TC-032 | Unit | PASS | The wait is refused; the dispatch is allowed; the `done` answers the latest dispatch | Passed in `next-record.test.ts` (33) | `npx vitest run --coverage` 2983/2983 |
| TC-033 | Unit | PASS | Refusal naming each line | Passed in `next-ledger-state.test.ts` (63) | `npx vitest run --coverage` 2983/2983 |
| TC-034 | Unit | PASS | Tasks in file order with Files unknown and the `regression` line marked; a `tasks.md` with no ids gives a refusal naming the fix | Passed in `next-inputs.test.ts` (35) | `npx vitest run --coverage` 2983/2983 |
| TC-035 | Integration | PASS | Exit 0 with no Files check; exit 3 for the typo | Passed in `next-bug-verify.test.ts` (5) | `npx vitest run --coverage` 2983/2983 |
| TC-036 | Integration | PASS | Moved phrases are gone, both commands are named, `tasks.md` creation writes `TASK-###`, travel points at `kf next --resume` | Passed in `next-surface.test.ts` (45) | `npx vitest run --coverage` 2983/2983 |
| TC-037 | Unit | PASS | Actions equal each fixture's expected file, legacy `fix queued` included | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-038 | Unit | PASS | Refused, naming its broken lines | Passed in `next-ledger-state.test.ts` (63) | `npx vitest run --coverage` 2983/2983 |
| TC-039 | Unit | PASS | That seat is among the actions | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-040 | Integration | PASS | Under 1 second | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-041 | Integration | PASS | Exit 1 with the `kf tasks` message for the invalid graph and the bad value; exit 1 for the empty plan; a `decide` for the lost task; commits read from the item's branch | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-042 | Unit | PASS | They run one after the other, and only the `regression` line gets a test-writer | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-043 | Unit | PASS | No developer for any of them, each with its reason | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-044 | Unit | PASS | No test-writer for it | Passed in `next-machine-seats.test.ts` (49) | `npx vitest run --coverage` 2983/2983 |
| TC-045 | Unit | PASS | Start ruling at min(2, max); one step down per signature per task; each reason named | Passed in `next-cap.test.ts` (47) | `npx vitest run --coverage` 2983/2983 |
| TC-046 | Unit | PASS | The old line is ignored, and the task never completes by parking | Passed in `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-047 | Unit | PASS | A `decide` closed by the `commits` note | Passed in `next-machine-routing.test.ts` (77) | `npx vitest run --coverage` 2983/2983 |
| TC-048 | Integration | PASS | Exit 1 with the file unchanged; the line is written | Passed in `next-record.test.ts` (33) | `npx vitest run --coverage` 2983/2983 |
| TC-049 | Unit | PASS | `finished` or a witness for every incomplete task (`checkLiveness`); every `complete` agrees with the independent oracle; recording each printed write and re-running prints that write no more | Passed in `next-audit.test.ts` (146) | `npx vitest run --coverage` 2983/2983 |
| TC-050 | Unit | PASS | Every (phase, event) cell exists (a missing one fails `tsc`); every closes alternative is accepted by `kf record` and changes the task's state | Passed in `next-arbiter.test.ts` (79), `next-atcap.test.ts` (41), `next-fold.test.ts` (91), `next-intents.test.ts` (108), `next-judgements.test.ts` (68), `next-liveness-check.test.ts` (13), `next-review-region.test.ts` (36), `next-verify-region.test.ts` (56) | `npx vitest run --coverage` 2983/2983 |
| TC-051 | Unit | PASS | Within depth 80 and 30,000 states: no silent, deadlocked or repeating state; the independent oracle agrees with every printed `complete`; the liveness guard stop never appears | Passed in `next-liveness.test.ts` (25) | `npx vitest run --coverage` 2983/2983 |
| TC-052 | Unit | PASS | Every difference is tagged with an audit id; none otherwise. Retired with the legacy scheduler at TASK-024; its ledgers stay in TC-049 | Passed in `next-audit.test.ts` (146) (retired with the legacy scheduler; its ledgers kept in TC-049) | `npx vitest run --coverage` 2983/2983 |
| TC-053 | Unit | PASS | The orphan holds no cap slot; the chain seat resumes inline; the resumed seat prints under the stop | Passed in `next-machine.test.ts` (73), `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-054 | Unit | PASS | One reviewer at a time, the others wait `code-reviewer of TASK-NNN in flight` oldest first; the overwritten review is owed again | Passed in `next-machine.test.ts` (73), `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |
| TC-055 | Unit | PASS | The fresh round-less fix developer is named until dispatched; failure brings back the Breaker or the stop; a pre-fix verify does not count; a second note owes nothing | Passed in `next-machine.test.ts` (73), `next-schedule.test.ts` (99) | `npx vitest run --coverage` 2983/2983 |

The TC-to-file mapping comes from the plan's Test Case Map: TASK-020 and TASK-021 ported TASK-005's and TASK-006's cases into `next-machine-seats.test.ts` and `next-machine-routing.test.ts` when TASK-024 removed `next-seats.test.ts` and `next-routing.test.ts`. The number after each file is its test count in this run.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npm run build | 0 | dist/index.js built |
| npm run typecheck | 0 | tsc --noEmit, no errors |
| npm run lint | 0 | no errors; 1 existing warning (src/tests/next-judgements.test.ts:68, prefer startsWith) |
| npx vitest run --coverage --coverage.include=src/workflow/next/** | 0 | Test Files 115 passed (115); Tests 2983 passed (2983) |
| kf verify kf-next --stage | 0 | All 2 stage verify command(s) passed (npm run build, npm test) at aef4f79 |
| kf loop-stats kf-next | 0 | untimed lines 0; developers peak 3 |

## Behaviour run

From the worktree with `node dist/index.js` against this item's own ledger (`loop/progress.md`):
- `kf next kf-next` twice → exit 0 both, identical output `finished` / `In flight: none`; ledger md5 unchanged before and after (the query writes nothing); no `dist/index.js next` process left afterwards (FR-002).
- `kf next kf-next --resume` → exit 0, `finished`.
- `kf next kf-next --json` → `{"feature":"kf-next","n":3,"inFlight":[],"actions":[{"kind":"finished"}]}`.
- The loop of TASK-022 and TASK-025 itself ran on the state machine: every ledger line was written through `kf record`, and `kf next` named each seat, the Commit missing decide, the Seat status decide, the cascade re-review owed after 1c12408, the fix-round lines and both completions.

Changed behaviour no test touches: `src/cli/commands/next.ts` and `record.ts` run in child processes (counted 0% in-process); the four-test-writer window hold is quiet and no explorer plan reaches it (ledgered minor). Not run: a fresh item driven end to end by the rewritten skill — this item's own loop is the closest run.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | - | - | - |

## Coverage

Target 80%. v8 on `src/workflow/next/**`: statements 98.89% (3044/3078), branches 94.88% (2431/2562), functions 95.3% (365/383), lines 98.89% (3044/3078).

## Conclusion

PASS: 55/55 test cases, the full suite 2983/2983, build, typecheck, lint and the stage verify exit 0, coverage 98.89% against 80%.

---
feature: "loop-throughput"
context: "harness"
tested: "20261101_2006"
execution: "a4545dd8-3714-47c6-9b8f-a8da87638ba0"
status: PASS
---

# Testing Result

## Feature
loop-throughput

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node v22.21.0
- Tooling: vitest 2.1.9 with @vitest/coverage-v8; the worktree build `node dist/index.js`. Item worktree: `.worktrees/loop-throughput` at 3815f81 (re-test after review repair TASK-008: a4a5ae8, 3815f81).

## Execution Time
2026-11-01, 19:40–20:05 (+07:00) first execution 6454fef5; re-test 20:06–20:12 (+07:00) for execution a4545dd8

## Summary
| Metric | Result |
|---|---:|
| Total | 39 |
| Passed | 39 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

33 of the 39 TCs are pinned by automated tests. TC-030 and TC-032 were run for real. TC-021, TC-025, TC-028 and TC-029 test controller behaviour written as skill prose. For those, the evidence is a desk simulation by a fresh agent that read only the new skill text, plus this item's own task-loop ledger. They were not run as a live controller session on a scratch item. See "Behaviour run" below.

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001–TC-003 | Integration | PASS | review-package `--commits` concatenates the listed commits; range mode is unchanged | 14/14 | src/tests/review-package.test.ts |
| TC-004–TC-012 | Integration / Unit | PASS | `kf verify --commits` checks Files, runs in a detached worktree at the newest commit, exits 3 on bad input, and cleans up | 51/51 + 26/26 | src/tests/verify.test.ts, src/tests/allowlist.test.ts |
| TC-013, TC-014 | Unit | PASS | `kf tasks --json` gives `overlaps` / `firstOverlap`; text rows are unchanged | 11/11 + 20/20 | src/tests/tasks-command.test.ts, src/tests/task-graph.test.ts |
| TC-015–TC-020, TC-022, TC-039 | Unit / Integration | PASS | The SKILL.md / task-loop.md / brief prose carries the pipelined-loop contract | 29/29 | src/tests/loop-parallel-surface.test.ts |
| TC-023, TC-024, TC-033, TC-035, TC-036 | Unit / Integration | PASS | The ledger grammar, resume steps, measurement report and travel measure are in place | 20/20 + 20/20 | src/tests/loop-ledger-surface.test.ts, src/tests/travel-surface.test.ts |
| TC-026, TC-027, TC-031, TC-034, TC-037 | Unit / Integration | PASS | `kf loop-stats` figures, unparsed/untimed lines, `--record`, `--all`, `largest:` | 35/35 | src/tests/loop-stats.test.ts |
| TC-038 | Unit | PASS | The docs describe `--commits`, `loop-stats`, overlaps and pipelining | 31/31 | src/tests/open-source-surface.test.ts |
| TC-021 | Integration | PASS (simulated + own ledger) | Disjoint pair: a `parallel test-writers` line, overlapping test-writer intervals and non-overlapping developer intervals. Shared pair: an overlap wait line | Simulation S1: `wave 1: parallel test-writers TASK-001, TASK-002 — disjoint Files`; developer intervals 09:04–09:07:20, 09:07:35–09:11:20 and 09:14:10–09:17:30 do not overlap. Shared pair: in S1 the overlapping task joins the window only after its partner completes, so the simulator wrote no line. This item's own ledger has the shared case live: `TASK-004: developer waits — Files overlap src/cli/args.ts / src/cli/args.ts` (line 53) and the same for TASK-006 on SKILL.md (line 133) | loop/sim-S1.md; loop/progress.md:53,133 |
| TC-025 | Integration | PASS (simulated) | TASK-002 test-writer before TASK-001 developer done; TASK-002 developer before TASK-001 reviewer done; no TASK-003 seat before TASK-001 complete; no developer overlap; package, `verify started` and reviewer dispatched before `verify done`; every line suffixed | S2: TASK-002 test-writer 09:03:45 < TASK-001 developer done 09:07:10; TASK-002 developer 09:07:25 < TASK-001 reviewer done 09:10:20; first TASK-003 seat 09:10:40 > TASK-001 complete 09:10:30; package 09:07:20, verify started 09:07:30 and reviewer 09:07:35, all before verify done 09:08:50; no doubled suffix | loop/sim-S2.md |
| TC-028 | Integration | PASS (simulated + own ledger) | `fix queued` while developer 2 runs; cascade owed, answered by `cascade=<sha7>` with the fix diff in the brief; TASK-002 complete after TASK-001 complete | S3: `fix queued` at 09:10:25 while developer TASK-002 ran (09:07:25–09:11:00); `cascade re-review owed — after e7f8a9b` answered by `cascade=e7f8a9b`, whose brief carries the fix diff; complete at 09:16:50, then 09:17:20. The same sequence ran live in this item's loop for TASK-006 → TASK-007 (progress.md:201,209,223,232) | loop/sim-S3.md; loop/progress.md |
| TC-029 | Integration | PASS (simulated) | Each of the 7 stops resumes at its first unmet step; TASK-003 gets no seat while TASK-001 is incomplete; no doubled suffix | Stop 1: developer TASK-001 re-dispatched, X waits for H's commit. Stop 2: verify re-run. Stop 3: cascade re-review dispatched. Stop 4: fix re-queued behind developer TASK-002. Stop 5: fix round 2. Stop 6: both open seats re-dispatched. Stop 7: TASK-001 completes. TASK-003 is seated only after TASK-001 completes; no doubled suffix | loop/sim-resume.md |
| TC-030 | Integration | PASS (real run) | A developer with a stray staged path reports BLOCKED naming it; no task commit contains it | A real `developer` seat (sonnet) on a scratch repo where `notes.txt` was pre-staged returned `STATUS: BLOCKED` naming `notes.txt`; `git log` shows only `base` | loop/tc030-report.md; scratch `git log --oneline` = `dbc62cd base` |
| TC-032 | Integration | PASS (real run) | `kf verify --task TASK-003 --commits` exits 0 in a detached worktree at the newest commit and leaves no `kf-verify-` worktree | exit 0, "Running in a detached worktree at 75869d2"; `git worktree list` shows 0 `kf-verify` entries; the `kf-verify-*` temp-dir count was 16 before and 16 after (the existing 16 date from 12:34, before this loop) | command rows below |

## Behaviour run

- **TC-030 (stray staged path):** a real developer agent ran on a scratch repo (`$CLAUDE_JOB_DIR/tmp/tc030`). `src/add.js` was the Files allowlist, `notes.txt` was pre-staged, and the brief was in the developer-brief.md shape. Result: `STATUS: BLOCKED`, naming `notes.txt`, with no commit. The scratch repo's `npm test` script (`node --test src/`) was broken by my setup, and the developer reported that correctly as outside its Files. That does not affect the TC.
- **TC-032:** `node dist/index.js verify loop-throughput --task TASK-003 --commits 25dfa43,75869d2` exited 0.
- **TC-021 / TC-025 / TC-028 / TC-029:** desk simulations by a fresh opus agent that read only the worktree's `skills/kanban-implement/SKILL.md` and `references/task-loop.md`. It was given scenarios, not expected outcomes, and dispatched nothing. **Not run:** a live controller session on a scratch item, because it would mean a full multi-agent loop per scenario. The prose is executed by a model reading the same text, so the simulation exercises the same path. It does not exercise the subagents' timing. This item's own loop corroborates TC-021 (overlap waits) and TC-028 (fix queued → cascade owed → cascade answered → complete) as a live run, but it ran under the controller's ruling rather than the installed skill (progress.md:15). In that run, test-writers of TASK-002 and TASK-003 both ran during developer TASK-001, which is wider than the 2-task window the new text fixes.
- **Changed behaviour no test touches:** live controller pipelining and resume, beyond the prose surface tests and the simulations above.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run --coverage` (worktree, 3815f81, re-test) | 0 | Test Files 74 passed (74), Tests 1266 passed (1266); Lines 86.89%, Branches 87.5% — loop/testing-2-coverage.log |
| `npx vitest run` (detached worktree at 3815f81) | 0 | Test Files 74 passed, Tests 1266 passed — loop/testing-2-detached-3815f81.log |
| `node dist/index.js verify loop-throughput --task TASK-007 --commits a4a5ae8` / `--task TASK-005 --commits 3815f81` | 0 | both inside Files; 1 task verify command passed each |
| `npm test` (worktree, 7580e41, first execution) | 0 | Test Files 74 passed (74), Tests 1266 passed (1266) — loop/testing-full-suite.log |
| `npx vitest run` on the 10 feature test files | 0 | Test Files 10 passed, Tests 257 passed: review-package 14, tasks-command 11, task-graph 20, verify 51, allowlist 26, loop-stats 35, loop-parallel-surface 29, loop-ledger-surface 20, travel-surface 20, open-source-surface 31 — loop/testing-feature-tests.log |
| `npx vitest run --coverage` | 0 | 1266/1266; Lines 86.89%, Branches 87.49%, Functions 93.4% — loop/testing-coverage.log |
| `node dist/index.js verify loop-throughput --stage` | 0 | All 2 stage verify command(s) passed |
| `npm run build` | 0 | build ok |
| `npm run typecheck` | 0 | no errors |
| `npm run lint` | 0 | oxlint src, no findings printed |
| `node dist/index.js verify loop-throughput --task TASK-003 --commits 25dfa43,75869d2` | 0 | Every changed file is inside TASK-003's Files; detached worktree at 75869d2; 1 task verify command passed |
| `git worktree list` after the TC-032 verify | 0 | no `kf-verify-` entry listed (`grep -c kf-verify` printed 0) |
| `node dist/index.js loop-stats loop-throughput` | 0 | wall 58.1, busy 57.8, saved 61.3, waits 29.2 min; unparsed lines: none; orphan dispatches: none; open waits: none |
| `node dist/index.js loop-stats loop-throughput --record` / `--all` | 0 | recorded in .works/loop-metrics.md; `largest: developer 6.0 min/task` |
| `git -C <scratch tc030> log --oneline` after the developer seat (TC-030) | 0 | `dbc62cd base` only; the seat returned STATUS: BLOCKED naming notes.txt (see Behaviour run) |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | — | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage (lines) | 80% | 86.89% | loop/testing-coverage.log |
| src/workflow/loop-stats.ts / src/cli/commands/loop-stats.ts | 80% | 96.87% / 95.19% | coverage table |
| src/workflow/tasks.ts / src/cli/commands/tasks.ts | 80% | 100% / 100% | coverage table |
| src/workflow/verify.ts / src/cli/commands/verify.ts | 80% | 15.24% / 0% as measured | verify.test.ts runs the built CLI as a child process (`spawnSync(process.execPath, [KF, …])`, verify.test.ts:109), and v8 coverage does not instrument child processes. These figures undercount: 51 verify tests run the code. Not checked: the same figures on the base commit |

## Regression
Re-test after review repair (execution a4545dd8): TASK-008 changed only prose and docs (cli-reference overlaps/verify rows, the harness.md exit-3 row, the --record wording in three places, resume step 10 cascade matching, the developer-brief advisory slot). The stage gate, build, typecheck, lint and full suite were re-run at 3815f81, all exit 0, 1266/1266. The surface tests pinning the changed prose pass (137/137 per the developer's report; included in the 1266). The TC-029 stop 3 simulation (cascade owed → re-review dispatch) holds under the clarified step 10, which now names the dispatch line the simulator already used. TC-030, TC-032 and the other simulations exercise text TASK-008 did not change, so their evidence carries.

The full suite is green: 1266/1266 (74 files). The one-off failure seen at 7f783a7 during implementation (test name not captured; ledger Ruling progress.md:129) did not recur in the 5 logged full-suite runs since (detached ad2ab10, detached 7580e41, stage gate, the `npm test` above, the coverage run).

Observations for the review stage. The simulators found these places where the prose is ambiguous or silent. None of them made a TC fail.
- SKILL.md §3.4 (~:108-118) does not say to re-run `kf verify` after a fix round, yet the completion check (~:54) wants `verify done exit=0` after the last commit. In this item's loop the controller re-ran it each time.
- Resume: a `cascade=<sha7>` dispatch with no `done` reaches step 7 (plain re-dispatch) before step 10, so the cascade link can be lost (SKILL.md ~:50 vs :53).
- `round=<R>` on a cascade re-review is undefined (SKILL.md ~:120); the re-review returns ADDRESSED / NOT ADDRESSED, but the done grammar only has `clean` / `findings` (task-loop.md ~:36).
- The X brief "carries the interfaces earlier tasks produced" (~:73), but for a dependent task X's test-writer starts before H's interface exists; the plan's declared interface is what it can carry.
- The conflict scan must be "a table" (~:56), but every ledger line needs an ` @ ` suffix; table rows are counted untimed (29 untimed lines in this ledger).
- An overlap with a task outside the 2-task window leaves no ledger line (S1 TASK-003); TC-021's "sequential … Files overlap" wording matches the grammar's `developer waits — Files overlap <a> / <b>`.
- One simulator concern was dismissed: it worried that H's verify sees X's uncommitted edits, but `kf verify --commits` runs in a detached worktree (TC-032 output above).

## Conclusion
- PASS (execution a4545dd8, re-test after the review repair). 1266/1266 tests, coverage 86.89% against an 80% target, stage gate and build/typecheck/lint all exit 0, and every TC has evidence. The controller scenarios (TC-021/025/028/029) are proven by simulation and this item's own live ledger, not by a live scratch-item session. That gap and the prose ambiguities above go to the review.

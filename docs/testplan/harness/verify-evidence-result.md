---
feature: "verify-evidence"
context: "harness"
tested: "20261109_1550"
execution: "4f7b47dd-49eb-4b4a-afa7-c32be1fadea5"
status: PASS
---

# Testing Result

## Feature
verify-evidence

## Environment
- OS: macOS (Darwin 25.5.0), item worktree /Volumes/Labs/Code/projects/kaban-flow/.worktrees/verify-evidence at 8c8ae0d (no domain needed: CLI only)
- Re-test after review b571e604 FAIL (FINDING-001, docs/workflow/harness.md). Since the last execution only markdown changed (bb93974 docs reconcile, 8c8ae0d harness.md); `git diff b3cd7fb 8c8ae0d -- src` is empty, so the code, its tests and the behaviour runs below are unchanged.
- Runtime: Node.js v22.21.0
- Tooling: vitest 2 (`npx vitest run`, `@vitest/coverage-v8`), the branch-built CLI `node dist/index.js` for behaviour runs

## Execution Time
2026-11-09 15:34–15:40 and 15:48–15:51 (+07:00)

## Summary
| Metric | Result |
|---|---:|
| Total | 23 |
| Passed | 23 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

Counts behind it: the full suite ran 3081 tests in 121 files, 3081 passed. The item's own test files ran 217 tests in 10 files, 217 passed.

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | runVerifySteps outcomes exit / not-run / not-started / signal; runVerify strings unchanged | as expected | src/tests/verify.test.ts `runVerifySteps` (5 tests) |
| TC-002 | Integration | PASS | one record: sha = HEAD, clean, both argv with exit 0, 64-hex sha256 of output, exit 0, ISO at | as expected | verify.test.ts `kf verify --stage record` › passing run; also this item's own record at b3cd7fb (Behaviour run B) |
| TC-003 | Integration | PASS | failing run → exit 1 + record exit 1; missing worktree → exit 3, nothing written; no config → exit 0, nothing written | as expected | verify.test.ts (3 tests) |
| TC-004 | Integration | PASS | dirty tracked file → clean false; untracked only → clean true | as expected | verify.test.ts `records clean false … clean true` |
| TC-005 | Unit | PASS | none / invalid (never an earlier pass) / record | as expected | stage-evidence.test.ts (none, invalid, pass-then-invalid); stage-record.test.ts reader tests |
| TC-006 | Integration | PASS | move with a valid record; no command runs at the gate; untracked file does not refuse | as expected | stage-evidence-gate.test.ts (marker file unchanged); the old exit-1 table row half: reports.test.ts stage-move test (Ruling, TASK-005) and Behaviour run A step 5 |
| TC-007 | Integration | PASS | verify_record_stale naming record sha, HEAD and the command | as expected | stage-evidence-gate.test.ts, stage-evidence.test.ts (message names both shas) |
| TC-008 | Integration | PASS | pass then fail at HEAD → verify_record_failed | as expected | stage-evidence-gate.test.ts |
| TC-009 | Integration | PASS | dirty at record and dirty now → verify_tree_dirty, distinct messages | as expected | stage-evidence-gate.test.ts, stage-evidence.test.ts |
| TC-010 | Integration | PASS | reordered / added / removed command → verify_config_changed | as expected | stage-evidence-gate.test.ts, stage-evidence.test.ts |
| TC-011 | Integration | PASS | no file / unparsable / missing dir → missing / invalid / dir_missing | as expected | stage-evidence-gate.test.ts |
| TC-012 | Integration | PASS | --force moves and records a force bypass listing the code (missing; stale) | as expected | stage-evidence-gate.test.ts (2 tests) |
| TC-013 | Integration | PASS | not configured (absent and []) refuses naming harness.verify.stage and --waive; after --waive the move succeeds | as expected | stage-evidence-gate.test.ts; Behaviour run A steps 1, 3, 5 |
| TC-014 | Integration | PASS | blank reason / no --stage / stage pinned → exit 3, .kfw.json byte-identical; second waiver replaces; by = git user.name | as expected | src/tests/verify-waiver.test.ts (9 tests); Behaviour run A step 2 |
| TC-015 | Unit | PASS | readFeatureMeta loads a well-formed waiver, rejects malformed | as expected | src/tests/schema.test.ts |
| TC-016 | Integration | PASS | waiver then stage pinned → verify_record_missing | as expected | stage-evidence-gate.test.ts, stage-evidence.test.ts |
| TC-017 | Integration | PASS | Stage verify line PASS / FAIL / stale / waived / none, JSON stageVerify states and matchesHead; planning and done → no line, null | as expected | src/tests/status-stage-verify.test.ts (15 tests); Behaviour run A step 4 |
| TC-018 | Unit | PASS | PASS report with exit-1 row or no table → no testing_exit_code; commandExitCodes not exported | as expected | src/tests/reports.test.ts (5 tests) |
| TC-019 | Unit | PASS | skills, template and help name the record, the gate and --waive | as expected | src/tests/verify-evidence-surface.test.ts (9 tests) |
| TC-020 | Integration | PASS | bug without worktree: record from kf verify --stage has the root HEAD; move exits 0 | as expected | stage-evidence-gate.test.ts (record written by cmdVerify) |
| TC-021 | Unit | PASS | readLoopInputs and kf loop-stats unchanged by stage-verify.jsonl | as expected | stage-record.test.ts; `kf loop-stats verify-evidence --record` succeeded on this item with the file present |
| TC-022 | Integration | PASS | unwritable loop/ → verdict kept (0 and 1), stderr warning, no record | as expected | verify.test.ts |
| TC-023 | Integration | PASS | two runs → two lines, first byte-identical, reader returns the second | as expected | verify.test.ts, stage-record.test.ts |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npx vitest run (full suite, worktree at b3cd7fb, with coverage of the changed files) | 0 | Test Files 121 passed (121); Tests 3081 passed (3081) |
| npx vitest run on the 10 item test files (stage-record, verify, verify-waiver, schema, stage-evidence, stage-evidence-gate, status-stage-verify, reports, verify-evidence-surface, worktree-domains-output) | 0 | Test Files 10 passed (10); Tests 217 passed (217) |
| npm run build | 0 | tsc build of the branch, then dist/index.js used below |
| node dist/index.js verify verify-evidence --stage (at b3cd7fb) | 0 | All 2 stage verify command(s) passed (npm run build, npm test); record appended at b3cd7fb, clean true |
| node dist/index.js verify verify-evidence --stage (at 8c8ae0d, this execution) | 0 | All 2 stage verify command(s) passed (npm run build, npm test — the full suite); record appended at 8c8ae0d, clean true; `kf status` → Stage verify: PASS 8c8ae0d at HEAD |
| npx vitest run on 11 item and docs test files (adds docs-plugin-surface) at 8c8ae0d | 0 | Test Files 11 passed (11); Tests 252 passed (252) |
| bash scratchpad/behaviour-run.sh (branch CLI in a throwaway project) | 0 | five steps, see Behaviour run A |

## Behaviour run

**A. The gate and the waiver through the real CLI** (TC-013, TC-014, TC-017, TC-006's table-row half) — a throwaway repo initialised with the installed `kf init --defaults` (`kf init` refuses to run from a linked worktree by design), `harness.verify` removed, hooks removed, a bug item driven to testing with a PASS report whose Commands row is `| npm test | 1 | 2 failed |`; every other step uses `node <worktree>/dist/index.js`:
1. `kf stage demo review` → exit 1: `[ERROR] …/loop/stage-verify.jsonl: No harness.verify.stage is pinned in .kf/config.json, and 'demo' has no waiver. Pin the stage commands and run kf verify demo --stage, or, on the human's word, record a waiver: kf verify demo --stage --waive "<reason>" (verify_not_configured)`.
2. `kf verify demo --stage --waive "  "` → exit 3: `--waive needs a reason: …` plus the usage line naming `--waive`.
3. `kf verify demo --stage --waive "no suite in this fixture"` → exit 0: `Recorded a stage verify waiver for 'demo' (by Behaviour Run): no suite in this fixture`.
4. `kf status --change demo` → `Stage verify: waived — no suite in this fixture (Behaviour Run, 2026-11-09)`.
5. `kf stage demo review` → exit 0: `✓ Moved 'demo' testing → review` — the exit-1 Commands row no longer refuses.

**B. This item's own evidence** (TC-002, FR-001): the branch CLI ran `kf verify verify-evidence --stage` in the item worktree (first at b3cd7fb; again at 8c8ae0d for this execution, `Stage verify: PASS 8c8ae0d at HEAD`); `loop/stage-verify.jsonl` holds `{"sha":"b3cd7fb0…","clean":true,"commands":[{"argv":["npm","run","build"],"outcome":"exit","code":0},{"argv":["npm","test"],"outcome":"exit","code":0}],"outputSha256":"a36f314f…","exit":0}`, and `node dist/index.js status --change verify-evidence` prints `Stage verify: PASS b3cd7fb at HEAD, 0m ago`. The move to review is made with the branch CLI so the new gate judges this item.

Changed behaviour no test touches: `verifyStage`'s "no HEAD commit" branch (src/workflow/verify.ts:283-285, ledgered as a deferred minor) — not run: it needs a stage run in a directory with no commit, which no kf item can have once it has a worktree or a root commit. The refusal headline "report status blocks this direction" printed above the evidence findings (deferred minor, TASK-003) is visible in Behaviour run A step 1.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | — | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Changed files, lines (full suite) | 80% | 82.56% | vitest coverage over stage-record.ts 100, stage-evidence.ts 100, status.ts 97.55, transition.ts 98.87, validate-reports.ts 94.87, cli/commands/verify.ts 76.81, workflow/verify.ts 35.26 |
| New code in workflow/verify.ts (runVerifySteps, verifyStage) | 80% | runVerifySteps 100%, verifyStage all but lines 283-285 | per-line coverage JSON; the file's 35% comes from its older `--task` paths, exercised through child-process CLI runs that v8 coverage does not count |

## Regression
Full suite 3081/3081 at b3cd7fb; the 13 test files that move items into review now grant a waiver (TASK-003) and all pass. `kf loop-stats --record` and `kf next` read the item's `loop/` with the stage file present.

## Conclusion
- PASS: all 23 test cases pass (217 item tests, 3081 in the full suite), the changed files meet the 80% line target, and the gate, the waiver and the status line were run end to end through the built CLI.

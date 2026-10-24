---
feature: "task-harness"
context: "harness"
tested: "20261024_1241"
execution: "ed601929-97ce-4088-83c5-10a07e69c5f7"
status: PASS
---

# Testing Result

## Feature
task-harness

## Environment
- OS: macOS 26.5.1 (Darwin 25.5.0)
- Runtime: Node v22.21.0, git 2.56.0
- Tooling: vitest 2.1 with @vitest/coverage-v8, tsc, oxlint; fake runner CLIs and real temp git repos (src/tests/helpers/git-fixture.ts)

## Execution Time
2026-10-24 12:41 (third execution, after the review fixes FIX-2…FIX-5), about 60s for the coverage run of the full suite in .worktrees/task-harness

## Summary
| Metric | Result |
|---|---:|
| Total | 36 |
| Passed | 36 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | four task-graph ERROR codes incl. cycle text and self-dependency | as expected | src/tests/task-graph.test.ts |
| TC-002 | Unit | PASS | old plans, bullets, casing and dependency cell variants parse | as expected | src/tests/task-graph.test.ts |
| TC-003 | Unit | PASS | deterministic role resolution and stage fallback | as expected | src/tests/task-graph.test.ts |
| TC-004 | Integration | PASS | drive refused after the plan is edited, naming kf approve | as expected | src/tests/drive.test.ts "refuses after the approved plan is edited" |
| TC-005 | Unit | PASS | template Role/Files parse; skill markers present | as expected | src/tests/task-harness-surface.test.ts |
| TC-006 | Integration | PASS | kf tasks waves/states/roles; cycle exits 1 | as expected | src/tests/tasks-command.test.ts |
| TC-007 | Unit | PASS | one checkbox per task, Baseline byte-identical, countTasks 1/2 | as expected | src/tests/tasks-command.test.ts |
| TC-008 | Integration | PASS | refusals for unfinished dep, unknown id, --role, wrong stage | as expected | src/tests/task-run.test.ts |
| TC-009 | Integration | PASS | task prompt, cwd, run record, kf runs column, ≤72-char commit merged | as expected | src/tests/task-run.test.ts, src/tests/task-pipeline.test.ts |
| TC-010 | Integration | PASS | run --task and drive refuse with worktrees off | as expected | src/tests/task-run.test.ts, src/tests/drive.test.ts |
| TC-011 | Unit | PASS | scheduler picks, overlap rules, blocked propagation | as expected | src/tests/scheduler.test.ts |
| TC-012 | Integration | PASS | max 3 concurrent workers, overlapping pair never concurrent, task worktree names, no routes | as expected | src/tests/drive.test.ts |
| TC-013 | Integration | PASS | planning/backlog/pending approval refused with the human step | as expected | src/tests/drive.test.ts |
| TC-014 | Integration | PASS | review PASS, `ready`, nothing shipped, jsonl events | as expected | src/tests/drive.test.ts |
| TC-015 | Integration | PASS | bug drive: one implementation run, no task records | as expected | src/tests/drive.test.ts |
| TC-016 | Integration | PASS | running task worktree not an orphan | as expected | src/tests/task-worktree.test.ts |
| TC-017 | Integration | PASS | allowlist violations block (write/rename/delete); drive stops plan_change_needed | as expected | src/tests/task-pipeline.test.ts, src/tests/drive.test.ts |
| TC-018 | Integration | PASS | verify fail resets, retry resumes session with output tail, blocked, tasks_blocked; missing command | as expected | src/tests/task-pipeline.test.ts, src/tests/drive.test.ts |
| TC-019 | Integration | PASS | conflict with an item-branch commit blocks the task, no MERGE_HEAD | as expected | src/tests/task-pipeline.test.ts |
| TC-020 | Integration | PASS | tracked change blocks; untracked file does not; overwrite refused by git | as expected | src/tests/task-pipeline.test.ts |
| TC-021 | Integration | PASS | FAIL→PASS and REJECT loops; loop_limit | as expected | src/tests/drive.test.ts |
| TC-022 | Integration | PASS | budget stop 2/2 | as expected | src/tests/drive.test.ts |
| TC-023 | Integration | PASS | config_changed; worker_blocked without retry | as expected | src/tests/drive.test.ts |
| TC-024 | Integration | PASS | SIGKILL → crashed; resume skips done tasks | as expected | src/tests/drive.test.ts |
| TC-025 | Integration | PASS | racing drives, --stop, and resume after a half-finished merge retries the merge | one of two racing drives starts; --stop keeps worktrees; a resumed drive aborts the half merge, merges TASK-001 again without re-running it and continues to ready | src/tests/drive.test.ts "resumes after a crash mid-merge" (added by FIX-1), "one of two concurrent drives starts" |
| TC-026 | Unit | PASS | dead-pid takeover; live holder times out naming the pid | as expected | src/tests/lock.test.ts |
| TC-027 | Integration | PASS | 100 records from two processes, none regressed | as expected | src/tests/lock.test.ts, src/tests/run-records.test.ts |
| TC-028 | Unit | PASS | verify validation errors name the field; re-init keeps fields; defaults | as expected | src/tests/harness-config.test.ts |
| TC-029 | Integration | PASS | drive refused without verify.stage; task_harness_needs_worktree only when opted in | as expected | src/tests/drive.test.ts, src/tests/task-graph.test.ts |
| TC-030 | Integration | PASS | drive-stop env for ready and budget; failing hook is a warning | as expected | src/tests/drive.test.ts |
| TC-031 | Integration | PASS | four doctor findings; none for verify with stages {} | as expected | src/tests/doctor.test.ts |
| TC-032 | Integration | PASS | archive removes clean task worktree, cancel refuses dirty | as expected | src/tests/task-worktree.test.ts |
| TC-033 | Integration | PASS | concurrent task runs allowed, duplicate and stage-level runs refused | as expected | src/tests/task-run.test.ts |
| TC-034 | Integration | PASS | five stop codes named; transition spy sees no force/skipHooks | as expected | src/tests/drive.test.ts |
| TC-035 | Unit | PASS | status-rank merge keeps finished status | as expected | src/tests/run-records.test.ts |
| TC-036 | Unit | PASS | typed outcomes; kf stage output byte-identical | as expected | src/tests/transition.test.ts |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npm run typecheck | 0 | no errors |
| npm run lint | 0 | oxlint src, no findings |
| npm run build | 0 | dist built |
| npx vitest run --coverage.enabled (full suite) | 0 | 48 files, 710 tests passed (adds the merge-lock wait and transition-stack tests from review FINDING-001/002) |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| None | — | — | Execution f72b26bc failed TC-025 step 3 (missing end-to-end test, fixed by FIX-1). Execution e6bd2fe7 passed; its review failed on three MEDIUM findings, fixed by FIX-2…FIX-4 and re-tested here. Earlier reports are kept in runs/ |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage (lines, src excl. tests) | 80% | 88.1% | coverage-summary.json in the item's coverage/ folder |
| New and changed modules (lines) | 80% | 91.47% | lock, git, process, tasks, transition, worktree/tasks, scheduler, task-run, task-state, task-pipeline, drive, drive-log, config, cli drive/tasks |

`src/cli/commands/drive.ts` is at 59% lines: its `--supervise` branch runs only in the detached child process, which v8 coverage of the test process does not see; the detached tests exercise it.

## Regression
The whole pre-existing suite passes unchanged (547 tests at baseline, all still green inside the 710), including the byte-identical `kf stage` output check.

## Conclusion
- PASS: all 36 planned test cases pass at the agreed unit+integration level, the full suite (710 tests) is green, and line coverage is 88.1% overall and 91.47% on the new and changed modules against an 80% target.

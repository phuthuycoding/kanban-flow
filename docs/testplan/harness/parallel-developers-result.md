---
feature: "parallel-developers"
context: "harness"
tested: "20261102_0716"
execution: "f4961650-4ed1-49ce-8738-35ce604f6bbd"
status: PASS
---

# Testing Result

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

## Feature
parallel-developers

## Environment
- OS: Darwin 25.5.0 (macOS)
- Runtime: Node v22.21.0
- Tooling: vitest with `@vitest/coverage-v8`, tsc, eslint. Run in the item worktree `.worktrees/parallel-developers` at c83261e (after the review-80ba98b3 repair loop 4) on branch `phuthuycoding/parallel-developers`.

## Execution Time
2026-11-02 01:40–01:47 +07:00

## Summary
| Metric | Result |
|---|---:|
| Total | 30 |
| Passed | 30 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

Every test case appears below. TC-027 is the scenario run with real seats; the other 29 are automated tests inside the suite.

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Integration | PASS | A clean tsc build returns and prints no `build setup:` line | As expected | `src/tests/build-setup.test.ts` 5/5 |
| TC-002 | Integration | PASS | tsc exit 2 warns `build setup: tsc exited 2 — type errors, dist emitted, continuing`, and the `.js` file is emitted | As expected | `build-setup.test.ts` 5/5 |
| TC-003 | Integration | PASS | A missing config and a `noEmitOnError` failure each throw `build setup: tsc exited 1` | As expected | `build-setup.test.ts` 5/5 |
| TC-004 | Integration | PASS | Exit 0 and the sha of its own commit printed, also when a post-commit hook moves HEAD on, when a commit-msg hook rewrites the subject, and for leading-space or multi-line messages; a deleted file commits as a deletion. The commit holds only `mine.txt`, and `other.txt` stays staged | As expected | `src/tests/commit-task.test.ts` 49/49 |
| TC-005 | Integration | PASS | Exit 4 with `BLOCKED … outside the allowlist` on stderr; HEAD and the index unchanged; a run from a subdirectory exits 4 with nothing staged; `.` and a directory path exit 4 `is a directory; name each file`, even under `--allow .`; absolute, `..`, `:`, backslash paths and empty-normalised `--allow` exit 4 before any git call; verdicts match `pathAllowed`; a copy with no `dist/` runs | As expected | `commit-task.test.ts` 49/49 |
| TC-006 | Integration | PASS | 4 attempts, then `BLOCKED: index.lock held` and exit 5; the lock is kept | As expected | `commit-task.test.ts` 49/49 |
| TC-007 | Integration | PASS | A bare directory entry commits a new file; a run without `-m` exits 2 | As expected | `commit-task.test.ts` 49/49 |
| TC-008 | Integration | PASS | Critical path, max width and earliest start match the fixture | As expected | `src/tests/tasks-command.test.ts` 19/19 |
| TC-009 | Unit | PASS | `maxWidth` 2, `widthSet` [TASK-001, TASK-002] | As expected | `src/tests/task-graph.test.ts` 30/30 |
| TC-010 | Unit | PASS | Overlapping A and C never share a width set; the critical path is [A, B, C] | As expected | `task-graph.test.ts` 30/30 |
| TC-011 | Integration | PASS | The seven `--graph --json` keys incl. `maxWidthExact`, `--json` alone unchanged, zero tasks prints `critical path: none`; 30 tasks exact, 31 tasks `max width: ≥N` with `maxWidthExact: false` | As expected | `tasks-command.test.ts` 19/19 |
| TC-012 | Unit | PASS | The kanban-plan approval summary and cli-reference name `kf tasks <feature> --graph` | As expected | `src/tests/open-source-surface.test.ts` 39/39 |
| TC-013 | Unit | PASS | `developersPeak` 3 and the overlap minutes match the hand computation | As expected | `src/tests/loop-stats.test.ts` 54/54 |
| TC-014 | Unit | PASS | Sequential developers give peak 1 and overlap 0 | As expected | `loop-stats.test.ts` 54/54 |
| TC-015 | Unit | PASS | Developer lag uses the latest gate before the first plain dispatch; `round=` dispatches are skipped | As expected | `loop-stats.test.ts` 54/54, including the round-1 pinning test |
| TC-016 | Unit | PASS | Code-reviewer lag uses the latest gate; a run with no dispatch gives `{median:null,max:null,n:0}` | As expected | `loop-stats.test.ts` 54/54 |
| TC-017 | Integration | PASS | Both text and JSON output carry peak, overlap and lag | As expected | `loop-stats.test.ts` 54/54 |
| TC-018 | Unit | PASS | The cap of 4, the three dispatch conditions, the open-task definition and tie-break, and both wait lines verbatim | As expected | `src/tests/loop-parallel-surface.test.ts` 55/55 |
| TC-019 | Unit | PASS | No one-developer or two-task-window phrasing remains | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-020 | Unit | PASS | Test-writers may run ahead for the next 4 tasks; their runs are advisory | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-021 | Unit | PASS | Developers run focused tests, report `not mine: <file>`, and treat `kf verify --commits` as authoritative | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-022 | Unit | PASS | Completion is per-dependency with no plan-order barrier; a cascade only reaches dependents | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-023 | Unit | PASS | Resume re-dispatches every open seat before any new developer | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-024 | Unit | PASS | The five-item controller work list, in order | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-025 | Unit | PASS | Commits go through `commit-task.mjs` from the repository root, `--allow .` for a task with unknown Files, the current exit-4 list with no `no dist build`, any non-zero exit means BLOCKED, and the forbidden-command list is present | As expected | `loop-parallel-surface.test.ts` 55/55 |
| TC-026 | Unit | PASS | The docs describe 4 developers, both wait lines, the work list, the exit-2 rule, `commit-task.mjs`, `--graph`, peak and lag | As expected | `open-source-surface.test.ts` 39/39 |
| TC-027 | Integration | PASS | In the scenario ledger, `developers peak` ≥ 3, a `developer waits — Files overlap` line appears for the 4th task, and developer lag max ≤ 1.0 | `developersPeak` 3, overlap 0.5 min; `TASK-004: developer waits — Files overlap src/a.ts / src/a.ts (TASK-001)`; lag median 0, max 0 (n=4) | Behaviour run, below |
| TC-028 | Integration | PASS | TASK-002's lag is measured from TASK-001's `developer done` | As expected | `loop-stats.test.ts` 54/54 |
| TC-029 | Unit | PASS | The new wait-line examples parse as `developerWaits`; the legacy `fix queued` still parses | As expected | `src/tests/loop-ledger-surface.test.ts` 22/22 |
| TC-030 | Integration | PASS | The scratch run passes; its output carries TS2322 and the exit-2 warning, and the exit code is 0 | As expected | `build-setup.test.ts` 5/5 |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm run build` | 0 | Run in the worktree at 215c4e0 |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npx vitest run --coverage --coverage.reporter=text-summary --coverage.include='src/**'` | 0 | Test Files 76 passed (76); Tests 1393 passed (1393); 55.6 s |
| `npx vitest run src/tests/build-setup.test.ts` | 0 | 5 passed |
| `npx vitest run src/tests/commit-task.test.ts` | 0 | 49 passed |
| `npx vitest run src/tests/task-graph.test.ts` | 0 | 30 passed |
| `npx vitest run src/tests/tasks-command.test.ts` | 0 | 19 passed |
| `npx vitest run src/tests/loop-stats.test.ts` | 0 | 54 passed |
| `npx vitest run src/tests/loop-parallel-surface.test.ts` | 0 | 55 passed |
| `npx vitest run src/tests/loop-ledger-surface.test.ts` | 0 | 22 passed |
| `npx vitest run src/tests/open-source-surface.test.ts` | 0 | 39 passed |
| `kf verify parallel-developers --stage` | 0 | `All 2 stage verify command(s) passed.` at c83261e (`npm run build`, `npm test`) |
| `kf tasks parallel-developers --graph` / `--graph --json` (worktree build) | 0 | `max width: 5 (TASK-001, TASK-002, TASK-003, TASK-004, TASK-005)`; maxWidthExact true; 7 keys |
## Behaviour run

**commit-task.mjs after repair loop 3 (review 64dc74be FINDING-001, -002).** Scratch repos, driven from the worktree's script at f1782d8:
- With a commit-msg hook that prefixes `[ABC-1] `, `-m "feat: a" --allow a.txt -- a.txt` exited 0 and printed `git rev-parse HEAD` (commit `[ABC-1] feat: a`). At 215c4e0, the same call committed and then exited 4.
- `--allow . -- .` with `b.txt` and `c.txt` changed printed `BLOCKED: . is a directory; name each file` and exited 4. No commit was made and nothing was staged. At 215c4e0, it committed both files with exit 0.
- `--allow src -- src` printed `BLOCKED: src is a directory; name each file` and exited 4.

**commit-task.mjs after repair loop 2 (review 33aa4464 FINDING-001, -002, -005).** These scratch repos were driven from the worktree's script:
- From `docs/a/`, `--allow README.md -- README.md` printed `BLOCKED: run from the repository root (cwd is docs/a/)` and exited 4, with no commit and nothing staged. Before the repair, the same call committed `docs/README.md` with exit 0.
- From the root, the same call exited 0 and printed HEAD's sha.
- Messages with a leading space, an indented continuation line plus body, and a plain message each exited 0. Each printed a sha equal to `git rev-parse HEAD`. Before round 5, the first two exited 4 after committing.

**commit-task.mjs as a copy-mode install (FINDING-001/002 of review 1b3bbd6b).** Carried from execution 33aa4464. The copied script ran with no `dist/` beside it: one exit 0, and exit 4 for `..`, absolute, `:(glob)*`, backslash, empty `--allow` and outside paths.

**TC-027 scenario.** Carried forward from execution 1b3bbd6b: `$CLAUDE_JOB_DIR/tmp/tc027`, real haiku seats, developers peak 3, the overlap wait line for T-004, lag max 0.
- `git diff --stat eddb2d6..HEAD -- skills/kanban-implement/SKILL.md skills/kanban-implement/references/` is empty, so the dispatch prose the scenario followed is unchanged.
- The commit path it used, commit-task.mjs, changed in the repair. That path is re-proven by the 49 commit-task tests and the copy-mode run above, not by re-running the scenario.

**Changed behaviour no automated test touches:** the controller-side rules in the skill prose. These are the dispatch order, the open-task tie-break, seat priority and the background-command rule. The surface tests pin only their wording. The TC-027 run exercised the cap, the overlap wait and the test-writer hold. It did not exercise the tie-break, a cap wait or a fix round under the cap. The greedy max-width path above 30 tasks is tested on generated fixtures only; no real plan of that size exists.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| None | — | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage (`src/**`, lines) | 80% | 88.15% | v8 text-summary: Statements 88.15%, Branches 87.79%, Functions 93.7%, Lines 88.15% (7843/8897) |

Code that tests run as a CLI subprocess is not counted by v8 in-process coverage, so the figure understates real coverage.

## Regression
The full suite passes: 76 files and 1393 tests, 6 more than execution 80ba98b3, all from repair loop 4 (surface tests for `[COMMIT_SCRIPT]` and the `commit made` route). `kf verify --stage` passes at c83261e, and `kf tasks --json` without `--graph` is unchanged (TC-011). Deferred minors are recorded in `loop/progress.md`:
- The buildDist null-status branch is untested.
- The greedy-path test covers only direct dependencies.
- `install.test.ts` is flaky under load.
- Tie-break wording refinements.

## Conclusion
- PASS. All 30 test cases pass after repair loop 4. Coverage is 88.15% against a target of 80%.

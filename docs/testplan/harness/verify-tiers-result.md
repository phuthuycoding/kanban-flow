---
feature: "verify-tiers"
context: "harness"
tested: "20261110_0806"
execution: "058e3d94-30ee-4664-81a1-b8ac034a5b81"
status: PASS
---

# Testing Result

## Feature
verify-tiers (#146) — task tier with related tests, wave tier (`kf verify <f> --wave <w>`, `kf next` wave hold and decides), gate reuse, `kf loop-stats` wave minutes, this repository's config, skills and docs.

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node (repository engines), item worktree `.worktrees/verify-tiers` at c48458d (after the review repair: FR-004 option A, wave reopen exemption, lowest-wave-only verify, --resume liveness)
- Tooling: vitest 2 with `@vitest/coverage-v8`, tsc, oxlint; branch CLI run as `node dist/index.js` (the installed `kf` runs the primary checkout)

## Execution Time
2026-11-10 08:04–08:12 (+07:00) — second execution after review FAIL 6248c2ad

## Summary
| Metric | Result |
|---|---:|
| Total | 24 |
| Passed | 24 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | `harness.verify.related` validated as one argv | as expected | src/tests/harness-config.test.ts 16/16 |
| TC-002 | Integration | PASS | related argv runs after task commands with changed files appended | as expected | src/tests/verify-related.test.ts 17/17 |
| TC-003 | Integration | PASS | deleted files dropped, renames give new path | as expected | src/tests/verify-related.test.ts |
| TC-004 | Integration | PASS | no existing changed file → `No related tests: …`, no related run | as expected | src/tests/verify-related.test.ts |
| TC-005 | Integration | PASS | no related pinned → same commands and result line as today | as expected | src/tests/verify-related.test.ts |
| TC-006 | Integration | PASS | failing task command stops before related | as expected | src/tests/verify-related.test.ts |
| TC-007 | Integration | PASS | file outside Files → exit 2 | as expected | src/tests/verify-related.test.ts |
| TC-008 | Integration | PASS | `--wave` runs stage commands in a detached worktree at HEAD | as expected | src/tests/verify-wave.test.ts 13/13 |
| TC-009 | Integration | PASS | stage record carries `wave`, log `loop/wave-<w>-verify.log` | as expected | src/tests/verify-wave.test.ts, src/tests/stage-record.test.ts 17/17 |
| TC-010 | Integration | PASS | unknown wave / conflicting flags → exit 3 | as expected | src/tests/verify-wave.test.ts |
| TC-011 | Integration | PASS | detached worktree removed on every exit path | as expected | src/tests/verify-wave.test.ts |
| TC-012 | Unit | PASS | wave ledger lines parse, `kf record` wave events written/refused | as expected | src/tests/next-ledger-waves.test.ts 12/12, src/tests/next-record-waves.test.ts 9/9 |
| TC-013 | Unit | PASS | `kf loop-stats` wave verify count/median/sum; controller excludes wave minutes clipped to the wall | as expected | src/tests/loop-stats-waves.test.ts 15/15 |
| TC-014 | Integration | PASS | complete wave prints `verify wave <w>: …` (amended: only the lowest owed wave, none while a wave verify runs; a covering passing record of any tag verifies it) | as expected | src/tests/next-waves.test.ts 38/38 |
| TC-015 | Integration | PASS | later-wave developer waits `wave <w> verify`; test-writers not held | as expected | src/tests/next-waves.test.ts |
| TC-016 | Integration | PASS | failed wave → `decide (Wave verify)` with its closing lines | as expected | src/tests/next-waves.test.ts |
| TC-017 | Integration | PASS | reopen / decided note owes a new wave verify; exit 3 decide | as expected | src/tests/next-waves.test.ts |
| TC-018 | Unit | PASS | explorer: no `no rule` stop on wave plans | as expected | src/tests/next-waves.test.ts |
| TC-019 | Integration | PASS | `--resume` lists an open wave verify | as expected | src/tests/next-waves.test.ts |
| TC-020 | Integration | PASS | no `harness.verify.stage` → every existing kf-next fixture unchanged | as expected | src/tests/next-schedule.test.ts and the kf-next fixture suites in the full run |
| TC-021 | Integration | PASS | passing wave record at HEAD opens review without running stage commands | as expected (guard) | src/tests/verify.test.ts 70/70 ("gate reuse") |
| TC-022 | Unit | PASS | repo config task/related/stage values; relatedArgv appends files | as expected | src/tests/verify-tiers-surface.test.ts 11/11 |
| TC-023 | Unit | PASS | skills and help name the tiers and the status rule | as expected | src/tests/verify-tiers-surface.test.ts |
| TC-024 | Unit | PASS | README, Pages, harness.md, cli-reference, CHANGELOG name the tiers | as expected | src/tests/verify-tiers-docs-surface.test.ts 17/17 |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npm test | 0 | 129 files, 3233 passed, 0 failed (at cded819) |
| npm run typecheck | 0 | no diagnostics |
| npm run lint | 0 | oxlint: 0 errors, 2 warnings (prefer-string-starts-ends-with in src/tests/next-judgements.test.ts:68 and src/tests/next-waves.test.ts:254) |
| npm run build | 0 | dist built at 5ade9d8 |
| npx vitest run src/tests/next-waves.test.ts src/tests/verify-wave.test.ts src/tests/loop-stats-waves.test.ts src/tests/verify.test.ts | 0 | 146 passed / 146 (incl. the 3 tests added with cded819, which fail on 5ade9d8) |
| node dist/index.js verify verify-tiers --task TASK-005 --commits 5ade9d8 | 0 | Every changed file is inside TASK-005's Files; All 2 task verify command(s) passed |
| node dist/index.js verify verify-tiers --wave 4 | 0 | All 2 stage verify command(s) passed at 5ade9d8 |
| node dist/index.js verify verify-tiers --stage | 0 | All 2 stage verify command(s) passed in the item worktree at cded819 |
| npx vitest run --coverage (changed source files BASE..HEAD, excl. the subprocess-tested cli/commands/next.ts) | 0 | statements 97.97%, branches 93.21%, functions 99.09%, lines 97.97% (at cded819) |

## Behaviour run

- Review 4dbe9d37 repair (cded819): a wave with no matched commits passes over newer records of other waves and plain runs and is covered by its own newest passing run; two such waves no longer re-owe each other (src/tests/next-waves.test.ts, both tests fail on 5ade9d8). `kf verify --wave` exits 3 with the warning when its record cannot be written (src/tests/verify-wave.test.ts). Real run: `node dist/index.js next verify-tiers` at cded819 printed `finished`.

- Wave livelock fix (5ade9d8, human option A): a wave with no matched commits is released only by a passing, clean, pinned-commands record of its own wave run. Real run on this item: after TASK-005 closed, `node dist/index.js next verify-tiers` printed `verify wave 4: …`; `kf verify verify-tiers --wave 4` exit 0; the same `kf next` then printed `finished` with nothing in flight (before the fix it re-printed a wave verify forever). Unit evidence: src/tests/next-waves.test.ts "verifies a complete wave with no matched commits by a passing record of its own wave run" and "skips a newer dirty passing record and verifies the wave by the older clean one".

- Option A (amended FR-004), real run on this item: before the stage run, `node dist/index.js next verify-tiers` printed only `verify wave 4: kf verify verify-tiers --wave 4` (one owed wave, the lowest whose commits the earlier wave-6 record did not contain). After `node dist/index.js verify verify-tiers --stage` passed at c48458d (exit 0), the same `kf next` printed `finished`: one plain passing stage record at HEAD verified every wave.

- `node dist/index.js verify verify-tiers --wave 6` → exit 0: "Running wave 6 verify in a detached worktree at 8cdd2b4", "All 2 stage verify command(s) passed"; `loop/stage-verify.jsonl` gained a record with `"wave":6` at 8cdd2b4, `loop/wave-6-verify.log` written; `kf status` (branch) still prints `Stage verify: PASS 8cdd2b4 at HEAD` — the gate reads the wave record (TC-021 behaviour, real repo).
- `node dist/index.js next verify-tiers` → exit 0, prints `verify wave 1: kf verify verify-tiers --wave 1` … `verify wave 6: …`, In flight none; `--json` carries `{"kind":"verify-wave","wave":1,"command":…}`. This item's loop ran under the installed kf (main), so its ledger has no wave lines and no wave-tagged record for waves 1–6 (until the run above for wave 6): per FR-004 only a record with `wave: <w>` verifies wave `w`, so a passing plain `--stage` record at HEAD that contains every commit does not count. (Earlier observation, now resolved by the human's option A: a covering passing record of any tag counts.)
- `node dist/index.js verify verify-tiers --task TASK-006 --commits efa310e,1b1a8fa,db56301` → exit 0, "All 2 task verify command(s) passed", no `Ran:` lines. `kf verify` reads `.kf/config.json` from the project root, which is the primary checkout on main (no `related` yet), so the related tier did not run against this repository; it is exercised end to end by the real-git integration tests in src/tests/verify-related.test.ts. Not run here: the related tier on this repository's own config (only possible after merge).
- `node dist/index.js verify -h` names `--wave <w>` and `harness.verify.related`; `node dist/index.js record -h` names `wave-verify-started` and `wave-verify-done`.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | — | — | — |

## Coverage

Target 80% (spec Test Strategy). Measured at cded819 on the changed source files (git diff 7a249ea..HEAD, excluding tests): statements 97.97% (4266/4354), branches 93.21% (3121/3348), functions 99.09% (436/440), lines 97.97%. `src/cli/commands/next.ts` is excluded because its tests run the built CLI in a subprocess; its rendering is asserted by the kf-next CLI tests.

Changed behaviour no test touches: the related tier against this repository's own config (needs the config on the project root); the in-flight `  wave <w> verify` line and `finished` withheld while the last wave runs (deferred LOW, TASK-005); the awaitedBy exception at waves.ts:52 (Ruling, deferred LOW).

## Conclusion

PASS: 24/24 test cases, full suite 3233/3233, lint/typecheck 0, coverage 97.97% statements / 93.21% branches on the changed sources at cded819, stage verify PASS at cded819.

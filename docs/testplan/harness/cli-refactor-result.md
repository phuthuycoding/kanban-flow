---
feature: "cli-refactor"
context: "harness"
tested: "20261024_1350"
execution: "c8e69c7a-501c-4aaa-90b9-83bb0675aeb1"
status: PASS
---

# Testing Result

## Feature
cli-refactor

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node.js (npm scripts from package.json, @phuthuycoding/kanban-flow@0.12.0)
- Tooling: vitest 2.1.9, @vitest/coverage-v8, tsc, oxlint, git grep / grep, wc -l
- Location: item worktree `/Volumes/Labs/Code/projects/kaban-flow/.worktrees/cli-refactor`, branch `phuthuycoding/cli-refactor` at HEAD 7e6db9d (baseline 27244d3 from tasks.md). The worktree was clean before and after the runs. CLI-only feature: no dev server or domain used.
- Re-test scope: this execution follows commit 7e6db9d, which fixes review FINDING-001 (`ship.ts` imports `gh` from integrations/github.ts; the re-export is removed from helpers.ts) and FINDING-002 (plan IDs removed from two `describe` names in archive-item.test.ts). All 7 test cases were re-run against this HEAD.

## Execution Time
2026-10-24 13:50–13:53 (full suite ~53 s per run, two runs)

## Summary
| Metric | Result |
|---|---:|
| Total | 7 |
| Passed | 7 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Integration | PASS | No src file > 500 lines; src/harness/drive/ holds claim, control, driver; drive.test.ts passes unchanged | Largest non-test files: doctor.ts 500, drive/driver.ts 497, features.ts 495. drive/ holds claim.ts, control.ts, driver.ts behind the drive.ts barrel. drive.test.ts 20/20 green and unchanged since baseline | wc -l over tracked non-test src; `git diff --stat 27244d3 HEAD -- src/tests` (only the 2 new files) |
| TC-002 | Unit | PASS | No lower-layer import of src/cli; gh/checkMergeGate from integrations/github.ts; recordBypasses/bypassNote from workflow/bypass.ts | No `../cli/` import under src/workflow, src/harness, src/ship, src/worktree. `gh` and `checkMergeGate` are defined only in integrations/github.ts and imported from there by ship.ts:4, sync.ts:4, issues.ts:12 and workflow/archive.ts:13. `recordBypasses`/`bypassNote` are imported from workflow/bypass.ts by archive, transition, cancel and cli/commands/cancel. helpers.ts now exports only findRoot, resolveItem, ghFailure, noRepository. FINDING-001 is closed | negated grep (exit 0); import grep; `grep -nE "^export" src/cli/commands/helpers.ts` |
| TC-003 | Integration | PASS | Old import path still resolves via re-export; canonical docs sync unchanged | cli/commands/archive.ts re-exports canonicalContent, canonicalDocPaths and CanonicalKind; archive-docs 11/11 and cancel 43/43 green | `npm test` |
| TC-004 | Integration | PASS | No synthetic cmdArchive calls in stage/sync/issues; flows unchanged | Only `archiveItem` calls (stage.ts:37, :61; sync.ts:51; issues.ts:168). sync 6/6, workflow 63/63 and archive-delivery 21/21 green, including `kf stage <f> dones` (TC-010) and the `kf issues done` alias (TC-021) | grep; `npm test` |
| TC-005 | Integration | PASS | kf archive output identical to the pre-change recording; archiveItem returns typed outcomes | archive-item.test.ts 9/9 green: archived, refused (merge-gate, wrong-stage, unknown-item) and reconciled outcomes, plus byte-identical success, unmerged-PR, wrong-stage and reconcile output. The recorded literals match the baseline source templates (verified in the previous execution; this run changed only `describe` names in this file) | `npm test` |
| TC-006 | Integration | PASS | kf cancel output and exit codes identical; typed outcomes match | cancel-item.test.ts 9/9 green: success, missing reason (inside and outside a project), live-run refusal plus forced bypass note, docs kept or deleted; outcomes cancelled, refused, kept and error | `npm test` |
| TC-007 | Integration | PASS | Existing tests pass with at most import-path edits; same Unknown-feature message and exit code; typecheck, lint, build exit 0 | 50 files and 728 tests passed; no pre-existing test file changed. The Unknown-feature text and stderr tag are identical to baseline. typecheck, lint and build exit 0 | `git grep -h "Unknown feature" HEAD -- src/cli src/workflow src/harness`; commands below |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm run typecheck` | 0 | `tsc -p tsconfig.json --noEmit`, no diagnostics |
| `npm run lint` | 0 | `oxlint src`, no findings |
| `npm run build` | 0 | `tsc -p tsconfig.build.json` + postbuild chmod OK |
| `npm test` | 0 | Test Files 50 passed (50), Tests 728 passed (728), 52.77 s |
| `npx vitest run --coverage` (v8, include src/**/*.ts, exclude src/tests/**, text-summary, reports to /tmp/kf-cli-refactor-coverage) | 0 | Statements 88.38%, Branches 83.64%, Functions 94.86%, Lines 88.38%. Output was piped to `tail`, so the recorded code is the pipeline's; suite pass/fail is established by the `npm test` row |
| `! grep -rnE "from ['\"](\.\./)+cli/" src/workflow src/harness src/ship src/worktree` | 0 | No lower-layer imports of src/cli |
| `grep -rnE` for imports and exports of gh, checkMergeGate, recordBypasses, bypassNote in src | 0 | gh and checkMergeGate come only from integrations/github.ts; the bypass helpers come only from workflow/bypass.ts |
| `grep -nE "^export" src/cli/commands/helpers.ts` | 0 | findRoot, resolveItem, ghFailure, noRepository only |
| `grep -n -E` for cmdArchive or archiveItem in src/cli/commands/stage.ts, sync.ts, issues.ts | 0 | Only archiveItem matches |
| wc -l over tracked non-test `src/**/*.ts` (git ls-files, grep -v src/tests, xargs wc -l, sort -rn) | 0 | max 500 (src/project/doctor.ts) |
| `git diff --stat 27244d3 HEAD -- src/tests` | 0 | Only archive-item.test.ts and cancel-item.test.ts added |
| `git grep -h "Unknown feature" HEAD -- src/cli src/workflow src/harness` | 0 | Same message text and stderr tag as baseline |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| None | — | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall line coverage (src, excl. tests) | 80% | 88.38% | v8 text-summary, 7727/8742 lines |
| Overall branch coverage | N/A (no branch target set) | 83.64% | v8 text-summary, 3825/4573 |

## Regression
The full existing suite (50 files, 728 tests) passes at HEAD 7e6db9d. No pre-existing test file has changed since baseline 27244d3. The review-fix commit touched only helpers.ts, ship.ts and two `describe` strings; the ship suite (10/10) and archive-item suite (9/9) cover those files and are green. The spec's edge cases are still covered: archive mid-pass rollback (archive-delivery TC-009), `kf stage <f> dones` (TC-010) and the `kf issues done` alias (TC-021).

## Conclusion
- PASS: all 7 approved test cases pass at HEAD 7e6db9d; typecheck, lint, build and test exit 0; line coverage of 88.38% meets the 80% target.
- Review FINDING-001 (gh re-export) and FINDING-002 (plan IDs in describe names) are verified fixed.

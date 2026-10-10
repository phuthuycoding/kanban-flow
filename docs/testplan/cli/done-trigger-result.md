---
feature: "done-trigger"
context: "cli"
tested: "20261010_2027"
execution: "04747fe3-e433-4d07-b030-a71f424079a4"
status: PASS
---

# Testing Result

## Feature
done-trigger

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: node >=20, vitest ^2.1.9, @vitest/coverage-v8 ^2.1.0
- Tooling: `npm test`, `npx vitest run --coverage`, `npm run typecheck`, `npm run lint`, `npm run build`, `node dist/index.js` smoke (real repo state)

## Execution Time
2026-10-10 ~20:25 local

## Summary
| Metric | Result |
|---|---:|
| Total | 14 |
| Passed | 14 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | `pr` accepts `/pull/\d+`, rejects issue URL/non-URL; `delivered` boolean-validated | parsed/refused as specced | `issues-done.test.ts` › FeatureMeta |
| TC-002 | Unit | PASS | `/pull/` URL → `pr`; number → `issue`; `--pr` → `pr`; overwrite refused | all four behaviors verified | `issues-done.test.ts` › link |
| TC-003 | Unit | PASS | `statusMap.delivered` accepted; bogus key/non-string rejected | parse pass + named-field throw | `issues-done.test.ts` › statusMap |
| TC-004 | Unit | PASS | `KFW_PROJECT_STATUS_DELIVERED` emitted for every statusMap entry | env.out = `Done:In review:delivered` | `issues-done.test.ts` › hook env |
| TC-005 | Unit | PASS | refuse when item not in `dones` | exit 1 "…archive", nothing changed | `issues-done.test.ts` › not in dones |
| TC-006 | Unit | PASS | OPEN/CLOSED/error `pr view` → refuse, zero side effects | all three states refused; meta untouched; no `issue close` call | `issues-done.test.ts` › unmerged |
| TC-007 | Unit | PASS | merged PR → `delivered.sh` → close + item-edit + flag | stub gh call-log verified, `delivered`+`deliveredAt` written | `issues-done.test.ts` › merged PR |
| TC-008 | Unit | PASS | no `pr` → merge check skipped, delivery proceeds | no `pr view` call; close + flag | `issues-done.test.ts` › no pr |
| TC-009 | Unit | PASS | re-run idempotent | exit 0, "already marked delivered" | `issues-done.test.ts` › idempotent |
| TC-010 | Unit | PASS | no `issue` → flag + warning, exit 0 | "no linked issue" + flag written | `issues-done.test.ts` › no issue |
| TC-011 | Unit | PASS | no `delivered.sh` → warn + flag, no GitHub calls | warning + flag; call log clean | `issues-done.test.ts` › hook absent |
| TC-012 | Unit | PASS | doctor WARNING on dones+issue+!delivered only; status line shown | warned→cleared after flag; no-issue silent | `issues-done.test.ts` › warning |
| TC-013 | Unit | PASS | `dones.sh` runs board sync, never `gh issue close` | call log: item-edit present, close absent | `issues-done.test.ts` › dones.sh |
| TC-014 | Unit | PASS | already-closed issue → close errors inside hook, command still succeeds + flag | `GH_CLOSE_FAIL` stub → exit 0, flag written | `issues-done.test.ts` › already closed |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` | 0 | 27 test files, 447 tests pass |
| `npx vitest run --coverage` | 0 | All files 86.33% stmts / 83.9% branch / 93.33% funcs |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | oxlint clean |
| `npm run build` | 0 | clean |
| `node dist/index.js doctor` (this repo) | 0 | WARNINGs on all 4 archived items with linked issues and no `delivered` — fail-visible exactly as designed |
| `node dist/index.js status --change skill-scope` | 0 | `Delivered: no — run: kf issues done skill-scope` |
| `node dist/index.js issues link skill-scope <PR-28-url>` | 0 | `pr` recorded in `.kfw.json` |
| `node dist/index.js issues done skill-scope; rc=$?; [ $rc -eq 1 ]` | 0 | exit 1 as designed — "PR …/pull/28 is not merged (state: OPEN)" — the false-close the bug reported is now refused |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — | none | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage | 80% | 86.33% | v8 text report (`All files`) |

Per-file (touched modules): `features.ts` 96.9%, `config.ts` 96.5%, `hooks.ts` 100%, `status.ts` 100%, `repository.ts` 100%, `doctor.ts` 91.4%, `issues.ts` 65.8% (cmdDone + cmdLink paths covered; uncovered lines are pre-existing list/view/create error branches), `args.ts` 100%.

## Regression
Full suite: 447 tests / 27 files, 0 failures on branch `kf/done-trigger` (branched from main — skill-scope tests live on the other branch and are unaffected). Existing hook-pack, issues, doctor and status tests all still green.

## Conclusion
- PASS. All 14 approved TCs pass; real-repo smoke proves the end-to-end contract: archive no longer closes the issue, `pr` linking works, `kf issues done` refuses the unmerged PR #28 — the exact false-close the bug item documented is now impossible.

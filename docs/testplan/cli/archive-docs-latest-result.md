---
feature: "archive-docs-latest"
context: "cli"
tested: "20261013_1729"
execution: "3bbe05e4-bce8-4515-938d-fff4dc676827"
status: PASS
---

# Testing Result

## Feature
archive-docs-latest

## Environment
- OS: Linux 7.0.0-38-generic
- Runtime: Node v24.21.0
- Tooling: vitest 2.1.9, @vitest/coverage-v8 2.1.9, tsc, oxlint

## Execution Time
2026-10-13 17:29 (+07:00), re-test after review loop 1; full suite ~4.3 s

## Summary
| Metric | Result |
|---|---:|
| Total | 9 |
| Passed | 9 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | UC index, UC file, diagram, test plan `status: archived`; result `status: PASS` | As expected | `archive stamps canonical docs > marks the UC index, UC files, diagram and test plan archived and keeps the result status` |
| TC-002 | Unit | PASS | Source without frontmatter copied byte for byte | As expected | `… > copies a source without frontmatter unchanged` |
| TC-003 | Unit | PASS | Use Case Files row `implemented`; coverage row keeps `planned`; source artifact unchanged | As expected | `… > flips use case rows to implemented and leaves the coverage table alone` |
| TC-004 | Unit | PASS | Re-archive exit 0, no bypass, docs byte-identical | As expected | `re-archive with stamped docs > reports no changed docs and records no bypass` |
| TC-005 | Unit | PASS | Edited UC file → `canonical docs changed`, edit kept; also a status-only edit and a body edit on an unstamped legacy doc are refused | As expected | `… > still refuses when a canonical doc was edited after archive`, `… > still refuses a status-only edit on an archived doc`, `… > still refuses a body edit on an unstamped doc from an older version` |
| TC-006 | Unit | PASS | Legacy unstamped docs upgraded, exit 0, no bypass | As expected | `… > upgrades unstamped docs written by an older version without a bypass` |
| TC-007 | Unit | PASS | Skill has reconcile step, links existing `reconcile.md`, docs commit convention | As expected | `closure guidance and repository docs > kanban-archive carries the reconcile step and the post-merge docs commit` |
| TC-008 | Unit | PASS | Template has `## Docs Reconciled` | As expected | `… > the feature report template asks for the reconciled docs` |
| TC-009 | Unit | PASS | No `status: planning` in `docs/use-cases`, `docs/testplan`; done-trigger UC-001 superseded | As expected | `… > no canonical use case or test plan is left in planning, and superseded docs are marked` |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run src/tests/archive-docs.test.ts src/tests/sync.test.ts --reporter=verbose` | 0 | 17 passed (17) |
| `npm test` | 0 | Test Files 32 passed, Tests 512 passed |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint src clean |
| `npm run build` | 0 | dist rebuilt |
| `npx vitest run --coverage --coverage.include=src/cli/commands/archive.ts --coverage.include=src/cli/commands/sync.ts` | 0 | archive.ts 89.04% lines; sync.ts 92.68% lines; overall 89.48% |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| None | — | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage (changed modules `archive.ts`, `sync.ts`) | 80% | 89.48% | v8 coverage run above |

`@vitest/coverage-v8` was declared but not installed; `npm ci` (the project's install command) restored it before measuring.

## Regression
Mutation check (not a pass/fail command): dropping the pre-stamp status guard in `isUnstampedSnapshot` turns the status-only edit test red; the guard was restored afterwards.

Full suite green (512 tests), plus the new `kf sync` case: a delivered dones item is skipped so a later superseded banner never fails the sweep, including existing archive paths in `workflow.test.ts`, `cancel.test.ts`, `sync.test.ts` and `archive-delivery.test.ts` (first archive overwrite, `--force` bypass record, `--skip-specs`, cancel→dones resync, PR merge gate).

## Conclusion
- PASS — all 9 planned cases pass (with the review-loop negative cases), no regression, coverage 89.48% ≥ 80%.

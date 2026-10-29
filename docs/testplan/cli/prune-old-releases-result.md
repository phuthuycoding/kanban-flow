---
feature: "prune-old-releases"
context: "cli"
tested: "20261029_2114"
execution: "9a7ed39b-5cdd-4d4b-8525-b846681903cc"
status: PASS
---

# Testing Result

## Feature
prune-old-releases

## Environment
- OS: macOS (Darwin)
- Runtime: Node.js v22.21.0, @phuthuycoding/kanban-flow@0.13.0 in item worktree
- Tooling: vitest 2.1.9, @vitest/coverage-v8, tsc
- Location: `/Volumes/Labs/Code/projects/kaban-flow/.worktrees/prune-old-releases`, branch `phuthuycoding/prune-old-releases` at `f99143e` (base `7b61d3f`). CLI-only helper: no dev server or domain used.

## Execution Time
2026-10-29 21:12–21:14

## Summary
| Metric | Result |
|---|---:|
| Total | 8 |
| Passed | 8 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | keep = five newest by publishedAt; `v2.0.0` not kept | keep `v0.13.0`…`v0.11.3`; `v2.0.0` absent | vitest `selectPruneSets` |
| TC-002 | Unit | PASS | deleteReleases = nine older GitHub tags | nine tags `v0.11.2`…`v0.5.0` | vitest |
| TC-003 | Unit | PASS | leftoverTags include installer/pre-rewrite tags, not keep set | `v2.0.0` `v1.1.0` `v1.0.0` `v0.4.1` `v0.4.0` present; keep absent | vitest |
| TC-004 | Unit | PASS | dry-run text names all three lists; plan unchanged | text contains keep/delete/leftover; second format identical | vitest `formatPruneDryRun` |
| TC-005 | Unit | PASS | applying the plan leaves 5 releases and 5 tags | remaining length 5 / keep tags only | vitest |
| TC-006 | Unit | PASS | extra live release throws; original fixture does not | throw `/inventory mismatch/`; fixture no throw | vitest `assertInventoryMatches` |
| TC-007 | Integration | PASS | helper source has no process runner or npm/gh/git tokens | no `child_process`, exec/spawn, `\bnpm\b`, `\bgh\b`, `\bgit\b` | vitest reads `release-prune.ts` |
| TC-008 | Unit | PASS | four releases → no-op, leftoverTags empty, reason set | delete/leftover empty; reason `fewer than 5` | vitest |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run src/tests/prune-old-releases.test.ts` | 0 | 8 tests passed (10ms, then 5ms on coverage rerun) |
| `npx vitest run src/tests/prune-old-releases.test.ts --coverage --coverage.include=src/tests/helpers/release-prune.ts` | 0 | lines 100%, stmts 100%, funcs 100%, branches 73.33% |
| `npm run typecheck` | 0 | `tsc -p tsconfig.json --noEmit` clean |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| None | — | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| `src/tests/helpers/release-prune.ts` lines | 80% | 100% | v8 text-summary, coverage rerun |
| `src/tests/helpers/release-prune.ts` branches | N/A (line target in plan) | 73.33% | uncovered 23, 31-32, 64-68, 73 (empty-tag skip, equal publishedAt tie, empty-list dry-run lines, length-mismatch in sameSet) |

## Regression
The eight approved cases pass at `f99143e`. `npm test` once reported a flake in `src/tests/drive.test.ts` concurrent `--stop` (task worktree path missing); isolated re-runs of that case passed with and without this helper. It is not in this feature's TC list.

## Conclusion
- PASS: all 8 approved test cases pass; typecheck exit 0; helper line coverage 100% meets the 80% target.
- Live GitHub/git/npm prune is still gated on a human-confirmed dry-run after review (FR-004); it is not a CI case.

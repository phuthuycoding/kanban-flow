---
feature: "affected-surfaces"
context: "cli"
tested: "20261012_2111"
execution: "799bbb1c-629b-4411-b994-3ffc109e335f"
status: PASS
---

# Testing Result

## Feature
affected-surfaces

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node.js + vitest 2.1.9 on branch `kf/affected-surfaces`
- Tooling: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run --coverage` (v8)

## Execution Time
2026-10-12 ~21:04–21:05 local

## Summary
| Metric | Result |
|---|---:|
| Total | 10 |
| Passed | 10 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | missing `## Affected surfaces` heading → ERROR, gate_blocked, no move | `affected_surfaces_missing` finding + `cmdStage` exit 1, stage stays brainstorm | `affected-surfaces.test.ts` › refuses brainstorm exit |
| TC-002 | Unit | PASS | placeholder / comment-only / empty bodies all refuse | all three variants produce the finding | › refuses placeholder, comment-only and empty bodies |
| TC-003 | Unit | PASS | real surface bullets pass the gate | `cmdStage` exit 0, item in planning | › lets a spec with real surfaces stage |
| TC-004 | Unit | PASS | check is brainstorm-scoped — legacy items unaffected | implementation-stage spec without the section validates clean | › never fires outside brainstorm |
| TC-005 | Unit | PASS | spec template ships the section; plan template documents coverage | both template files contain the section + `{affected_surfaces}` + convention line | › spec template ships the section |
| TC-006 | Unit | PASS | skills, workflow docs, CHANGELOG all teach the contract | 5 files match `/affected surfaces/i` | › skills, workflow docs and changelog |
| TC-007 | Unit | PASS | uncovered declared surface → WARNING naming it, non-blocking | exactly one WARNING for "docs site", severity WARNING, no ERROR | › warns per uncovered surface |
| TC-008 | Unit | PASS | covered surfaces produce no warning | zero `affected_surface_uncovered` findings | › silent when covered |
| TC-009 | Unit | PASS | `N/A` / `n/a` / `N/A.` all pass the gate, zero warnings | all three variants staged, no findings | › accepts N/A variants |
| TC-010 | Unit | PASS | bug specs exempt; N/A+real bullets warns only on named surfaces | bug: no finding ever; mixed section warns on "landing page" only | › bug specs and N/A-mixed sections |

Plus 2 primitive tests for `readMarkdownSection`/`sectionItems` (heading extraction, comment/marker/token stripping).

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run src/tests/affected-surfaces.test.ts` | 0 | 12 tests passed (10 TCs + 2 primitives) |
| `npm test` | 0 | 500 tests passed, 31 files — zero regressions after the fixture sweep |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint src — clean |
| `npm run build` | 0 | tsc build + postbuild ok |
| `npx vitest run --coverage --coverage.include='src/shared/frontmatter.ts' --coverage.include='src/workflow/validate-artifacts.ts' --coverage.include='src/workflow/validate-traceability.ts'` | 0 | 96.84% lines aggregate; frontmatter.ts 94.5% |
| Fixture sweep — spec strings in 6 test files gained `## Affected surfaces` + `N/A` | 0 | the 83 initially-broken tests all pass again |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — | none | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Lines on touched modules | 80% | 96.8% | v8 report above |

## Regression
The brainstorm-exit gate made 83 pre-existing tests red on first run — every one was a spec fixture legitimately missing the new section (the gate working as designed). All 6 fixture sites got the section with `N/A` and the suite is green again at 500. No production-code fix was needed, which is itself evidence the gate only refuses what it should.

## Conclusion
- PASS — all 10 planned cases green on execution `799bbb1c-629b-4411-b994-3ffc109e335f`, coverage 96.8% ≥ 80%, full suite green, typecheck/lint/build clean.

---
feature: "worktree-opt-out"
context: "worktree"
tested: "20261017_1800"
execution: "193e4052-d385-45c2-9d2a-c7e3862228b9"
status: PASS
---

# Testing Result

## Feature
worktree-opt-out

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0, vitest
- Tooling: `npm test` (vitest), `npm run typecheck` (tsc --noEmit), `npm run lint` (oxlint)

## Execution Time
~22s test suite run (2026-10-17 ~18:00 local)

## Summary
| Metric | Result |
|---|---:|
| Total | 7 planned TCs |
| Passed | 7 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 (worktree config defaults: absent + `{}` block → `enabled:false`) | Unit | PASS | `enabled===false` both | `enabled===false` both | `worktree.test.ts` "defaults and validates the worktree block" |
| TC-002 (explicit `enabled:true`/`false` honoured verbatim) | Unit | PASS | explicit values kept | both kept | same test — `{enabled:true, portBase:6000}` and `{enabled:false}` assertions |
| TC-003 (stage→implementation, block without `enabled` → nothing provisioned) | Integration | PASS | no worktree dir/meta/`Worktree:` output | none created, stdout clean | `worktree.test.ts` "absent enabled flag provisions nothing" |
| TC-004 (`enabled:true` provisions identically to legacy) | Integration | PASS | worktree+branch+route+registry on transition | all created; `t/demo` branch, `demo.repo.test:5100` | existing "creates worktree + branch + route + registry" test unchanged-green |
| TC-005 (doctor silent on opted-out project) | Integration | PASS | no `worktree infra` finding / `worktree setup` suggestion | none in output | `doctor.test.ts` "never probes worktree domain infra on an opted-out project" |
| TC-006 (`kf worktree list`/`create` usable under default-off) | Integration | PASS | commands run; explicit create provisions | list 0; create 0, meta.worktree set | `worktree.test.ts` "operator commands ignore the flag" |
| TC-007 (teardown still runs under default-off) | Integration | PASS | cancel tears down recorded worktree despite flag | dir removed, meta cleared, stage cancelled | `worktree.test.ts` "teardown still runs under default-off" |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` (vitest, full suite) | 0 | 34 files, 560 tests passed |
| `npx vitest run src/tests/ade-sync.test.ts src/tests/worktree.test.ts src/tests/doctor.test.ts` | 0 | 78 tests passed incl. new cases |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint clean |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| ade-sync "stage → implementation also attaches" (initial run) | fixture relied on default-on provisioning | test-only break | fixed by adding explicit `enabled: true` to the fixture config — suite green on re-run |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Planned TC execution | 7/7 | 7/7 | all implemented as vitest cases |
| New-code branch coverage | 80% | N/A | single-line default flip; behavioural coverage via integration TCs 003–007 is the meaningful signal |

## Regression
Full suite green (560 tests). The one initial failure was a test fixture relying on the old default — real consumers that opted in explicitly are unaffected; teardown/operator paths verified under default-off (TC-006, TC-007).

## Conclusion
- PASS — worktree provisioning is opt-in (`enabled` defaults false), doctor stays silent for opted-out projects, operator commands and teardown ignore the flag, and explicit `enabled: true` reproduces legacy behaviour exactly.

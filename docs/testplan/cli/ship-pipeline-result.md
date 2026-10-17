---
feature: "ship-pipeline"
context: "cli"
tested: "20261017_1809"
execution: "117cc0ef-8232-46ca-9423-2e56bab7d7b3"
status: PASS
---

# Testing Result

## Feature
ship-pipeline

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0, vitest
- Tooling: `npm test`, `npm run typecheck` (tsc --noEmit), `npm run lint` (oxlint); `gh` exercised via PATH-injected stub, git ops against a real local bare remote

## Execution Time
~22s full suite (2026-10-17 ~18:09 local)

## Summary
| Metric | Result |
|---|---:|
| Total | 9 planned TCs |
| Passed | 9 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 (schema: shipping in STAGES/TRANSITIONS/GATES/INDEX) | Unit | PASS | shipping idx 6, review→shipping edge, shipping→dones only | exact | `ship.test.ts` "schema: shipping stage"; `schema.test.ts` updated |
| TC-002 (review+PASS → shipping) | Integration | PASS | stage move succeeds | `review → shipping` moved | `ship.test.ts` "review + PASS enters shipping" |
| TC-003 (refusals: non-review stage, FAIL report) | Integration | PASS | both refused, stage unchanged | refused, stage kept | `ship.test.ts` "refuses without a PASS report and from other stages" |
| TC-004 (`ship` config: defaults + per-key validation) | Unit | PASS | absent → all-false; bad values throw | defaults + throws | `ship.test.ts` "ship config parse" |
| TC-005 (`kf ship` publish: PR open, meta.pr, idempotent) | Integration | PASS | push+pr create once, meta.pr recorded, re-run skips | done; `pr create` logged once across 2 runs | `ship.test.ts` "publishes once…" |
| TC-006 (merge gate: manual waits / auto schedules once / merged proceeds) | Integration | PASS | manual reports waiting; auto `--auto` once; MERGED continues | all three observed | `ship.test.ts` "auto merge schedules once…" + "publishes once…" |
| TC-007 (release + changelog: run/stamp vs skip) | Integration | PASS | release tags + stamps; skips recorded, nothing written | `release create` run; skip path leaves no CHANGELOG | `ship.test.ts` both pipeline tests |
| TC-008 (archive accepts shipping; unmerged PR refuses; review→dones direct) | Integration | PASS | shipping→dones works; OPEN refuses; direct review archive works | all three | `ship.test.ts` "archive accepts shipping…" |
| TC-009 (`kf sync` sweeps merged shipping items) | Integration | PASS | sync archives shipping item when PR merged | archived → dones | `ship.test.ts` "kf sync sweeps shipping items" |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` (full suite) | 0 | 35 files, 570 tests passed |
| `npx vitest run src/tests/ship.test.ts` | 0 | 10 tests passed |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint clean |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — none open — fixture nits during development (missing bin dir, missing bare origin remote) | test-only | fixed in-file; not product issues | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Planned TC execution | 9/9 | 9/9 | all implemented as vitest cases |
| New-code coverage | 80% | N/A | repo measures behavioural coverage; all ship code paths (publish/merge/release/changelog + refusal + resume) exercised by integration tests |

## Regression
Full suite green (570). Existing tests that hardcoded stage counts/lists were updated (schema, status, workflow, cancel, dashboard, open-source-surface). `ade-sync` fixture got explicit `enabled: true` — intended semantics of opt-in worktrees. Absent `ship` block keeps old pipeline byte-for-byte (manual checklist path covered by TC-005 test).

## Conclusion
- PASS — `shipping` stage lands between review and dones as an optional leg, `kf ship` runs the resumable publish→merge→release→changelog pipeline under config control, archive/sync cover it, and the existing pipeline is untouched when the feature is off.

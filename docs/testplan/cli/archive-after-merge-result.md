---
feature: "archive-after-merge"
context: "cli"
tested: "20261011_1150"
execution: "adf81f27-9bc3-41e8-9298-c7c1a86b67f8"
status: PASS
---

# Testing Result

## Feature
archive-after-merge

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node.js + tsx/vitest 2.1.9; bash 3.2 for the stubbed `gh` binary
- Tooling: `npm test` (vitest run), `npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run --coverage` (v8)

## Execution Time
2026-10-11 ~11:48–11:50 local

## Summary
| Metric | Result |
|---|---:|
| Total | 22 |
| Passed | 22 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | PR OPEN → exit 1, zero side effects | exit 1, item stayed in review, no meta/docs/hook writes | `archive-delivery.test.ts` › refuses a OPEN PR |
| TC-002 | Unit | PASS | PR CLOSED-unmerged → refuse | exit 1, same zero-side-effect assertions | › refuses a CLOSED PR |
| TC-003 | Unit | PASS | gh failure / garbage output / missing repository → refuse | all three variants exit 1, flag absent | › unverifiable variants |
| TC-004 | Unit | PASS | `--force` cannot bypass the merge gate | force run refused identically | › no --force escape |
| TC-005 | Unit | PASS | dones-stage item with unmerged PR refuses reconcile | exit 1 after the merged archive, before any re-side-effect | › already-dones item |
| TC-006 | Unit | PASS | bug items hit the same gate | `kind: bug` + OPEN PR → exit 1 | › applies to bug items |
| TC-007 | Unit | PASS | merged PR → move, docs, hook close+board, flag last | dones + `delivered`/`deliveredAt` + canonical docs; stub log shows `pr view`, `issue close`, `item-edit` | › delivers a merged item |
| TC-008 | Unit | PASS | packaged `dones.sh` closes issue + moves board; `delivered.sh` absent | stub log shows `issue close` + `item-edit`; pack dir has no `delivered.sh` | › packaged dones.sh |
| TC-009 | Unit | PASS | mid-pass docs failure rolls back; flag never written | archive threw, folder restored to review, `delivered` absent, re-runnable | › rolls back a mid-pass failure |
| TC-010 | Unit | PASS | `kf stage <f> dones` hits the same merge gate | refusal identical to `kf archive` | › kf stage dones |
| TC-011 | Unit | PASS | no `pr` → proceeds (human run = confirmation) | exit 0, `delivered` stamped, no `pr view` call | › proceeds on human run |
| TC-012 | Unit | PASS | no `issue` → warning, not refusal | exit 0 + "no linked issue" warning | › warns when no issue linked |
| TC-013 | Unit | PASS | no-`pr` bug archives the same way | exit 0, bug in dones, flag stamped | › archives a bug |
| TC-014 | Unit | PASS | legacy dones reconcile: docs resync + hook re-run + flag | second `issue close` logged, `delivered` written | › re-runs docs + hook |
| TC-015 | Unit | PASS | idempotent re-run on delivered item | "already marked delivered", `deliveredAt` preserved | › idempotent |
| TC-016 | Unit | PASS | status shows awaiting-merge only for review-PASS + issue | "Awaiting merge — run: kf archive" present; absent without PASS | › status shows awaiting merge |
| TC-017 | Unit | PASS | doctor flags undelivered dones + inert `statusMap.delivered` | WARNING → `kf archive`; WARNING on dead config key | › doctor points… |
| TC-018 | Unit | PASS | skills/docs teach archive-as-delivery; no stale `issues done` instruction | `cli-reference.md`, `state-machine.md`, `gates.md`, `kanban-archive`/`kanban-flow` updated; remaining refs are deprecation notes or the superseded done-trigger docs | grep sweep `skills/ docs/` |
| TC-019 | Unit | PASS | sweep archives only MERGED PR-linked items | merged → dones+flag; OPEN skipped; no-pr untouched | `sync.test.ts` › archives merged |
| TC-020 | Unit | PASS | no-repo → error; unverifiable → skip+warn; one failure doesn't stop sweep | all three variants verified, exit codes correct | `sync.test.ts` › 3 cases |
| TC-021 | Unit | PASS | `issues done` = deprecated alias → forwards to archive | warning + archive ran; same refusal on unmerged PR | › forwards to archive |
| TC-022 | Unit | PASS | no `KFW_PROJECT_STATUS_DELIVERED` default; `statusMap.delivered` parses | env.out = `unset:Done`; config parses | › emits no default |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint src — no findings |
| `npm run build` | 0 | tsc build + postbuild ok |
| `npx vitest run src/tests/archive-delivery.test.ts src/tests/sync.test.ts` | 0 | 26 tests passed (21 + 5) |
| `npm test` | 0 | 488 tests passed across 30 files — zero regressions |
| `npx vitest run --coverage --coverage.include='src/cli/commands/**' --coverage.include='src/workflow/status.ts' --coverage.include='src/project/doctor.ts' --coverage.include='src/integrations/hooks.ts'` | 0 | 85.5% lines overall; archive.ts 88.1%, sync.ts 92.7%, helpers.ts 96.4%, status.ts 97.8%, doctor.ts 91.2% |
| `diff -r kanban-flow/github-hooks/ .kf/hooks/` | 0 | packaged and installed copies identical; `delivered.sh` absent from both |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — | none | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Lines on touched CLI/workflow modules | 80% | 85.5% | vitest v8 report above; every modified module ≥ 80% lines |

## Regression
Full suite (`npm test`) ran green — 488 tests, 30 files, including the rewritten `issues-done.test.ts` → `archive-delivery.test.ts` migration, new `sync.test.ts`, and unchanged workflow/cancel/status/doctor/hooks suites. The `dones` reconcile path now running the hook + stamping `delivered` did not break the existing archive-consistency or cancel-reopen cases.

## Conclusion
- PASS — all 22 approved test cases pass on the current execution `adf81f27-9bc3-41e8-9298-c7c1a86b67f8`, coverage 85.5% ≥ 80% target, full suite green, docs/skills/CHANGELOG updated to the archive-as-delivery semantics.

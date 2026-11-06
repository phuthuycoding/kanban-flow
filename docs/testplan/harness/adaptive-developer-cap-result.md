---
feature: "adaptive-developer-cap"
context: "harness"
tested: "20261102_1821"
execution: "c74e99f7-2b0a-4358-8d61-14571cdb8174"
status: PASS
---

# Testing Result

## Feature
adaptive-developer-cap

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node.js v22.21.0
- Tooling: vitest (`npx vitest run --coverage`), tsc, oxlint; worktree `/Volumes/Labs/Code/projects/kaban-flow/.worktrees/adaptive-developer-cap` at 5d920f2

## Execution Time
2026-11-02, about 18:12 +07:00 (re-test after review repair round 2)

## Summary
| Metric | Result |
|---|---:|
| Total | 16 |
| Passed | 16 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

Suite: 92 test files, 1731 tests, 1731 passed.

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | `harness.developers.max` accepted for integers 1..16 | accepted; 0, 17, non-integer rejected | src/tests/harness-config.test.ts |
| TC-002 | Unit | PASS | absent or `{}` gives max 6 with source default | `{"max":6,"source":"default"}` | src/tests/harness-config.test.ts, src/tests/tasks-command.test.ts |
| TC-003 | Integration | PASS | `kf tasks --json` carries `developers: {max, source}`, change is additive | field present, other keys unchanged | src/tests/tasks-command.test.ts; behaviour run below |
| TC-004 | Unit | PASS | skill starts at min(2, ceiling) and ledgers the start ruling | pinned in SKILL.md and task-loop.md | src/tests/adaptive-cap-surface.test.ts |
| TC-005 | Unit | PASS | +1 per clean parallel wave in wave order, inline waves never change N, `Note wave <w>: no step-up` | pinned in both files | src/tests/adaptive-cap-surface.test.ts |
| TC-006 | Unit | PASS | nine contention signatures, halve once per event, rerun note, one re-run; a re-run never steps down again; at most once per task and signature until a verify passes, with the re-run kept and resume agreeing (review repairs 1–2) | pinned | src/tests/adaptive-cap-surface.test.ts |
| TC-007 | Unit | PASS | wait line `<N> developers in flight`, resume rules (a)–(d), step-8 guard | pinned | src/tests/adaptive-cap-surface.test.ts, loop-ledger-surface.test.ts, loop-parallel-surface.test.ts |
| TC-008 | Integration | PASS | `kf loop-stats` reads a live-cap ledger | fixture matches expected JSON | src/tests/loop-stats.test.ts + fixtures/loop-stats/adaptive-cap.* |
| TC-009 | Unit | PASS | plan `Execution:` N = wave width | pinned | src/tests/inline-execution.test.ts |
| TC-010 | Unit | PASS | docs carry the live cap, no fixed 4, `developers.max`, wait line, `developers` field | pinned | src/tests/open-source-surface.test.ts |
| TC-011 | Integration | PASS | #126 and #129 bodies describe the chosen design, with a task list on #129 | #126 has the chosen design and "Implemented by #129"; #129 has the spec plus 21 checklist items | `gh issue view 126/129` (controller check) |
| TC-012 | Unit | PASS | `worktree.domains` boolean, default true | validated | src/tests/worktree-domains.test.ts |
| TC-013 | Integration | PASS | no infra probes when off | probes skipped | src/tests/worktree-domains.test.ts; behaviour run below |
| TC-014 | Integration | PASS | direct URL only, no `KFW_WORKTREE_DOMAIN` when off; JSON unchanged | as expected, including an old registration, an invalid config and an inherited stale KFW_WORKTREE_DOMAIN in the parent env (review repair) | src/tests/worktree-domains-output.test.ts |
| TC-015 | Unit | PASS | routes and ports still allocated, `domain` stored | as expected | src/tests/worktree-domains-output.test.ts |
| TC-016 | Unit | PASS | skills, docs, help and repo config document the switch; this repo sets `domains: false` | pinned; config parsed as JSON | src/tests/worktree-domains-surface.test.ts |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run --coverage --coverage.reporter=text-summary` | 0 | Test Files 92 passed (92); Tests 1731 passed (1731); Statements 85.86%, Branches 88.05%, Functions 93.63%, Lines 85.86% |
| `kf verify adaptive-developer-cap --stage` (build + `npm test`) | 0 | "All 2 stage verify command(s) passed." at 5d920f2 |
| `npm run build && npm run typecheck && npm run lint` | 0 | build ok, tsc no errors, oxlint exit 0 |
| `node dist/index.js tasks adaptive-developer-cap --json` → `.developers` | 0 | `{"max":6,"source":"default"}` |
| `node dist/index.js worktree --help` | 0 | contains `worktree.domains": false to skip the .test domain infrastructure and use http://127.0.0.1:<port>` |


## Behaviour run
The `kf doctor` runs below are observations, not pass/fail commands. In the temp repo, doctor exits 1 because of the minimal setup there.
- `node dist/index.js doctor` in a temp repo with `worktree.domains: true`: exit 1. prints `worktree infra (dns)` and `worktree infra (proxy)` warnings; exit 1 comes from the temp repo's minimal setup
- `node dist/index.js doctor` in the same repo with `worktree.domains: false`: exit 1. no infra warnings; same unrelated exit 1
- `node dist/index.js doctor` with `harness.developers.max: 17`: exit 1. `harness.developers.max must be an integer from 1 to 16` (expected rejection)
- TC-003: `kf tasks --json` printed `developers {"max":6,"source":"default"}` for this item.
- TC-013: with `domains: false`, `kf doctor` printed no DNS or proxy probe; flipping it to `true` brought back both warnings.
- TC-001: a ceiling of 17 is refused with the documented message.
- Not run live: this repo's own `kf status` with `domains: false`. kf resolves the project root through the git common dir, so it reads the main checkout's `.kf/config.json`, which does not have the branch change until merge; it still printed the Domain line. The direct-URL output is covered by src/tests/worktree-domains-output.test.ts against a real temporary repo.
- Not runnable: the live cap's run-time behaviour (step up and down) is controller prose, not code; the evidence is the surface tests plus the loop-stats fixture. This item's own ledger was written by a controller running the installed (pre-feature) skill.

Changed behaviour no test touches: none in code. The prose rules are pinned by surface tests only; whether a controller follows them is not machine-tested.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | - | - | - |

During implementation, `auto-close.test.ts` ("Test timed out") and `claude-plugin.test.ts` ("Hook timed out") failed once in TASK-002's verify. These files are outside this item, and a single re-run passed. The full run above passed.

## Coverage
Lines 85.86% and branches 88.05% against the 80% target: met.

## Conclusion
PASS. All 16 test cases pass, the full suite is green (1731/1731), coverage is above target, and the behaviour runs confirm the config validation, the `developers` field and the probe switch.

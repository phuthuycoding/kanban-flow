---
feature: "drive-retire"
context: "harness"
tested: "20261101_1645"
execution: "792601ab-50a0-4b14-a34e-88aa0f749941"
status: PASS
---

# Testing Result

## Feature
drive-retire

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0
- Tooling: vitest 2 with @vitest/coverage-v8, oxlint, tsc; built CLI `node dist/index.js` in the item worktree `/Volumes/Labs/Code/projects/kaban-flow/.worktrees/drive-retire` at 355722c (after review repair 4)

## Execution Time
Full suite with coverage: ~55 s (70 files, 1131 tests).

## Summary
| Metric | Result |
|---|---:|
| Total | 19 |
| Passed | 19 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Integration | PASS | Exit 2; names the file outside Files; no verify command runs | As expected | src/tests/verify.test.ts (24 tests pass) |
| TC-002 | Integration | PASS | Exit 1 naming `false` and its code; then exit 0 | As expected | src/tests/verify.test.ts |
| TC-003 | Integration | PASS | Each bad input exits 3 with the reason; marker never runs | As expected, now including `--base` with no value and an unparseable config (review repair 1); behaviour run: unknown TASK-999 → exit 3, `--base` with no value → exit 3 | src/tests/verify.test.ts; Behaviour run below |
| TC-004 | Integration | PASS | `--stage` exit 0 / exit 1 naming the command with code 4 / exit 0 when nothing configured | As expected; behaviour run `--stage` → exit 0 | src/tests/verify.test.ts |
| TC-005 | Integration | PASS | No worktree → runs in the project root and says so | As expected | src/tests/verify.test.ts |
| TC-006 | Unit | PASS | pathAllowed cases unchanged; empty Files skipped and reported; ENOENT names the command | As expected; repair 2: `[` is literal in pathAllowed, patternsOverlap and the travel estimates copy | src/tests/allowlist.test.ts (17), src/tests/travel-overlap-parity.test.ts (17) |
| TC-007 | Integration | PASS | drive/run/runs/harness exit 1 `unknown command`; `kf -h` lists `verify` | As expected; behaviour run: all four exit 1 "Unknown command" | src/tests/drive-retired.test.ts (20) |
| TC-008 | Integration | PASS | No refusal on run/drive grounds; leftover keys survive other writes | As expected | src/tests/drive-retired.test.ts |
| TC-009 | Integration | PASS | `Next:` names the implement skill; inspect/autoconfig name no removed command | As expected | src/tests/drive-retired.test.ts |
| TC-010 | Unit | PASS | Plans with/without Role parse alike; no `task_role_unknown`; no `role` in JSON; template has no Role column | As expected; behaviour run `kf tasks drive-retire` prints no role | src/tests/task-graph.test.ts (20), tasks-command.test.ts (9), doctor.test.ts (37), task-harness-surface.test.ts (4) |
| TC-011 | Unit | PASS | kanban-implement: `kf verify --task` after commit, before reviewer; exits 1/2/3 per FR-004; `--stage` build gate | As expected | src/tests/harness-agents-surface.test.ts (32) |
| TC-012 | Unit | PASS | No `kf-run:`/`assignedRoles`; removed commands only in the removal note; review fallback tells the human | As expected | src/tests/harness-agents-surface.test.ts |
| TC-013 | Unit | PASS | Travel: no `kf drive`; slots=N, worktree per item, background seats; slots=1; resume order | As expected | src/tests/travel-surface.test.ts (15) |
| TC-014 | Integration | PASS | Legacy configs load; one `harness_legacy_key` per key naming `kf doctor --fix` | As expected | src/tests/harness-config.test.ts (9), harness-legacy.test.ts (24) |
| TC-015 | Integration | PASS | `--fix` removes legacy keys; every other key keeps its value | As expected; repair 2: atomic write keeps a 4-space/tab indent; ambiguous item is a per-item ERROR; one ERROR for an unparseable meta with the SyntaxError text | src/tests/harness-legacy.test.ts |
| TC-016 | Integration | PASS | `kf init` keeps legacy keys; fresh init writes no harness block | As expected; repair 2: an existing config gets only missing repository/schema/created, `ship`, statusMap `dones` and indent survive byte-for-byte | src/tests/harness-legacy.test.ts, contexts.test.ts (71) |
| TC-017 | Integration | PASS | `meta_legacy_run_state` per item with live pid and "stop this process yourself"; `--fix` strips four keys; nothing killed | As expected; repair 2/3: an item naming a live pid whose command line is a kf drive/run (ps-confirmed, 1 s timeout; unconfirmed when ps cannot answer) is left byte-identical and reported (exit 1); a recycled pid of an unrelated process is stripped | src/tests/harness-legacy.test.ts, doctor.test.ts |
| TC-018 | Unit | PASS | Docs mention removed commands only as removal notes | As expected | src/tests/open-source-surface.test.ts (25) |
| TC-019 | Unit | PASS | `src/harness/` and `src/worktree/tasks.ts` gone; no import from `harness/` | As expected | src/tests/drive-retired.test.ts |

## Behaviour run

Run in the item worktree with the built CLI at 355722c (after review repair 4) (stands in for nothing untested; it confirms the real command path):

| Command | Exit | Output (tail) |
|---|---:|---|
| `node dist/index.js verify drive-retire --task TASK-999 --base HEAD` | 3 | Unknown task 'TASK-999': it is not in the Task Breakdown of 'drive-retire'. |
| `node dist/index.js verify drive-retire --task TASK-001 --base` (no value) | 3 | Usage: kf verify <feature> --task TASK-### --base <sha> \| kf verify <feature> --stage — bad input |
| `node dist/index.js verify drive-retire --task TASK-007 --base 66caedc` | 0 | Every changed file is inside TASK-007's Files. All 1 task verify command(s) passed. |
| `node dist/index.js verify drive-retire --stage` | 0 | All 2 stage verify command(s) passed. |
| `node dist/index.js drive drive-retire` / `run` / `runs` / `harness` | 1 each | Unknown command: drive (run, runs, harness). Use "kf help". |
| `node dist/index.js tasks drive-retire` | 0 | rows `TASK-001  wave 1  done  deps: -  files: …` with no role field |
| `node dist/index.js doctor` | 0 | ✓ Healthy. |
| `node dist/index.js install --global` (from this linked worktree) | 1 | kf runs from a linked git worktree (…/.worktrees/drive-retire); a global install would link into it and dangle once it is removed — run it from the primary checkout; `~/.claude/agents` unchanged |
| `node dist/index.js init --minimal` at global scope from the worktree | covered by install.test.ts (refuses before any write) |
| `node dist/index.js feature run` | 1 | unknown verb: run |
| `node dist/index.js worktree list` | 0 | item row with path/branch/domain, no `tasks:` row |

Changed behaviour no test touches:
- None identified: the worktree-root agents-link bug is now refused and pinned by install.test.ts (install --global and doctor --fix, skills and agents paths); skill prose remains pinned by surface tests on the text only.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm run lint` | 0 | oxlint src — no findings |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run build` | 0 | dist rebuilt |
| `npm test` | 0 | Test Files 70 passed (70); Tests 1131 passed (1131) |
| `npx vitest run --coverage` | 0 | 70 files / 1131 tests passed; Statements 87.52%, Branches 87.11%, Functions 94.08%, Lines 87.52% |
| `node dist/index.js verify drive-retire --stage` | 0 | All 2 stage verify command(s) passed. |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| None | - | - | - |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage | 80% | 87.52% | v8 line coverage, `npx vitest run --coverage` |

## Regression
Re-tested after review repair 4 (findings of review a7c4ac9f; commits 10ca34c, 355722c) and repair 3 (findings of review 162b32e3; commits 4d630c9..7107cd5) on top of repair 2 (8eedade..d0b8afa); previous reports kept at reviews/testing-result-{36b21d54,c55afa36,162b32e3,a7c4ac9f}.md.
Full suite 1131/1131 green after deleting the drive/run runtime (−4837 non-test src lines). Removed commands fail with `unknown command`; leftover config keys and item meta still load and are cleared only by `kf doctor --fix`.

## Conclusion
- PASS: all 19 planned test cases pass, the full suite is green, coverage 87.52% ≥ 80%, and the changed CLI paths were run for real.

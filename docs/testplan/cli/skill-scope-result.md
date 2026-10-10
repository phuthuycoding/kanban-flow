---
feature: "skill-scope"
context: "cli"
tested: "20261010_1849"
execution: "c6edb1cf-c9d2-48c8-bae6-4fad99624fec"
status: PASS
---

# Testing Result

## Feature
skill-scope

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: node >=20, vitest ^2.1.0, @vitest/coverage-v8 ^2.1.0
- Tooling: `npm test` (vitest), `npm run typecheck`, `npm run lint` (oxlint), `npm run build`, `node dist/index.js` smoke

## Execution Time
2026-10-10 ~18:49 local

## Summary
| Metric | Result |
|---|---:|
| Total | 20 |
| Passed | 20 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | `init --defaults` links `~/.claude/skills/kanban-*` → package, no project copies | symlinks verified via lstat; `skills.scope: "global"` in config | `skill-scope.test.ts` "kf init --defaults links skills into ~" |
| TC-002 | Unit | PASS | symlink EPERM → copy fallback + "copied" mode | all 8 land as real dirs, `mode: "copy"` | `install.link-fallback.test.ts` (vi.mock EPERM) |
| TC-003 | Unit | PASS | `init --minimal` on `skills.scope: "project"` → project copies, `~` untouched | `.claude/skills` populated in project; home dir empty | `skill-scope.test.ts` "kf init --minimal respects" |
| TC-004 | Unit | PASS | `askAll` answering project → `skillScope: "project"`; `saveConfig` persists | `skills.scope: "project"` in `.kf/config.json` | `skill-scope.test.ts` onboarding tests |
| TC-005 | Unit | PASS | defaults resolve global; configured project stays question default | `bootstrapDefaults().skillScope === "global"`; stub rl keeps "project" | `skill-scope.test.ts` onboarding tests |
| TC-006 | Unit | PASS | absent → global; `scope: "banana"` / non-object → named-field error | throws `/skills\.scope must be "global" or "project"/` | `skill-scope.test.ts` config block |
| TC-007 | Unit | PASS | global install → `~` links + managed project copies removed, unrelated kept | links present; `unrelated/` intact; "Cleaned project copies" in output | `skill-scope.test.ts` UC-003 test |
| TC-008 | Unit | PASS | `--scope global` on `skills.scope: "project"` → project copies preserved + note | copies intact; stdout warns both scopes populated | `skill-scope.test.ts` TC-008 test |
| TC-009 | Unit | PASS | `--scope global` outside `.works/` → `~` only | exit 0, links in HOME, nothing in cwd | `skill-scope.test.ts` TC-009 test |
| TC-010 | Unit | PASS | install+uninstall global → package byte-identical | sha1 snapshot of `skills/` identical pre/post | `skill-scope.test.ts` TC-010 + "removes links without touching" |
| TC-011 | Unit | PASS | `--scope project` copies real dirs; `~` links untouched | project entries are dirs, `~` entries still links | `skill-scope.test.ts` UC-004 test |
| TC-012 | Unit | PASS | `--scope project` outside `.works/` → refuse | exit 1, `stderr: "not a kanban project"` | `skill-scope.test.ts` TC-012 test |
| TC-013 | Unit | PASS | `uninstall --scope global` → `~` removed, warning, project intact | "shared by every project" + project copies survive | `skill-scope.test.ts` UC-005 test |
| TC-014 | Unit | PASS | `uninstall --scope project` → project removed, `~` survives | project entries gone; links still resolve | `skill-scope.test.ts` UC-005 test |
| TC-015 | Unit | PASS | `uninstall --scope global` outside `.works/`; idempotent | first removes, second "already clean", exit 0 | `skill-scope.test.ts` UC-005 test |
| TC-016 | Unit | PASS | autoconfig prints scope + per-agent linked/missing status + fix | "scope: global", "— missing" → "— linked" | `skill-scope.test.ts` status tests |
| TC-017 | Unit | PASS | mutated copy → stale; reinstall → clean | `agentSkillsState` flips stale→copied; file restored | `skill-scope.test.ts` TC-017 test |
| TC-018 | Unit | PASS | dangling link → broken; `doctor --fix` recreates | finding "broken-link"; after fix `linked`, finding gone | `skill-scope.test.ts` TC-018 test |
| TC-019 | Unit | PASS | scope global + project copies → duplicate flagged | doctor WARNING + autoconfig "Duplicate project-scope copies"; `kf install` cleans | `skill-scope.test.ts` TC-019 test |
| TC-020 | Unit | PASS | doctor non-ok when missing at scope; `--fix` → clean | `ok:false` + finding → install → findings cleared | `skill-scope.test.ts` TC-020 test |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` | 0 | 28 test files, 461 tests passed |
| `npx vitest run --coverage --coverage.reporter=text` | 0 | All files 86.26% stmts / 84.34% branch / 92.94% funcs |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint clean |
| `npm run build` | 0 | tsc build + postbuild chmod |
| `HOME=$(mktemp -d) node dist/index.js init --defaults` | 0 | `~/.claude/skills/kanban-*` symlinks → `skills/`; `skills.scope: "global"`; no project `.claude` |
| `HOME=$FH node dist/index.js autoconfig` | 0 | `Skills installed (scope: global): [claude]`; `— linked`; no-duplicate check `[x]` |
| `HOME=$FH node dist/index.js doctor; rc=$?; [ $rc -eq 1 ]` (missing kanban-plan) | 0 | exit 1 as designed — `skills partial (scope: global): kanban-plan` ERROR with `kf install --agent claude --scope global` action |
| `HOME=$FH node dist/index.js doctor --fix` | 0 | `installed kanban skills for claude (scope: global)`; re-run healthy |
| `HOME=$FH node dist/index.js uninstall --scope global` | 0 | shared-across-projects warning; links removed; packaged `skills/` 8 dirs intact |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — | none | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage | 80% | 86.26% | v8 text report (`All files` row) |

Per-file (touched modules): `install.ts` 90.6%, `agents.ts` 97.5%, `config.ts` 93.9%, `doctor.ts` 90.6%, `autoconfig.ts` 94.7%, `init.ts` 89.0%, `args.ts` 100%, `bootstrap.ts` 66.1% stmts (interactive prompt paths; the new `skillScope` logic is covered by `askAll`/`bootstrapDefaults`/`saveConfig` tests). Added `@vitest/coverage-v8@^2.1.0` (devDependency, matches vitest 2.x) to measure — no coverage tool was installed before.

## Regression
Full suite run: 461 tests / 28 files, 0 failures — includes updated `install.test.ts` (explicit `scope: "project"`), `doctor.test.ts`, `autoconfig.test.ts`, `contexts.test.ts`, `repository.test.ts`, `install.failure.test.ts`. A new vitest `setupFiles` (`src/tests/setup/home.ts`) gives every test a throwaway HOME so global-scope installs never touch the developer's real `~`.

## Conclusion
- PASS. All 20 approved test cases pass at the agreed `unit` level; coverage 86.26% ≥ 80%; CLI smoke verified link install, stale/broken detection, `--fix` repair, scoped uninstall and package integrity end to end.

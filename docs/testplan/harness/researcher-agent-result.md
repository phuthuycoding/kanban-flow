---
feature: "researcher-agent"
context: "harness"
tested: "20261102_1458"
execution: "dd2d049d-fa24-4699-9e2d-cf319f18888c"
status: PASS
---

# Testing Result

## Feature
researcher-agent

## Environment
- OS: Darwin 25.5.0 (macOS)
- Runtime: Node v22.21.0
- Tooling: vitest with @vitest/coverage-v8, tsc, oxlint, Claude Code 2.1.316
- Code under test: item worktree /Volumes/Labs/Code/projects/kaban-flow/.worktrees/researcher-agent, branch phuthuycoding/researcher-agent, HEAD 0f7c1da

## Execution Time
2026-11-02 13:23 to 13:40 +07:00

## Summary
| Metric | Result |
|---|---:|
| Total | 27 |
| Passed | 27 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

Suite counts: 88 test files, 1621 tests run, 1621 passed. Coverage: statements 85.81%, branches 88.02%, functions 93.61%, lines 85.66% (target 80%).

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | as in phase-2-test-case.md TC-001 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-002 | Unit | PASS | as in phase-2-test-case.md TC-002 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-003 | Unit | PASS | as in phase-2-test-case.md TC-003 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-004 | Unit | PASS | as in phase-2-test-case.md TC-004 | the tests named pass in the 1654/1654 run | plugin-package.test.ts |
| TC-005 | Unit | PASS | as in phase-2-test-case.md TC-005 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-006 | Unit | PASS | as in phase-2-test-case.md TC-006 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-007 | Unit | PASS | as in phase-2-test-case.md TC-007 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-008 | Unit | PASS | as in phase-2-test-case.md TC-008 | the tests named pass in the 1654/1654 run | spike-surface.test.ts |
| TC-009 | Unit | PASS | as in phase-2-test-case.md TC-009 | the tests named pass in the 1654/1654 run | researcher-surface.test.ts |
| TC-010 | Unit | PASS | as in phase-2-test-case.md TC-010 | the tests named pass in the 1654/1654 run | spike-surface.test.ts |
| TC-011 | Integration | PASS | as in phase-2-test-case.md TC-011 | the tests named pass in the 1654/1654 run | plugin-package.test.ts + `claude plugin validate .` exit 0 |
| TC-012 | Unit | PASS | as in phase-2-test-case.md TC-012 | the tests named pass in the 1654/1654 run | docs-plugin-surface.test.ts, plugin-package.test.ts (leftover-name greps) |
| TC-013 | Unit | PASS | as in phase-2-test-case.md TC-013 | the tests named pass in the 1654/1654 run | claude-plugin.test.ts |
| TC-014 | Unit | PASS | as in phase-2-test-case.md TC-014 | the tests named pass in the 1654/1654 run | claude-plugin.test.ts, install-claude-plugin.test.ts |
| TC-015 | Integration | PASS | as in phase-2-test-case.md TC-015 | the tests named pass in the 1654/1654 run | install-claude-plugin.test.ts (built CLI, stub claude) |
| TC-016 | Unit | PASS | as in phase-2-test-case.md TC-016 | the tests named pass in the 1654/1654 run | skill-render.test.ts |
| TC-017 | Integration | PASS | as in phase-2-test-case.md TC-017 | the tests named pass in the 1654/1654 run | skill-scope.test.ts, install.test.ts + Behaviour run B2 |
| TC-018 | Integration | PASS | as in phase-2-test-case.md TC-018 | the tests named pass in the 1654/1654 run | migration.test.ts, doctor-plugin.test.ts |
| TC-019 | Unit | PASS | as in phase-2-test-case.md TC-019 | the tests named pass in the 1654/1654 run | docs-plugin-surface.test.ts, autoconfig.test.ts, agents-file.test.ts |
| TC-020 | Integration | PASS | as in phase-2-test-case.md TC-020 | the tests named pass in the 1654/1654 run | live probe, Behaviour run B1 |
| TC-021 | Integration | PASS | as in phase-2-test-case.md TC-021 | the tests named pass in the 1654/1654 run | install.test.ts (kanban-ship retirement) |
| TC-022 | Unit | PASS | as in phase-2-test-case.md TC-022 | the tests named pass in the 1654/1654 run | skill-scope.test.ts |
| TC-023 | Unit | PASS | as in phase-2-test-case.md TC-023 | the tests named pass in the 1654/1654 run | install-ownership.test.ts, migration.test.ts |
| TC-024 | Integration | PASS | as in phase-2-test-case.md TC-024 | the tests named pass in the 1654/1654 run | doctor-plugin.test.ts + Behaviour run B3 |
| TC-025 | Unit | PASS | as in phase-2-test-case.md TC-025 | the tests named pass in the 1654/1654 run | inline-execution.test.ts |
| TC-026 | Unit | PASS | as in phase-2-test-case.md TC-026 | the tests named pass in the 1654/1654 run | inline-execution.test.ts |
| TC-027 | Unit | PASS | as in phase-2-test-case.md TC-027 | the tests named pass in the 1654/1654 run | inline-execution.test.ts |

The TC-to-file mapping comes from each task's tests report under loop/; the run proves those files pass, not that every TC clause has its own assertion. Review reads the per-task reports for that.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm run build` | 0 | tsc -p tsconfig.build.json, no errors |
| `npm run typecheck` | 0 | no errors |
| `npm run lint` | 0 | oxlint src, no findings |
| `npx vitest run --coverage --coverage.reporter=text-summary` | 0 | 88 files, 1654 tests, 1654 passed; statements 85.81%, branches 88.02%, functions 93.61%, lines 85.66% |
| `kf verify researcher-agent --stage` | 0 | "All 2 stage verify command(s) passed." (at fb0dbdc, after the repair commits of reviews 26bd8898 and d3af856a) |
| `claude plugin validate .` | 0 | "✔ Validation passed with warnings" |
| `claude -p --plugin-dir <worktree> "/kf:plan probe-only …"` (temp dir) | 0 | replied `# Kanban Phase 2 — Planning → Execution Contract (Human + Agent)`, the plan skill's H1 |
| `claude -p --plugin-dir <worktree> "Use the Agent tool … subagent_type kf:researcher …"` (temp dir) | 0 | replied `RESEARCHER: STATUS: DONE` |
| `kf init --defaults` (built CLI, temp project, skills.scope=project, agents claude/codex/gemini, no claude on PATH) | 0 | bootstrapped; printed the manual `/plugin marketplace add <root>` and `/plugin install kf@kanban-flow` commands |
| `kf doctor` (same project) | 0 | `[WARNING] Claude Code plugin: cannot check kf plugin: the claude CLI was not found on PATH` |
| `kf status --all` (same project) | 0 | `⚠ cannot check kf plugin: the claude CLI was not found on PATH` |
| `node -e renderForCopy(every skills/** and agents/** .md)` (built dist) | 0 | 35 files rendered for a copy runtime: bare `kf:<managed skill>` left = 0; `Load the kf-test skill` rewritten; `subagent_type: kf:<agent>` kept as written (researcher, automation-writer, developer, test-writer, code-reviewer×3) — FINDING-005 fix and its agent ruling |
| `grep ^tools: agents/researcher.md` | 0 | `tools: Read, Grep, Glob, WebSearch, WebFetch, Write` (no Bash) — FINDING-004 |

| `kf doctor` (built CLI, temp project, stub claude listing kf without readFromFolder, KF_ALLOW_WORKTREE_LINK=1) | 0 | `[WARNING] Claude Code plugin: kf plugin source unknown …` then `→ check claude plugin list --json; if kf does not load from <PKG_ROOT>, run claude plugin marketplace add <PKG_ROOT>` |
| `kf autoconfig` (same project) | 0 | `- Skills installed (scope: global): [claude]` and `- [x] kf plugin (kf@kanban-flow, Claude Code) — installed (scope: user) — claude does not report its source folder` |
| `kf doctor --fix` (same project, linked worktree, no override) | 0 | no `[ERROR]` refusal line, no marketplace add — unknown source is not a refused repair |
## Behaviour run

Repair round 2 (execution dd2d049d): FINDING-002/005/007 of review d3af856a and the round-2 code-review MEDIUM are run for real above with a stub claude; the researcher tool list without Bash follows the re-approved FR-001.

Negative case (expected non-zero): `kf doctor --fix` in the same project with no claude on PATH exited 1 with `[ERROR] Claude Code plugin: kf runs from a linked git worktree …` and `✗ Problems found` — a failed probe still refuses and the legacy cleanup waits, as the round-2 ruling requires.


Repair round (execution d3af856a): the review-REJECT findings 004–008 are covered by the new tests in migration.test.ts, doctor-plugin.test.ts, claude-plugin.test.ts, autoconfig.test.ts, skill-render.test.ts, researcher-surface.test.ts and inline-execution.test.ts (all in the 1650 run) plus the renderForCopy run above. Not run for real: a `kf install` from the built CLI — it refuses from a linked worktree by design (`kf runs from a linked git worktree … run it from the primary checkout`), and the kanban-ship removal and the `unknown` plugin state need a real claude plugin state; both are covered by stubbed-claude tests only.

- **B1 (TC-020):** the live probes above. Claude Code loaded `/kf:plan` from `--plugin-dir`, and an Agent call with `subagent_type: kf:researcher` reached the agent, which ended its reply with `STATUS: DONE`.
- **B2 (TC-017):** the temp project install wrote `.agents/skills/kf-{archive,brainstorm,bug,flow,implement,plan,review,spike,test,travel}`, 10 dirs. `kf-plan/SKILL.md` has frontmatter `name: kf-plan`. A grep for `CLAUDE_PLUGIN_ROOT` across the copies counts 0. `kf-flow/agents/` holds the 7 agent bodies, `researcher.md` included.
- **B3 (TC-024, the no-claude branch):** init warns and completes, doctor reports a WARNING, and status prints the probe line, all with no `claude` on PATH.
- **Refusal seen during setup:** `kf init --defaults` at global scope, run from this worktree's build, exits 1 with "the rendered copies a global install writes would point at the worktree's package root …". This is the TASK-003 refusal working as intended.

Changed behaviour no test touches:
- The npx-cache `ephemeralPackageWarning` branch in install.ts. `packageIsEphemeral()` reads a module constant, so it was not run.
- The 3000 ms timeout of the `kf status` plugin probe. The value is passed through, but no test pins it.
- A real, unstubbed `claude plugin marketplace add` / `install` into the user's Claude config. It was not run, because it would change the user's real Claude Code setup. The stubbed CLI tests and the `--plugin-dir` probe stand in for it.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | - | - | - |

## Coverage
- Target: 80% (spec Test Strategy)
- Measured: statements 85.81%, branches 88.02%, functions 93.61%, lines 85.66% (@vitest/coverage-v8, whole src)
- Met: yes

## Conclusion
PASS. All 27 TCs pass, the suite runs 1621 of 1621, coverage is above 80%, and the live plugin probe loads `/kf:plan` and dispatches `kf:researcher`. The three untested paths above are listed for review.

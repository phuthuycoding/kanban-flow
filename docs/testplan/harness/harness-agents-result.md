---
feature: "harness-agents"
context: "harness"
tested: "20261101_1015"
execution: "f3e9169f-65f6-4625-93aa-8769379628e5"
status: PASS
---

# Testing Result

> **Partly superseded by `drive-retire`:** the statements that `kf drive`, `kf run --task`, `harness.roles` and the `kf-run:` worker paragraphs of `kanban-implement` stay unchanged no longer hold — all are removed; the in-session loop is the only path. Kept for history.

> **Partly superseded by the workflow review fixes (2026-11-02):** `skills/implement/references/implementer-brief.md` is deleted — its only consumer, the removed `kf run` task worker, is gone; the developer brief is the single implementer dispatch. Kept for history.

## Feature
harness-agents

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node (repo's installed version), worktree /Volumes/Labs/Code/projects/kaban-flow/.worktrees/harness-agents at 402dc1b (after the repairs of reviews 97d2a488 and ab9697dc)
- Tooling: vitest 2 with @vitest/coverage-v8; built CLI dist/index.js

## Execution Time
2026-11-01 10:15 local (re-test after repair)

## Summary
| Metric | Result |
|---|---:|
| Total | 14 |
| Passed | 14 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | install creates six agent files; uninstall removes six, keeps foreign | as expected | install-agents.test.ts "uninstall removes all six agents when none is foreign" + existing foreign-scout case; Behaviour run below |
| TC-002 | Unit | PASS | install/uninstall help say 6 kanban agents and name the six | as expected | install-agents.test.ts "names the six agents"; `kf install -h` output below |
| TC-003 | Unit | PASS | test-writer < developer < code-reviewer, own briefs | as expected | harness-agents-surface "dispatches the test-writer, then the developer, then the code-reviewer, each from its own brief" |
| TC-004 | Unit | PASS | `TASK-NNN: no test-writer — <why>` and `No TDD:` rule | as expected | "skips the test-writer for a task with no unit or integration test case and ledgers why" |
| TC-005 | Unit | PASS | dispute route, Ruling, both stop conditions | as expected | "routes a developer's test dispute to the test-writer and stops on a contradicting test case or a repeat dispute" |
| TC-006 | Unit | PASS | fix loop split, five-round cap | as expected | "splits the fix loop between the developer and the test-writer under one five-round cap" |
| TC-007 | Unit | PASS | automation-writer in implement and test, evidence rows, MCP rule, second commit | as expected | "dispatches the automation-writer for UI tasks under the full level and commits its specs before the review"; "dispatches the automation-writer under the full level when the UI suite or a UI spec is missing"; "records the playwright rows with real exit codes and refuses a PASS on a non-zero row"; "limits the Playwright MCP to selector discovery, one agent at a time" |
| TC-008 | Unit | PASS | REQUIRED model line on each template; `## Model selection` heading kept | as expected | "names a required model on every seat template, pointing at the model selection section" |
| TC-009 | Unit | PASS | kf-run paragraphs verbatim; implementer-brief intact | as expected | "leaves the kf run worker paragraphs and the single-implementer brief as they were"; `git diff main -- src/harness skills/kanban-implement/references/implementer-brief.md` empty |
| TC-010 | Unit | PASS | no "(3|three) agents" on surfaces; six names in README, Pages, cli-reference | as expected | "states no count of three agents on any surface"; "names all six agents in the README, the Pages site and the CLI reference" |
| TC-011 | Unit | PASS | test-writer brief selection, fail-first, report path; no-subagent rule | as expected | "hands the test-writer only unit and integration cases and wants each test failing for the right reason"; "never lets a session without subagents fill the test-writer and developer seats itself" |
| TC-012 | Unit | PASS | developer brief inputs, never-edit, commit, report path | as expected | "hands the developer the failing tests, forbids editing them and has it commit the task"; "tells the developer about specs written before it and keeps them out of its task commit" |
| TC-013 | Unit | PASS | no "fresh implementer per task"; test-writer and developer named | as expected | "describes no single implementer in the in-session task loop" |
| TC-014 | Unit | PASS | Rulings for passing test, NEEDS_CONTEXT, mixed task split | as expected | "rules on a test that already passes, a case without an expected value and a mixed unit and UI task" |

## Repair coverage
The review 97d2a488 repair (testing-stage spec commit, dispatch paths, test-file hash check) is pinned by three new assertions in src/tests/harness-agents-surface.test.ts (21/21 pass); TC-007 and TC-012 evidence now includes them.

## Behaviour run (unchanged code path since dda3f5f: install.ts/args.ts untouched by the repair)

Stands in for TC-001/TC-002 through the real built CLI (temp git repo with `.works/`):

```
$ node dist/index.js install --scope project --agent claude
✓ Claude Code agents: code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer → <tmp>/.claude/agents/
exit=0
$ ls .claude/agents
automation-writer.md code-reviewer.md developer.md scout.md spec-reviewer.md test-writer.md
$ echo foreign > .claude/agents/mine.md; node dist/index.js uninstall --scope project --agent claude
✗ Claude Code: removed 6 agents from <tmp>/.claude/agents/
exit=0
$ ls .claude/agents
mine.md
$ node dist/index.js install -h | grep -o "6 kanban agents ([^)]*)"
6 kanban agents (code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer)
```

Changed behaviour no test touches: the skill prose is followed by a model at runtime — the surface tests pin the text, not an actual seat dispatch. A real run of the new seats happens on the next item driven in session (drive-retire). `kf doctor --fix` relinking six agents is covered only through the shared `MANAGED_AGENTS` loop (no six-specific test).

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npm run lint | 0 | clean |
| npm run typecheck | 0 | clean |
| npm run build | 0 | clean |
| npm test (vitest run --coverage, include install.ts, args.ts) | 0 | Test Files 81 passed (81); Tests 1207 passed (1207); All files 94.92% lines |
| node dist/index.js install --scope project --agent claude (temp repo) | 0 | six agent files created |
| node dist/index.js uninstall --scope project --agent claude (temp repo, foreign mine.md) | 0 | removed 6 agents; mine.md kept |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | - | - | - |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Changed source (src/integrations/install.ts, src/cli/args.ts), line coverage, full suite | 80% | 94.92% | coverage command above |
| Skill and doc prose | N/A | N/A | not code; pinned by 18 surface assertions in src/tests/harness-agents-surface.test.ts |

## Regression
Full suite 1207/1207 (1183 on main 592ecbf + 24 new; pins for the repairs: testing-stage spec commit, testing-stage dispatch paths, test-file hash check, re-hash after every test-writer change). Drive and worker tests (task-harness-surface, worker-prompt, drive*) unchanged and green.

## Conclusion
- PASS: all 14 planned unit cases pass, changed source coverage 94.92% ≥ 80%, real install/uninstall run matches TC-001/TC-002.

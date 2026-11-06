---
feature: researcher-agent
context: harness
created: 20261102_1044
status: archived
---
# Test Plan

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | researcher-agent |
| Context | harness |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), stubbed `claude` runner / stub binary on PATH; one live `claude -p --plugin-dir` probe (TC-020) |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 19 | 19 | surface checks of the agent, skills and docs; render; plugin runner; ownership |
| Integration | 8 | 8 | built CLI with a stub `claude`; temp-dir installs and migration; one live plugin probe |
| UI / E2E | 0 | 0 | none: a CLI with no UI; the live plugin probe is TC-020 (Integration) |
| **Total** | **27** | **27** | **all must pass** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-010, FR-011 | TC-001, TC-002, TC-003, TC-005, TC-006, TC-007, TC-020 | 7 | the researcher contract and the triggers hold, and the live dispatch works |
| UC-002 | FR-008, FR-010 | TC-008, TC-010 | 2 | the spike skill steps and the flow hand-off hold |
| UC-003 | FR-009 | TC-009 | 1 | the implement trigger and the Ruling line parse |
| UC-004 | FR-004, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016 | TC-004, TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-021, TC-022, TC-023, TC-024 | 14 | install, migration and docs behave on temp dirs with no data loss |
| UC-005 | FR-017 | TC-025, TC-026, TC-027 | 3 | the plan records the per-wave mode, the implement skill states the inline rules, and loop-stats parses an inline ledger |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001 | yes | - |
| FR-002 | UC-001 | TC-002 | yes | - |
| FR-003 | UC-001 | TC-003 | yes | - |
| FR-004 | UC-004 | TC-004 | yes | - |
| FR-005 | UC-001 | TC-005 | yes | - |
| FR-006 | UC-001 | TC-006 | yes | - |
| FR-007 | UC-001 | TC-007 | yes | - |
| FR-008 | UC-002 | TC-008 | yes | - |
| FR-009 | UC-003 | TC-009 | yes | - |
| FR-010 | UC-001, UC-002 | TC-010, TC-020 | yes | - |
| FR-011 | UC-001, UC-004 | TC-011, TC-020 | yes | - |
| FR-012 | UC-004 | TC-012 | yes | - |
| FR-013 | UC-004 | TC-013, TC-014, TC-015, TC-024 | yes | - |
| FR-014 | UC-004 | TC-016, TC-017, TC-022 | yes | - |
| FR-015 | UC-004 | TC-018, TC-021, TC-023 | yes | - |
| FR-016 | UC-004 | TC-019 | yes | - |
| FR-017 | UC-005 | TC-025, TC-026, TC-027 | yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `agents/researcher.md` exists |
| Input | the file |
| Steps | See steps table below |
| Expected outcome | `name: researcher`; tools exactly Read, Grep, Glob, WebSearch, WebFetch, Write (no Bash); modes `web`, `code`, `prior-art` each with a stop rule; no `spike` mode; `code` names scout for blast radius |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse the frontmatter and body | `name: researcher`; tools exactly Read, Grep, Glob, WebSearch, WebFetch, Write (no Bash); modes `web`, `code`, `prior-art` each with a stop rule; no `spike` mode; `code` names scout for blast radius |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `agents/researcher.md` exists |
| Input | the body |
| Steps | See steps table below |
| Expected outcome | states at most 40 lines, a confidence of high/medium/low, sources, separate verified/inferred/unverified lists, and the closing `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`; the body has at most 150 lines; `model: sonnet` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search for the reply contract and count the lines | states at most 40 lines, a confidence of high/medium/low, sources, separate verified/inferred/unverified lists, and the closing `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`; the body has at most 150 lines; `model: sonnet` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `agents/researcher.md` exists |
| Input | the body |
| Steps | See steps table below |
| Expected outcome | forbids editing tracked files, committing, writing git commands, spawning agents, deciding scope, running downloaded scripts; fetched content is untrusted data; `web`/`prior-art` stop with `BLOCKED` when no web tool is present |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search for the guardrails | forbids editing tracked files, committing, writing git commands, spawning agents, deciding scope, running downloaded scripts; fetched content is untrusted data; `web`/`prior-art` stop with `BLOCKED` when no web tool is present |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | `src/integrations/managed.ts` |
| Input | the module exports |
| Steps | See steps table below |
| Expected outcome | 10 bare skill names in the Global Constraints order; 7 agents including `researcher`; the 8 `kanban-*` legacy names; every name has a matching dir or file in the tree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Import `MANAGED_SKILLS`, `MANAGED_AGENTS`, `LEGACY_SKILLS` | 10 bare skill names in the Global Constraints order; 7 agents including `researcher`; the 8 `kanban-*` legacy names; every name has a matching dir or file in the tree |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `skills/flow/references/researcher-brief.md` |
| Input | the brief and the 4 dispatching skills |
| Steps | See steps table below |
| Expected outcome | the brief names mode, question, decision, time box, report path; the path is `<item>/reviews/research-<slug>.md` with an item, otherwise `$CLAUDE_JOB_DIR/tmp` or the OS temp dir; brainstorm, plan, implement and spike reference the brief |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the brief fields; grep each skill for the brief | the brief names mode, question, decision, time box, report path; the path is `<item>/reviews/research-<slug>.md` with an item, otherwise `$CLAUDE_JOB_DIR/tmp` or the OS temp dir; brainstorm, plan, implement and spike reference the brief |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-006 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/brainstorm/SKILL.md` |
| Input | section 1 |
| Steps | See steps table below |
| Expected outcome | dispatches `Agent(kf:researcher)` before asking the user when the idea names an external library/API/service/standard or prior art; no ask-first; the report is cited under Assumptions/Open Questions |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search for the trigger | dispatches `Agent(kf:researcher)` before asking the user when the idea names an external library/API/service/standard or prior art; no ask-first; the report is cited under Assumptions/Open Questions |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-007 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/plan/SKILL.md` |
| Input | the step table and the self-review |
| Steps | See steps table below |
| Expected outcome | a research row dispatches `Agent(kf:researcher)` (`web`/`prior-art`) in the same message as the scouts on a choice between approaches/libraries or an external dependency/API version; the approval summary names the choice and its sources; the self-review fails an unresearched choice |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search for the trigger and the failure rule | a research row dispatches `Agent(kf:researcher)` (`web`/`prior-art`) in the same message as the scouts on a choice between approaches/libraries or an external dependency/API version; the approval summary names the choice and its sources; the self-review fails an unresearched choice |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-008 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/spike/SKILL.md` and `skills/flow/SKILL.md` |
| Input | both skills |
| Steps | See steps table below |
| Expected outcome | the spike skill holds the 7 steps of FR-008 in order (no work item, start without a nod, researcher dispatch, temp-root scratch dir, explicit go for irreversible steps, report with commands, reclassify); the flow Spike row names `Skill(kf:spike)` and no longer has the inline procedure |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Check the 7 steps and the Spike row | the spike skill holds the 7 steps of FR-008 in order (no work item, start without a nod, researcher dispatch, temp-root scratch dir, explicit go for irreversible steps, report with commands, reclassify); the flow Spike row names `Skill(kf:spike)` and no longer has the inline procedure |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-009 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/implement/SKILL.md` and `kf loop-stats` |
| Input | section 3.2; a ledger fixture with a research `Ruling:` line |
| Steps | See steps table below |
| Expected outcome | 3.2 dispatches `Agent(kf:researcher)` for a NEEDS_CONTEXT/BLOCKED caused by missing outside knowledge, re-dispatches the same developer, and writes a `Ruling:` line citing the report; not a fix round; loop-stats parses the fixture with no error and an unchanged fix-round count |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search the trigger; run `kf loop-stats` on the fixture | 3.2 dispatches `Agent(kf:researcher)` for a NEEDS_CONTEXT/BLOCKED caused by missing outside knowledge, re-dispatches the same developer, and writes a `Ruling:` line citing the report; not a fix round; loop-stats parses the fixture with no error and an unchanged fix-round count |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-010 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | the plugin tree |
| Input | every `skills/**/*.md` and `agents/*.md` |
| Steps | See steps table below |
| Expected outcome | the flow table lists `Agent(kf:researcher)` at brainstorm, plan and implement plus a Spike row with `Skill(kf:spike)`; no `Agent(<name>)`, `Skill(<name>)` or `subagent_type: <name>` without the `kf:` prefix for a managed name |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Grep the named-line table; grep for agent dispatches without `kf:` | the flow table lists `Agent(kf:researcher)` at brainstorm, plan and implement plus a Spike row with `Skill(kf:spike)`; no `Agent(<name>)`, `Skill(<name>)` or `subagent_type: <name>` without the `kf:` prefix for a managed name |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-011 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | the repository root |
| Input | `.claude-plugin/*`, package.json, the tree |
| Steps | See steps table below |
| Expected outcome | plugin.json `name: kf`, version equal to package.json; marketplace.json plugin `kf` with source `./`; `files` includes `.claude-plugin` and `agents`; every `${CLAUDE_PLUGIN_ROOT}/...` path in the skills exists; no agent body contains `${CLAUDE_PLUGIN_ROOT}`; validate exits 0 (skipped with a stated reason when `claude` is absent) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse the manifests; check the version pin, `files`, every bundled path reference; run `claude plugin validate .` when `claude` is on PATH | plugin.json `name: kf`, version equal to package.json; marketplace.json plugin `kf` with source `./`; `files` includes `.claude-plugin` and `agents`; every `${CLAUDE_PLUGIN_ROOT}/...` path in the skills exists; no agent body contains `${CLAUDE_PLUGIN_ROOT}`; validate exits 0 (skipped with a stated reason when `claude` is absent) |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-012 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | a git checkout |
| Input | the tracked files |
| Steps | See steps table below |
| Expected outcome | Grep A matches only `LEGACY_SKILLS`/`LEGACY_SKILL_DIRS` in `src/integrations/managed.ts`, the migration tests that seed legacy names, and CHANGELOG.md. Grep B matches only those same files plus GitHub URLs `github.com/phuthuycoding/kanban-flow`. Any other match fails and is listed. The package dir `kanban-flow/(templates|review|github-hooks|hooks)`, `.kanban-flow-*.json`, `~/.config/kanban-flow`, `schema: "kanban-flow"` and the package name are not matched by either grep, so they stay without an allowlist. |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run two greps over the tracked files, excluding the history paths. Grep A: `git grep -nE "kanban-(brainstorm|plan|implement|test|review|archive|bug)\b"`. Grep B: `git grep -nE "/kanban-flow\b|Skill\(kanban-flow|skills/kanban-flow|kanban-flow skill|kanban-flow/(SKILL|agents|references)"` | every match is a product-name use, the legacy list in the migration code and its tests, or CHANGELOG; any other match fails and is listed |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-013 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | a stub runner |
| Input | `list --json` outputs: `[]`; current; stale readFromFolder; disabled |
| Steps | See steps table below |
| Expected outcome | missing: `marketplace add <PKG_ROOT>` then `install kf@kanban-flow --scope user|project`; current: only `list`; stale: `marketplace add <PKG_ROOT>` only; disabled: `enable kf --scope user|project`; the scope mapping is `global`→`user`, `project`→`project` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call `ensurePlugin('global')` and `ensurePlugin('project')` | missing: `marketplace add <PKG_ROOT>` then `install kf@kanban-flow --scope user|project`; current: only `list`; stale: `marketplace add <PKG_ROOT>` only; disabled: `enable kf`; the scope mapping is `global`→`user`, `project`→`project` |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-013 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | a stub runner |
| Input | `claude` absent (ENOENT); a non-zero exit with stderr; non-JSON `list` output |
| Steps | See steps table below |
| Expected outcome | each returns an error quoting the output and listing the manual `/plugin marketplace add` and `/plugin install` commands; never reported as installed; init prints it as a warning and finishes the rest of the bootstrap |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call `ensurePlugin`; call the init bootstrap | each returns an error quoting the output and listing the manual `/plugin marketplace add` and `/plugin install` commands; never reported as installed; init prints it as a warning and finishes the rest of the bootstrap |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-013 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | built CLI, temp project, stub `claude` on PATH logging its calls |
| Input | `kf install --agent claude`, run twice; `kf uninstall --agent claude`; `kf doctor`; `kf status` with a stale state |
| Steps | See steps table below |
| Expected outcome | the first install logs add + install, the second only `list`; uninstall logs `plugin uninstall kf` then `marketplace remove kanban-flow`; doctor reports missing/stale/disabled; status prints `⚠ kf plugin path is stale — run kf install`; nothing is written to `.claude/skills` or `.claude/agents` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each and read the stub log | the first install logs add + install, the second only `list`; uninstall logs `plugin uninstall kf` then `marketplace remove kanban-flow`; doctor reports missing/stale/disabled; status prints `⚠ kf plugin path is stale — run kf install`; nothing is written to `.claude/skills` or `.claude/agents` |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-014 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skill-render.ts` |
| Input | plugin-form text with each of the 5 patterns |
| Steps | See steps table below |
| Expected outcome | `Skill(kf:x)`→`Skill(kf-x)`; `/kf:x`→`kf-x`; `${CLAUDE_PLUGIN_ROOT}/skills/x`→`<root>/kf-x`; `${CLAUDE_PLUGIN_ROOT}/agents`→`<root>/kf-flow/agents`; `Agent(kf:a)`→ the paste instruction for `<root>/kf-flow/agents/a.md`; `${CLAUDE_PLUGIN_ROOT}/kanban-flow/review/rules`→`<PKG_ROOT>/kanban-flow/review/rules`; the output contains no `${CLAUDE_PLUGIN_ROOT}`; other text unchanged; idempotent on its own output; rendering every shipped skill leaves no `${CLAUDE_PLUGIN_ROOT}` and no `kf:` dispatch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call `renderForCopy(text, root)` | `Skill(kf:x)`→`Skill(kf-x)`; `/kf:x`→`kf-x`; `${CLAUDE_PLUGIN_ROOT}/skills/x`→`<root>/kf-x`; `${CLAUDE_PLUGIN_ROOT}/agents`→`<root>/kf-flow/agents`; `Agent(kf:a)`→ the paste instruction for `<root>/kf-flow/agents/a.md`; other text unchanged; idempotent on its own output |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-014 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | temp project and HOME |
| Input | `kf install --agent codex --agent gemini`; `kf install --agent kiro`; a foreign `.agents/skills/kf-plan` regular file |
| Steps | See steps table below |
| Expected outcome | one `kf-*` dir per `MANAGED_SKILLS` entry (10) written once into `.agents/skills` (rendered copies, not symlinks, each recorded in `.kanban-flow-skills.json`) with `kf-flow/agents/*.md` (7 files); kiro gets `.kiro/skills/kf-*`; the foreign `kf-plan` is kept and reported; the note lists the runtimes that read `.agents/skills`; global scope writes `~/.agents/skills` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run and inspect the dirs | 10 `kf-*` dirs written once into `.agents/skills` (rendered copies, not symlinks) with `kf-flow/agents/*.md` (7 files); kiro gets `.kiro/skills/kf-*`; the foreign `kf-plan` is kept and reported; the note lists the runtimes that read `.agents/skills`; global scope writes `~/.agents/skills` |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-015 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | temp project and HOME with: 8 `kanban-*` link/dirs, a kf-owned `travel`, 7 kf-owned loose agents, old `kanban-*` copies in `.gemini/skills`, `.cursor/skills`, `.opencode/skills`, `.devin/skills` and `~/.config/opencode/skills`, a foreign `review` skill, an unowned `travel` in the global dir |
| Input | `kf install`; then `kf doctor` on a re-seeded copy; then `kf doctor --fix` |
| Steps | See steps table below |
| Expected outcome | install removes every kf-owned legacy entry and lists it; the foreign `review` and the unowned `travel` are untouched and reported; doctor reports seeded leftovers; `--fix` removes them; `kf uninstall` removes the same set |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | install removes every kf-owned legacy entry and lists it; the foreign `review` and the unowned `travel` are untouched and reported; doctor reports seeded leftovers; `--fix` removes them; `kf uninstall` removes the same set |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-016 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | the built tree |
| Input | README.md, .github/pages/index.html, docs/workflow/*.md, docs/README.md, the args.ts help, the bootstrap AGENTS.md seed, autoconfig output |
| Steps | See steps table below |
| Expected outcome | each names `/kf:<name>` (or `kf-<name>` for copies) and the plugin install; counts say 10 skills and 7 agents; no "9 skills" or "6 agents" remains; the seed names `/kf:flow` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Grep each | each names `/kf:<name>` (or `kf-<name>` for copies) and the plugin install; counts say 10 skills and 7 agents; no "9 skills" or "6 agents" remains; the seed names `/kf:flow` |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-010, FR-011 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | a logged-in `claude` 2.1.316+ on the tester's machine; the built tree |
| Input | `claude -p --plugin-dir <root> --output-format stream-json --verbose "/kf:plan"` with a prompt that makes the skill dispatch `kf:researcher` in `code` mode on a one-line question |
| Steps | See steps table below |
| Expected outcome | the init event lists `kf:plan` and `kf:researcher`; the Agent call uses `subagent_type: kf:researcher` and returns a reply that ends with `STATUS:`; recorded in the testing result (the only test that spawns the real `claude`) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run once in testing; save the command and the output | the init event lists `kf:plan` and `kf:researcher`; the Agent call uses `subagent_type: kf:researcher` and returns a reply that ends with `STATUS:`; recorded in the testing result (the only test that spawns the real `claude`) |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-015 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | the existing legacy-cleanup fixtures (`kanban-ship`, `src/tests/fixtures/kanban-ship-0.13.0/`) |
| Input | the existing install-ownership and install tests |
| Steps | See steps table below |
| Expected outcome | the `kanban-ship` retirement still removes owned copies and keeps edited ones exactly as before (no regression) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run them after the change | the `kanban-ship` retirement still removes owned copies and keeps edited ones exactly as before (no regression) |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-014 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | `.agents/skills` installed for codex and gemini; the project config declares both |
| Input | `kf uninstall --agent codex` |
| Steps | See steps table below |
| Expected outcome | the shared `kf-*` copy stays because gemini still reads it; the output says so; `kf uninstall --agent codex --agent gemini` removes it |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run and inspect | the shared `kf-*` copy stays because gemini still reads it; the output says so; `kf uninstall --agent codex --agent gemini` removes it |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-015 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | user-owned bare-name dirs `test`, `plan`, `review` in `.claude/skills` and `~/.claude/skills` |
| Input | install, uninstall, removeLegacy and doctor --fix, at both scopes |
| Steps | See steps table below |
| Expected outcome | no bare-name entry is ever written, modified or deleted; doctor does not flag them |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each against temp dirs | no bare-name entry is ever written, modified or deleted; doctor does not flag them |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-013 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | built CLI, temp project with the claude agent configured, the plugin not installed |
| Input | `kf doctor --fix` with a stub `claude` on PATH; then `kf doctor --fix` with no `claude` on PATH |
| Steps | See steps table below |
| Expected outcome | with the stub, the log shows `marketplace add <PKG_ROOT>` then `install kf@kanban-flow`, and doctor re-checks healthy; without `claude`, doctor prints the manual `/plugin marketplace add` and `/plugin install` commands and exits non-zero |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf doctor --fix` with the stub, then without `claude` | the stub logs the add and install calls; without `claude`, the manual commands are printed and the exit code is non-zero |

## TC-025

| Field | Detail |
|---|---|
| Test case ID | TC-025 |
| Requirement reference | FR-017 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | the plan skill |
| Input | the skill text |
| Steps | See steps table below |
| Expected outcome | it names `kf tasks <f> --graph`, the `Execution: wave <w> inline` and `Execution: wave <w> parallel, <N> developers` lines with N = min(wave width, 4), and the approval summary stating them |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read `skills/plan/SKILL.md` | it names `kf tasks <f> --graph`, the `Execution: wave <w> inline` and `Execution: wave <w> parallel, <N> developers` lines with N = min(wave width, 4), and the approval summary stating them |

## TC-026

| Field | Detail |
|---|---|
| Test case ID | TC-026 |
| Requirement reference | FR-017 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | the implement skill and task-loop reference |
| Input | the skill text |
| Steps | See steps table below |
| Expected outcome | they state: the controller fills the developer seat in an inline wave with `Note TASK-NNN: developer seat inline`; test-writers ahead for the next 4 tasks; the code-reviewer stays an independent agent; N+1 is not committed before N's review is back; signature drift gets a `Ruling:` and test-writer re-dispatch; more than 5 inline tasks uses one resumed developer subagent |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read `skills/implement/SKILL.md` and `references/task-loop.md` | they state: the controller fills the developer seat in an inline wave with `Note TASK-NNN: developer seat inline`; test-writers ahead for the next 4 tasks; the code-reviewer stays an independent agent; N+1 is not committed before N's review is back; signature drift gets a `Ruling:` and test-writer re-dispatch; more than 5 inline tasks uses one resumed developer subagent |

## TC-027

| Field | Detail |
|---|---|
| Test case ID | TC-027 |
| Requirement reference | FR-017 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | a ledger with `developer dispatched`, `Note TASK-001: developer seat inline`, `developer done` and a clean review |
| Input | `kf loop-stats <f> --json` |
| Steps | See steps table below |
| Expected outcome | exit 0; the task's developer interval is counted; the Note line is not counted as unparsed |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf loop-stats` on a fixture ledger with an inline task | exit 0; the task's developer interval is counted; the Note line is not counted as unparsed |

---
feature: harness-agents
context: harness
created: 20261101_0858
kind: feature
status: archived
---
# Spec Requirement

## Feature
harness-agents

## Objective
Give the in-session task loop three dedicated agents — `test-writer`, `developer` and `automation-writer` — installed by `kf install` like the existing three, and make `kanban-implement` and `kanban-test` dispatch them. Tests are then written from the approved test cases by someone other than the person writing the code.

## Problem Statement
Today `kanban-implement` dispatches one `general-purpose` implementer per task (`skills/kanban-implement/references/implementer-brief.md`), and that implementer writes both the test and the code. Reviews in the last features kept catching tests whose expected values were shaped by the implementation, and tests named after plan/TC ids. The test author and the code author are the same context, so nothing independent stands between the test cases and the code.

The three agent bodies already exist on the local branch `phuthuycoding/harness-agents` (commit e601c8a, under `skills/kanban-flow/agents/`, with `MANAGED_AGENTS` in `src/integrations/install.ts` extended to six). No skill dispatches them yet, so they do nothing.

## Journey (what the user sees)
1. The user runs `kf install` (or the upgrade relinks). The output names 6 agents linked into `.claude/agents/`, not 3.
2. The user approves a plan. The session runs the task loop. For each task the transcript shows, in this order:
   - `Agent(test-writer)`, which writes failing tests from the task's Unit/Integration TCs;
   - `Agent(developer)`, which makes them pass without editing them and commits the task;
   - `Agent(code-reviewer)`, the task review as today.
   A task without Unit/Integration TCs (docs, config, glue) skips the test-writer, and its ledger line says why.
3. When the developer disputes a test, the ledger shows `TEST_DISPUTE` going back to the test-writer, not a quietly edited test.
4. Under `Level: full`, a task whose TCs include UI/E2E types shows `Agent(automation-writer)`. `kanban-test` also dispatches it when a UI TC has no spec.
5. `kf drive` / `kf run --task` behave exactly as today.

## Scope
### In Scope
- Land the three agent bodies (developer, test-writer, automation-writer) and the six-agent install from the existing branch, rebased onto current main.
- `kanban-implement` task loop (section 3): the per-task order test-writer → developer → code-reviewer. This covers the brief files the controller writes for each seat, the skip rule for tasks with no Unit/Integration TCs, `TEST_DISPUTE` routing, the fix-loop seat (fix rounds go to the developer, test fixes go to the test-writer), the ledger lines, and model selection.
- `kanban-implement` references: new dispatch templates for the three seats beside `implementer-brief.md`, plus `task-loop.md`, `task-reviewer-brief.md` and `re-review-brief.md` where they name "the implementer" of the in-session loop. `implementer-brief.md` itself stays unchanged: the headless task worker (`SKILL.md` "Task worker") follows its TDD and self-review rules.
- `kanban-test` section 2: dispatch `automation-writer` under `Level: full` when the UI/E2E suite is missing or a UI TC has no spec.
- The kanban-flow spine skill and `references/harness-tools.md`: the named-line table and agent list grow to six.
- Docs that list the agents or describe the task loop (see Affected surfaces).

### Out of Scope
- Any change to `kf drive`, `kf run --task` and the task worker section of `kanban-implement` (`kf-run:<id> TASK-###`). The headless path keeps one worker per task — because removing or reshaping the drive supervisor is a separate feature (agreed 2026-11-01).
- Removing the `kf drive` supervisor or rewriting `travel` as an in-session pool — separate follow-up feature.
- New `kf` commands (`kf task start/finish`, `kf verify`) — belong to the drive follow-up.
- Running Playwright against this repository: kanban-flow is a CLI with no UI.
- Unifying `harness.roles` runner configs with the agent files.

## Affected surfaces
- `kf install -h` / `kf uninstall -h` help text in `src/cli/args.ts` — 3 → 6 agents, named.
- `README.md` — the agent list ("kanban agents the skills dispatch by name") and the task-loop description.
- `.github/pages/index.html` — the install demo line "3 agents → .claude/agents/".
- `docs/workflow/cli-reference.md` — `kf install` / `kf uninstall` entries.
- `docs/workflow/skills.md`, `docs/workflow/harness.md`, `docs/workflow/autoconfig.md` — agent lists and the task loop.
- `docs/workflow/cli-reference.md` `kf doctor --fix` line (agents it relinks) and `.github/pages/index.html` agent list (~line 221).
- Skills: `skills/kanban-flow/SKILL.md` (incl. the agents paragraph ~line 110), `skills/kanban-flow/references/harness-tools.md`, `skills/kanban-implement/SKILL.md` + references, `skills/kanban-test/SKILL.md`.

## Actors
- Human operator — installs, approves the plan, reads the ledger.
- Controller session — runs kanban-implement / kanban-test and dispatches the seats.
- `test-writer`, `developer`, `automation-writer`, `code-reviewer` — in-session subagents with fresh context.

## Functional Requirements
### FR-001
- Requirement: `kf install` installs six managed agents — code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer — into the agents dir of runtimes that have one. `kf uninstall` removes exactly those six and keeps foreign agent files.
- Priority: must
- Notes: already on e601c8a; this feature lands it with tests and help text.

### FR-002
- Requirement: In the in-session task loop, a task whose served TCs include `Unit` or `Integration` types (or a bug's regression scope) gets `Agent(test-writer)` before any production code. The test-writer works from a brief file that carries those TC blocks. Its report proves each new test fails for the right reason before the developer is dispatched.
- Priority: must

### FR-003
- Requirement: The production code of each task is written by `Agent(developer)`, from a brief that carries the test-writer's test files and their failing output. The developer never edits those test files and commits the task.
- Priority: must
- Notes: the `developer` agent body replaces the `general-purpose` + `implementer-brief.md` dispatch in the in-session loop only.

### FR-004
- Requirement: A task with no Unit/Integration TC (docs, config, glue) skips the test-writer. The controller writes `TASK-NNN: no test-writer — <why>` in the ledger, and the developer's report carries the `No TDD: <why>` line with real-run output, as today.
- Priority: must

### FR-005
- Requirement: A developer reply with a `TEST_DISPUTE: <file:line> <why>` line sends the controller to the test-writer with that line. The test-writer either fixes the test against the TC or keeps it and quotes the TC. If the test-writer keeps it, the controller records a `Ruling:` that the TC is binding and resumes the developer with it. If the developer's reason is that the TC contradicts an FR or another TC (not the code), the controller stops and reports it to the human as a plan or requirement problem instead of ruling. A second dispute on the same test after a Ruling is also a stop. Every step is ledgered.
- Priority: must

### FR-006
- Requirement: In the fix loop, code findings go to the developer, as the implementer's rounds work today (rounds 1–3 resume, rounds 4–5 a fresh developer one tier up). Findings about a test go to the test-writer. A round counts the same either way, with five rounds maximum per task.
- Priority: must

### FR-007
- Requirement: Under `Level: full`, kanban-implement dispatches `Agent(automation-writer)` for a task whose TCs include `UI` or `E2E` types. It runs after the developer has built the screen, or before when the plan fixes a `data-testid` contract. kanban-test section 2 dispatches it when the UI/E2E suite is missing or a UI TC has no spec, and the testing report's `Commands and Evidence` table carries its `npx playwright test` rows. The Playwright MCP is used for selector discovery only, by one agent at a time; the evidence is the headless run.
- Priority: must

### FR-008
- Requirement: `kf drive`, `kf run --task`, the stage-worker and task-worker sections of `kanban-implement` (`kf-run:` prompts) and `references/implementer-brief.md` behave exactly as before: no file under `src/harness/` (including `src/harness/drive.ts` and `src/harness/drive/`) changes, those skill sections and that file are byte-identical, and the existing drive tests pass unchanged.
- Priority: must

### FR-010
- Requirement: Model selection follows `references/task-loop.md` § Model selection for every seat: `sonnet` by default for test-writer, developer and automation-writer; `opus` for a developer on multi-file coordination or design judgement, or when the same test fails twice; fix rounds 4–5 one tier up. Each dispatch names its model.
- Priority: should

### FR-009
- Requirement: Every surface in Affected surfaces names six agents and describes the test-writer → developer → code-reviewer task order. No document still says "3 agents" or describes a single implementer writing the tests in the in-session loop.
- Priority: should

## Non-Functional Requirements
- Agent bodies, skills and docs are English only. They never name the external kit this design was borrowed from. The existing `open-source-surface.test.ts` English check covers the agent files.
- One task costs at most one extra dispatch per test type it carries over today: the test-writer for Unit/Integration TCs, the automation-writer for UI/E2E TCs under `Level: full`. A task with neither gets no new seat.
- Runtimes without an agent registry keep working: the skills say to paste the agent body into a general-purpose subagent, as for code-reviewer today.

## Main Use Cases
- UC-001 Install the six agents
- UC-002 Run one task through test-writer → developer → code-reviewer
- UC-003 Resolve a test dispute
- UC-004 Cover UI test cases with automation-writer

## Constraints
- The existing branch `phuthuycoding/harness-agents` (e601c8a, based on b7e9e71) is the item branch. The worktree provisioning reuses an existing branch, and it must be rebased onto current main before work starts.
- Skills are installed globally by symlink. A skill edit is live in every project as soon as the primary checkout's main moves, so the wiring lands only through the reviewed PR.
- Tests never carry plan/TASK/TC ids in names.

## Assumptions
- "Unit/Integration TC" means the `Test type` field of a `## TC-###` block in `phase-2-test-case.md` (`Unit`, `Integration`, `UI`, `E2E`).
- The test-writer and the developer both write inside the task's single Files allowlist. The plan already lists test files there, and no new allowlist split is added.
- The developer commits the task (test files + code) as one commit. The test-writer never commits.

## Acceptance Criteria
- [ ] `kf install --scope project` in a temp project prints six agents and creates the six `.md` files; `kf uninstall` removes them and keeps a foreign `mine.md`.
- [ ] `skills/kanban-implement/SKILL.md` section 3 dispatches test-writer, developer and code-reviewer in that order, and states the skip rule and the `TEST_DISPUTE` route.
- [ ] The kanban-implement references hold a dispatch template for each of the three seats, and none of them tells the in-session developer to write its own tests for a task that had a test-writer.
- [ ] `skills/kanban-test/SKILL.md` section 2 names `Agent(automation-writer)` under `Level: full`.
- [ ] `kf install -h`, README, the Pages site and `docs/workflow/*` name six agents; `grep -rniE "(3|three) (kanban )?agents"` over README.md, docs/workflow/, .github/pages/, skills/ and src/cli/args.ts returns nothing.
- [ ] kanban-implement says a task with no Unit/Integration TC gets the ledger line `TASK-NNN: no test-writer — <why>` and no test-writer dispatch.
- [ ] kanban-implement states the dispute route: test-writer fixes or keeps; kept → `Ruling:` and developer resumed; TC-vs-FR contradiction or a second dispute → stop to the human.
- [ ] kanban-implement's fix loop sends code findings to the developer (rounds 1–3 resume, 4–5 fresh one tier up) and test findings to the test-writer, within five rounds.
- [ ] kanban-implement dispatches automation-writer for a UI/E2E task under `Level: full` (after the developer, or before with a `data-testid` contract); kanban-test's report table carries its command rows; both state the MCP-for-selectors-only rule.
- [ ] Every new dispatch template names a model per FR-010.
- [ ] `git diff main -- src/harness skills/kanban-implement/references/implementer-brief.md` is empty, and the kf-run worker paragraphs of kanban-implement are unchanged.
- [ ] The full suite passes.

## Edge Cases
- A task with mixed TC types (Unit + UI): the test-writer covers the Unit TCs and the automation-writer covers the UI ones. Neither touches the other's files.
- The test-writer's test already passes before implementation, so the behaviour already exists. The controller rules on it before dispatching the developer.
- The test-writer reports `NEEDS_CONTEXT` because a TC has no concrete expected value. That is a plan defect: the controller rules on it or stops, and it never lets the developer invent the value.
- A test dispute recurs on the same test after the test-writer kept it. That is a Ruling and a stop, not a loop.
- A bug item has a regression scope instead of TCs. The test-writer writes the regression test from the bug report's reproduction.
- A runtime has no subagent tool. The existing "review seat: none" rule extends to the test-writer seat: the session never writes both sides itself and claims independence.

## Open Questions
- None.

## Test Strategy
- Level: unit
- UI Tests: none
- Tools: vitest (`npm test`, `src/tests/*.test.ts`)
- Coverage Target: 80%

---
feature: harness-agents
context: harness
created: 20261101_0917
status: archived
---
# Test Plan

> **Partly superseded by `drive-retire`:** the statements that `kf drive`, `kf run --task`, `harness.roles` and the `kf-run:` worker paragraphs of `kanban-implement` stay unchanged no longer hold — all are removed; the in-session loop is the only path. Kept for history.

> **Partly superseded by the workflow review fixes (2026-11-02):** `skills/implement/references/implementer-brief.md` is deleted — its only consumer, the removed `kf run` task worker, is gone; the developer brief is the single implementer dispatch. Kept for history.

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | harness-agents |
| Context | harness |
| Test level | unit |
| UI scope | none |
| Tools / commands | vitest — `npm test` (`src/tests/install-agents.test.ts`, `src/tests/harness-agents-surface.test.ts`) |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 14 | 14 | install plumbing and skill/doc surface text |
| Integration | 0 | 0 | none — Test Level is unit; install runs through cmdInstall in unit tests |
| UI / E2E | 0 | 0 | none — CLI with no UI |
| **Total** | **14** | **14** | **all unit** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-009 | TC-001, TC-002, TC-010 | 3 | all pass |
| UC-002 | FR-002, FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-010 | TC-003, TC-004, TC-006, TC-008, TC-009, TC-011, TC-012, TC-013, TC-014 | 9 | all pass |
| UC-003 | FR-005 | TC-005 | 1 | all pass |
| UC-004 | FR-007 | TC-007 | 1 | all pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002 | yes | - |
| FR-002 | UC-002 | TC-003, TC-011, TC-014 | yes | - |
| FR-003 | UC-002 | TC-003, TC-012 | yes | - |
| FR-004 | UC-002 | TC-004 | yes | - |
| FR-005 | UC-003 | TC-005 | yes | - |
| FR-006 | UC-002 | TC-006 | yes | - |
| FR-007 | UC-002, UC-004 | TC-007, TC-014 | yes | - |
| FR-008 | UC-002 | TC-009 | yes | - |
| FR-009 | UC-001, UC-002 | TC-010, TC-013 | yes | - |
| FR-010 | UC-002 | TC-008 | yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Temp project dir; package agents dir with six bodies |
| Input | `cmdInstall` then `cmdUninstall` at project scope, plus a foreign `mine.md` |
| Steps | See steps table below |
| Expected outcome | After install `.claude/agents/` holds code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer `.md`; after uninstall the six are gone, `mine.md` remains, stdout reports the removed count |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run project-scope install | six agent files exist |
| 2 | Add `mine.md`, run uninstall | six removed, `mine.md` kept |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | CLI help registry |
| Input | `kf install -h`, `kf uninstall -h` help strings |
| Steps | See steps table below |
| Expected outcome | Both help strings say `6 kanban agents` and name developer, test-writer, automation-writer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the install help string | contains the six names |
| 2 | Read the uninstall help string | says 6 kanban agents |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002, FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/kanban-implement/SKILL.md` section 3 |
| Input | Section 3 text |
| Steps | See steps table below |
| Expected outcome | `Agent(test-writer)` appears before `Agent(developer)`, which appears before `Agent(code-reviewer)`; the section names `references/test-writer-brief.md` and `references/developer-brief.md` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Slice section 3 | found |
| 2 | Compare positions of the three dispatch names | test-writer < developer < code-reviewer |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | kanban-implement section 3 |
| Input | Section 3 text |
| Steps | See steps table below |
| Expected outcome | Contains the ledger line `TASK-NNN: no test-writer — <why>` and the `No TDD: <why>` rule for tasks with no Unit or Integration TC |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search section 3 | both literals present |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | kanban-implement section 3 |
| Input | Section 3 text |
| Steps | See steps table below |
| Expected outcome | Names `TEST_DISPUTE`; routes it to the test-writer; a kept test gets a `Ruling:` and the developer resumed; a TC that contradicts an FR or another TC, and a second dispute on the same test, stop to the human |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search the dispute paragraph | route, Ruling and both stop conditions present |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | kanban-implement section 3.4 |
| Input | Fix-loop text |
| Steps | See steps table below |
| Expected outcome | Code findings go to the developer (rounds 1–3 resume, 4–5 fresh one tier up); findings about a test go to the test-writer; five rounds maximum per task |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Slice the fix-loop subsection | both seats named with the round split and the five-round cap |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-007 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | kanban-implement section 3, kanban-test section 2, `references/automation-writer-brief.md` |
| Input | Skill and brief text |
| Steps | See steps table below |
| Expected outcome | kanban-implement dispatches `Agent(automation-writer)` for UI/E2E TCs under `Level: full` (after the developer, or before with a `data-testid` contract); kanban-test section 2 names `Agent(automation-writer)` and `Commands and Evidence`; both say the Playwright MCP is for selector discovery only, one agent at a time; kanban-implement says the developer is resumed to commit the automation-writer's spec files unchanged as a second commit of the task, before the code-reviewer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search kanban-implement | dispatch, ordering and data-testid rule present |
| 2 | Search kanban-test section 2 | dispatch, evidence table and MCP rule present |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-010 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | The three seat templates and `task-loop.md` |
| Input | Template text |
| Steps | See steps table below |
| Expected outcome | Each template has a REQUIRED `model:` placeholder pointing at `task-loop.md` § Model selection, stating sonnet by default and opus for multi-file or design judgement or a test failing twice; `task-loop.md` still has the `## Model selection` heading |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read each template | model line present |
| 2 | Read task-loop.md | heading present |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-008 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | kanban-implement SKILL.md and `references/implementer-brief.md` on the item branch |
| Input | The two `kf-run:` paragraphs and implementer-brief.md |
| Steps | See steps table below |
| Expected outcome | The stage-worker and task-worker paragraphs equal their main text verbatim, and implementer-brief.md still holds its dispatch (`subagent_type: general-purpose`, `TDD is mandatory`) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compare the two paragraphs with the pinned text | identical |
| 2 | Read implementer-brief.md | both literals present |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-009 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | README.md, .github/pages/index.html, docs/workflow/, skills/, src/cli/args.ts |
| Input | Their text |
| Steps | See steps table below |
| Expected outcome | After collapsing whitespace and stripping `**`, no case-insensitive match for `(3|three) (kanban )?(agents|agent definitions|agent bodies|subagents)` in any of them; README, the Pages site and cli-reference name developer, test-writer and automation-writer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Scan the surfaces | no stale count |
| 2 | Search README, Pages, cli-reference | all six names present |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | `references/test-writer-brief.md` and the test-writer agent body |
| Input | Brief and body text |
| Steps | See steps table below |
| Expected outcome | The brief passes the TC blocks whose Test type is Unit or Integration (or a bug's reproduction and regression scope), requires each test to fail for the right reason before the developer is dispatched, and names the report path `task-NNN-tests-report.md` that the agent body names; kanban-implement says a runtime with no subagent tool never fills the test-writer and developer seats in one session |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the brief | TC selection, fail-first rule and report path present |
| 2 | Read the agent body | same report path |
| 3 | Search section 3 | no-subagent rule covers the test-writer seat |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | `references/developer-brief.md` and the developer agent body |
| Input | Brief and body text |
| Steps | See steps table below |
| Expected outcome | The brief passes the test-writer's files and failing output, forbids editing them, says the developer commits the task, and names the report path `task-NNN-report.md` that the agent body names |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the brief | inputs, never-edit rule and commit rule present |
| 2 | Read the agent body | same report path |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-009 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | README.md, docs/workflow/skills.md, docs/workflow/lifecycle.md, skills/kanban-flow/SKILL.md |
| Input | Their text |
| Steps | See steps table below |
| Expected outcome | None says "fresh implementer per task" (whitespace-normalised, case-insensitive); each names test-writer and developer for the in-session task loop |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Scan the four files | no single-implementer wording |
| 2 | Search the four files | test-writer and developer named |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-002, FR-007 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | kanban-implement section 3 |
| Input | Section 3 text |
| Steps | See steps table below |
| Expected outcome | Section 3 says a test that passes before implementation gets a `Ruling:` before the developer is dispatched; a test-writer `NEEDS_CONTEXT` for a TC without an expected value is ruled on or stopped and never handed to the developer; for a task with both Unit and UI TCs the Unit TCs go to the test-writer and the UI TCs to the automation-writer, neither editing the other's files |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Search section 3 | the three rules present |

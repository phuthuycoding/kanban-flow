---
feature: "affected-surfaces"
context: "cli"
created: "20261012_1935"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | affected-surfaces |
| Context | cli |
| Test level | unit |
| UI scope | none |
| Tools / commands | `npx vitest run src/tests/affected-surfaces.test.ts`, `npm test` |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 10 | 10 | gate, helper, coverage warning, immunities |
| Integration | 0 | 0 | covered by unit through `validateFeature`/`cmdStage` |
| UI / E2E | 0 | 0 | no UI surface |
| **Total** | **10** | **10** | **all unit** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-001…004 | 4 | missing/placeholder/comment/empty all refuse at brainstorm |
| UC-002 | FR-004, FR-005 | TC-005…006 | 2 | template + skills teach the convention |
| UC-003 | FR-003 | TC-007…008 | 2 | warn on uncovered, silent on covered |
| UC-004 | FR-002 | TC-009…010 | 2 | N/A passes; bug/legacy immune |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-005 | yes | template ships the section |
| FR-002 | UC-001, UC-004 | TC-001…004, TC-009…010 | yes | gate + N/A |
| FR-003 | UC-003 | TC-007…008 | yes | warn semantics |
| FR-004 | UC-002 | TC-005 | yes | plan template line |
| FR-005 | UC-002 | TC-006 | yes | skills/docs updated |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | feature spec in brainstorm WITHOUT `## Affected surfaces` heading |
| Input | `cmdStage(f, "planning")` / `validateFeature(f)` |
| Steps | See steps table below |
| Expected outcome | ERROR `affected_surfaces_missing`, gate_blocked, exit 1, no move |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | seed brainstorm item with spec lacking the section; run validate/stage | refusal finding, no transition |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | spec has heading but body is `{affected_surfaces}` / template comment-only / whitespace-only |
| Input | validate + stage to planning |
| Steps | three variants |
| Expected outcome | each variant → ERROR (placeholder via isFilledFile; comment/empty via new check) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `{affected_surfaces}` body → validate | gate_blocked |
| 2 | comment-only body → validate | `affected_surfaces_missing` |
| 3 | empty body → validate | `affected_surfaces_missing` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | spec with real `## Affected surfaces` bullets |
| Input | `cmdStage(f, "planning")` |
| Steps | stage the item |
| Expected outcome | transition succeeds (no surfaces finding) |
| Status | PENDING |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | item in `implementation` (or later) stage with spec lacking the section |
| Input | `validateFeature(f)` |
| Steps | validate a non-brainstorm legacy item |
| Expected outcome | no `affected_surfaces_missing` — check is brainstorm-scoped |
| Status | PENDING |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-001, FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | packaged templates on disk |
| Input | read `phase-1-spec-requirement.md`, `phase-2-implementation-plan.md` templates |
| Steps | inspect both |
| Expected outcome | spec template contains `## Affected surfaces` + `{affected_surfaces}`; plan template documents surface→task/doc-impact convention |
| Status | PENDING |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-005 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | skills + docs on disk |
| Input | grep `skills/kanban-brainstorm`, `kanban-plan`, `docs/workflow/gates.md`, `cli-reference.md`, `CHANGELOG.md` |
| Steps | verify each file mentions the contract |
| Expected outcome | all teach affected-surfaces; changelog has an entry |
| Status | PENDING |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | planning-stage item; spec declares "docs site" + "README"; plan mentions README only |
| Input | `validateFeature(f)` |
| Steps | validate |
| Expected outcome | WARNING `affected_surface_uncovered` for "docs site" only; not blocking |
| Status | PENDING |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | same item, plan covers both surfaces |
| Input | `validateFeature(f)` |
| Steps | validate |
| Expected outcome | zero `affected_surface_uncovered` warnings |
| Status | PENDING |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-002 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | spec body `## Affected surfaces` → `N/A` (plus `n/a`, `N/A.` variants) |
| Input | validate + stage to planning |
| Steps | gate + coverage check |
| Expected outcome | gate passes; zero coverage warnings |
| Status | PENDING |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-002, FR-003 |
| Use case reference | UC-001, UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `kind: bug` brainstorm item without the section; and spec with `N/A` + real bullets |
| Input | `validateFeature` on both |
| Steps | bug item; mixed section |
| Expected outcome | bug item: no surfaces finding ever. Mixed section: gate passes, coverage applies to named bullets only (N/A line not a surface) |
| Status | PENDING |

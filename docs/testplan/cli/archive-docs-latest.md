---
feature: archive-docs-latest
context: cli
created: 20261013_1513
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | archive-docs-latest |
| Context | cli |
| Test level | unit |
| UI scope | none |
| Tools / commands | vitest — `npm test` (`src/tests/archive-docs.test.ts`) |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 9 | 9 | CLI archive behavior + skill/template/repo docs content |
| Integration | 0 | 0 | No external system involved |
| UI / E2E | 0 | 0 | CLI has no UI |
| **Total** | **9** | **9** | **unit only, as agreed** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-007 | TC-001, TC-002, TC-003, TC-009 | 4 | All stamped / unchanged as specified |
| UC-002 | FR-003 | TC-004, TC-005, TC-006 | 3 | Idempotent, edits detected, legacy upgraded |
| UC-003 | FR-004, FR-005, FR-006, FR-007 | TC-007, TC-008, TC-009 | 3 | Skill, template and banners present |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002 | Yes | — |
| FR-002 | UC-001 | TC-003 | Yes | — |
| FR-003 | UC-002 | TC-004, TC-005, TC-006 | Yes | — |
| FR-004 | UC-003 | TC-007 | Yes | Content check; reconcile judgment verified at review |
| FR-005 | UC-003 | TC-008 | Yes | — |
| FR-006 | UC-003 | TC-007 | Yes | — |
| FR-007 | UC-001, UC-003 | TC-009 | Yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Feature in review with PASS reports; artifacts with frontmatter |
| Input | `kf archive demo` |
| Steps | See steps table below |
| Expected outcome | Canonical UC index, UC file, diagram, test plan contain `status: archived`; result contains `status: PASS` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Feature in review with PASS reports; artifacts with frontmatter | Fixture ready |
| 2 | Run: `kf archive demo` | Command completes |
| 3 | Assert outcome | Canonical UC index, UC file, diagram, test plan contain `status: archived`; result contains `status: PASS` |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | UC file source without frontmatter |
| Input | `kf archive demo` |
| Steps | See steps table below |
| Expected outcome | Canonical UC file equals the source byte for byte |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: UC file source without frontmatter | Fixture ready |
| 2 | Run: `kf archive demo` | Command completes |
| 3 | Assert outcome | Canonical UC file equals the source byte for byte |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | UC index with two `planned` rows and a coverage table |
| Input | `kf archive demo` |
| Steps | See steps table below |
| Expected outcome | Use Case Files rows read `implemented`; coverage table identical to source |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: UC index with two `planned` rows and a coverage table | Fixture ready |
| 2 | Run: `kf archive demo` | Command completes |
| 3 | Assert outcome | Use Case Files rows read `implemented`; coverage table identical to source |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item archived with stamped docs |
| Input | `kf archive demo` again |
| Steps | See steps table below |
| Expected outcome | Exit 0, no `canonical docs changed`, no bypass recorded |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Item archived with stamped docs | Fixture ready |
| 2 | Run: `kf archive demo` again | Command completes |
| 3 | Assert outcome | Exit 0, no `canonical docs changed`, no bypass recorded |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item in dones; canonical UC file body hand-edited |
| Input | `kf archive demo` again |
| Steps | See steps table below |
| Expected outcome | Exit 1 `canonical docs changed`; doc keeps the edit |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Item in dones; canonical UC file body hand-edited | Fixture ready |
| 2 | Run: `kf archive demo` again | Command completes |
| 3 | Assert outcome | Exit 1 `canonical docs changed`; doc keeps the edit |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item in dones; canonical docs replaced by unstamped `status: planning` copies of the sources |
| Input | `kf archive demo` again |
| Steps | See steps table below |
| Expected outcome | Exit 0, no bypass; docs now `status: archived` and `implemented` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Item in dones; canonical docs replaced by unstamped `status: planning` copies of the sources | Fixture ready |
| 2 | Run: `kf archive demo` again | Command completes |
| 3 | Assert outcome | Exit 0, no bypass; docs now `status: archived` and `implemented` |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-004, FR-006 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository skill files |
| Input | Read `skills/kanban-archive/SKILL.md` |
| Steps | See steps table below |
| Expected outcome | Contains the reconcile step, links `reconcile.md` which exists, Git handoff names `docs({context}): sync canonical docs for {feature}` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Repository skill files | Fixture ready |
| 2 | Run: Read `skills/kanban-archive/SKILL.md` | Command completes |
| 3 | Assert outcome | Contains the reconcile step, links `reconcile.md` which exists, Git handoff names `docs({context}): sync canonical docs for {feature}` |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository template |
| Input | Read `kanban-flow/templates/phase-6-feature-report.md` |
| Steps | See steps table below |
| Expected outcome | Contains `## Docs Reconciled` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Repository template | Fixture ready |
| 2 | Run: Read `kanban-flow/templates/phase-6-feature-report.md` | Command completes |
| 3 | Assert outcome | Contains `## Docs Reconciled` |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-007 |
| Use case reference | UC-001, UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository canonical docs after backfill |
| Input | Scan `docs/use-cases/*/*/*.md` and `docs/testplan/*/*.md` |
| Steps | See steps table below |
| Expected outcome | No file has `status: planning`; done-trigger UC-001 contains `Superseded by archive-after-merge` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prepare: Repository canonical docs after backfill | Fixture ready |
| 2 | Run: Scan `docs/use-cases/*/*/*.md` and `docs/testplan/*/*.md` | Command completes |
| 3 | Assert outcome | No file has `status: planning`; done-trigger UC-001 contains `Superseded by archive-after-merge` |


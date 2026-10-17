---
feature: command-tree
context: cli
created: 20261017_1750
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | command-tree |
| Context | cli |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`src/tests`); `args.test.ts` rewritten for the tree |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 3 | 3 | resolution, alias map, help queries |
| Integration | 3 | 3 | end-to-end invocations incl. equivalence + kind check |
| UI / E2E | 0 | 0 | no UI |
| **Total** | **6** | **6** | **dispatch coverage** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002 | 2 | resolution + verb equivalence |
| UC-002 | FR-003, FR-005 | TC-003 | 1 | alias equivalence table |
| UC-003 | FR-004 | TC-004 | 1 | help at all depths |
| UC-004 | FR-002 | TC-005 | 1 | kind-mismatch refusal |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001 | yes | — |
| FR-002 | UC-001, UC-004 | TC-002, TC-005 | yes | — |
| FR-003 | UC-002 | TC-003 | yes | — |
| FR-004 | UC-003 | TC-004 | yes | — |
| FR-005 | UC-002 | TC-003 | yes | — |
| FR-006 | — | TC-006 | yes | doc-consistency check (skills cite only resolvable spellings) |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | tree registry built |
| Input | argv variants: `feature start x`, `stage x implementation`, `feature wat`, `feat` |
| Steps | See steps table below |
| Expected outcome | longest-path resolve; leaf spec drives parse; unknown/ambiguous refuse correctly |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | resolve `["feature","start","x"]` | leaf `feature/start` |
| 2 | resolve `["stage","x","implementation"]` | alias → `feature/move` |
| 3 | resolve `["feature","wat"]` | error + `feature` verb list |
| 4 | resolve `["feat"]` | ambiguous refuse |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project |
| Input | `kf feature start <ctx> <name>` vs `kf new <name> -c <ctx>`; `kf bug start` |
| Steps | See steps table below |
| Expected outcome | identical item created; bug noun yields `kind: bug` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `feature start` | same `.works/brainstorm/<name>_<ts>` + meta as `new` |
| 2 | `bug start` | `kind: bug` without `--type` flag |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-003, FR-005 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project; table of legacy spellings + expected `CmdResult` |
| Input | each legacy command vs canonical path |
| Steps | See steps table below |
| Expected outcome | identical `code`/`stdout`/`stderr` semantics per row |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run legacy spelling | result A |
| 2 | run canonical equivalent | result B ≡ A |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | tree built |
| Input | `kf help`, `kf help feature`, `kf help feature move`, `kf feature move --help`, `kf help <alias>` |
| Steps | See steps table below |
| Expected outcome | grouped tree; per-node help; alias help names canonical path |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | top-level help | noun groups + verbs |
| 2 | `help feature move` / `--help` | leaf usage |
| 3 | `help stage` | canonical `feature move` usage |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | scratch project with a feature-kind and a bug-kind item |
| Input | `kf bug finish <feature>`, `kf feature finish <bug>`, matching-kind controls |
| Steps | See steps table below |
| Expected outcome | mismatches refuse before handler; matches pass through |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | wrong noun | refusal naming the right noun |
| 2 | right noun | handler runs |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Low |
| Preconditions | skills + AGENTS.md text updated |
| Input | grep-extracted `kf …` spellings from skill docs |
| Steps | See steps table below |
| Expected outcome | every cited spelling resolves in the tree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | scan skill/AGENTS text for `kf` invocations | all resolve (canonical or alias) |

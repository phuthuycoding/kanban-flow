---
feature: ship-pipeline
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
| Feature | ship-pipeline |
| Context | cli |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`src/tests`); stubbed `gh` binary pattern from existing github/ade test doubles |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 3 | 3 | schema + config parsing |
| Integration | 6 | 6 | stage/dispatch/ship/archive/sync against stubbed gh + scratch repos |
| UI / E2E | 0 | 0 | no UI |
| **Total** | **9** | **9** | **pipeline coverage** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002, TC-003 | 3 | stage + PASS gate |
| UC-002 | FR-005 | TC-005 | 1 | publish + record + idempotent |
| UC-003 | FR-006, FR-008 | TC-006, TC-007 | 2 | wait/resume + overrides |
| UC-004 | FR-007, FR-008 | TC-007 | 1 | release/changelog stamped |
| UC-005 | FR-003 | TC-008 | 1 | archive from shipping |
| UC-006 | FR-003 | TC-008 | 1 | review→dones direct |
| UC-007 | FR-004, FR-011 | TC-004, TC-009 | 2 | legacy pipeline + sync sweep |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001 | yes | — |
| FR-002 | UC-001 | TC-002, TC-003 | yes | — |
| FR-003 | UC-005, UC-006 | TC-008 | yes | — |
| FR-004 | UC-007 | TC-004 | yes | — |
| FR-005 | UC-002 | TC-005 | yes | — |
| FR-006 | UC-003 | TC-006 | yes | — |
| FR-007 | UC-004 | TC-007 | yes | — |
| FR-008 | UC-003, UC-004 | TC-007 | yes | — |
| FR-009 | UC-001 | — | yes | skill docs verified at review |
| FR-010 | UC-001 | TC-003 | yes | hook env + seed pack |
| FR-011 | UC-007 | TC-009 | yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | none |
| Input | `schema.ts` exports |
| Steps | See steps table below |
| Expected outcome | `shipping` present with correct index/gates/transitions |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | assert `STAGES` order `…review, shipping, dones, cancelled` | `shipping` between review and dones |
| 2 | assert `TRANSITIONS.review` includes `shipping`; `TRANSITIONS.shipping === ["dones"]`; `STAGE_GATES.shipping === []`; indexes sequential | maps consistent |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project; item in review with current-execution PASS review report |
| Input | `kf stage <f> shipping` |
| Steps | See steps table below |
| Expected outcome | move succeeds; item lands in `.works/shipping/` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run stage move | success, folder moved |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002, FR-010 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project; items in non-review stages; item in review without PASS; `statusMap.shipping` configured |
| Input | `kf stage <f> shipping` variants |
| Steps | See steps table below |
| Expected outcome | refusals outside review+PASS; hook env carries `KFW_PROJECT_STATUS_SHIPPING` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | move from testing/brainstorm/etc | refused |
| 2 | move from review with FAIL report | refused |
| 3 | inspect hook env on a permitted move | `KFW_PROJECT_STATUS_SHIPPING` present |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-004 |
| Use case reference | UC-007 |
| Test type | Unit |
| Priority | High |
| Preconditions | none |
| Input | `readProjectConfig` with absent `ship`, valid block, and invalid field values |
| Steps | See steps table below |
| Expected outcome | defaults resolved; errors name file+field |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | absent block | defaults `{enabled:false, merge:"manual", release:false, changelog:false}` |
| 2 | valid block | parsed verbatim |
| 3 | `merge: "now"` / `enabled: "yes"` | typed errors naming file + field |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-005 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch repo + stub `gh` on PATH; item in shipping; `ship.enabled: true` |
| Input | `kf ship <f>` run twice |
| Steps | See steps table below |
| Expected outcome | PR created + `meta.pr` recorded once; re-run skips publish |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | first `kf ship` | push + `gh pr create` invoked; `meta.pr` set |
| 2 | second `kf ship` | publish skipped; no duplicate PR call |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | `meta.pr` recorded; stub `gh` reports open→merged across runs |
| Input | `kf ship <f>` under `merge: "manual"` and `merge: "auto"` |
| Steps | See steps table below |
| Expected outcome | manual → "waiting" exit 0; auto → `--auto` scheduled once; merged → pipeline advances |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | manual + open PR | reports waiting, exit 0 |
| 2 | auto + open PR | `gh pr merge --auto` called once |
| 3 | rerun with merged PR | proceeds past merge step |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-007, FR-008 |
| Use case reference | UC-003, UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | merged PR observed; flags on/off + `--no-release`/`--no-changelog` |
| Input | `kf ship <f>` post-merge runs |
| Steps | See steps table below |
| Expected outcome | release tag + `gh release create` when enabled; changelog appended when enabled; skipped steps stamped `skipped` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | all enabled | tag + release + changelog entry; stamps written |
| 2 | flags off / `--no-*` | steps skipped + recorded, no gh release call |
| 3 | re-run | nothing repeats |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-005, UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | items in `shipping` and in `review`; recorded PR merged vs unmerged variants |
| Input | `kf archive <f>` |
| Steps | See steps table below |
| Expected outcome | both stages archive; unmerged recorded PR refuses in both |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | archive from shipping, merged PR | dones + delivered |
| 2 | archive from shipping, unmerged PR | refused |
| 3 | archive direct from review | unchanged behaviour |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-011 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | shipping item with recorded merged PR (stub gh) |
| Input | `kf sync` |
| Steps | See steps table below |
| Expected outcome | shipping items swept to archive alongside review items |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run `kf sync` | merged-PR shipping item archived |

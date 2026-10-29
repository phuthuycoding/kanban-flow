---
feature: prune-old-releases
context: cli
created: 20261029_2105
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

This is the planned contract: execution outcomes belong in the testing-result report. Live `gh`/`git`/`npm` checks after the prune are acceptance commands, not CI cases.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | prune-old-releases |
| Context | cli |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`npm test`); live `gh release list`, `git ls-remote --tags origin`, `npm view` after the prune |
| Coverage target | 80% of `src/tests/helpers/release-prune.ts` |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 7 | 7 | Selector, dry-run, mismatch, no-op |
| Integration | 1 | 1 | Helper never spawns gh/git/npm |
| UI / E2E | 0 | 0 | No UI |
| **Total** | **8** | **8** | **Fixture-based; live prune verified by acceptance commands** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-004, FR-005 | TC-004, TC-007 | 2 | Dry-run text; no gh/git/npm spawn |
| UC-002 | FR-001, FR-002, FR-003, FR-006 | TC-001, TC-002, TC-003, TC-005 | 4 | Keep five; delete releases and leftover tags |
| UC-003 | FR-001, FR-004 | TC-006, TC-008 | 2 | Mismatch throws; fewer-than-five no-op |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-002, UC-003 | TC-001, TC-006, TC-008 | yes | publishedAt order; live recompute |
| FR-002 | UC-002 | TC-002 | yes | deleteReleases list |
| FR-003 | UC-002 | TC-003 | yes | leftover tags including v1/v2/v0.4 |
| FR-004 | UC-001, UC-003 | TC-004, TC-006 | yes | dry-run; mismatch abort |
| FR-005 | UC-001 | TC-007 | yes | no npm spawn |
| FR-006 | UC-002 | TC-005 | yes | applying the plan leaves five tags |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Spec-time fixture: 14 GitHub Releases with their `publishedAt` plus remote tags `v2.0.0`, `v1.1.0`, `v1.0.0`, `v0.4.1`, `v0.4.0` |
| Input | `selectPruneSets(releases, remoteTags, 5)` |
| Steps | See steps table below |
| Expected outcome | keep = `v0.13.0`, `v0.12.0`, `v0.11.5`, `v0.11.4`, `v0.11.3`. `v2.0.0` is not in keep |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call selector with the spec-time fixture | keep tags match the five newest by `publishedAt` |
| 2 | Assert `v2.0.0` is absent from keep | Semver did not win |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Same fixture as TC-001 |
| Input | `selectPruneSets` result |
| Steps | See steps table below |
| Expected outcome | deleteReleases = `v0.11.2`, `v0.11.1`, `v0.11.0`, `v0.10.0`, `v0.9.0`, `v0.8.0`, `v0.7.0`, `v0.6.0`, `v0.5.0` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read `deleteReleases` | Exactly those nine tags, none of the keep set |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Same fixture as TC-001 |
| Input | `selectPruneSets` result |
| Steps | See steps table below |
| Expected outcome | leftoverTags include `v2.0.0`, `v1.1.0`, `v1.0.0`, `v0.4.1`, `v0.4.0` and no keep-set tag |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read `leftoverTags` | Installer and pre-rewrite tags listed |
| 2 | Assert keep tags are not leftover | Keep set is disjoint |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | A prune plan from the fixture |
| Input | `formatPruneDryRun(plan)` |
| Steps | See steps table below |
| Expected outcome | Printed text names keep, delete-releases and leftover-tags. The function does not mutate the plan |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Format the plan | Output contains each keep tag and each delete tag |
| 2 | Call format again | Same text; plan unchanged |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture plus the plan from TC-001 |
| Input | Apply deleteReleases and leftoverTags to the fixture in memory |
| Steps | See steps table below |
| Expected outcome | Remaining releases = 5; remaining tags = those five |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Remove deleteReleases from the release list | Length 5 |
| 2 | Remove leftoverTags and deleteReleases from remote tags | Only keep tags remain |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-001, FR-004 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | A plan built from the spec-time fixture |
| Input | `assertInventoryMatches(plan, liveReleases, liveTags)` where liveReleases has an extra newer release |
| Steps | See steps table below |
| Expected outcome | Function throws; caller must not delete |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Pass a live list that differs by one tag | Throw / non-match |
| 2 | Pass the original fixture | No throw |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Helper module loaded |
| Input | Source of `src/tests/helpers/release-prune.ts` |
| Steps | See steps table below |
| Expected outcome | File contains no `npm`, `gh`, or `git` spawn/exec |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the helper source | No `exec`, `spawn`, `npm`, `gh`, or `git` command strings used to run processes |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | A fixture with only four GitHub Releases and several leftover tags |
| Input | `selectPruneSets(releases, remoteTags, 5)` |
| Steps | See steps table below |
| Expected outcome | No-op plan: keep = those four, deleteReleases empty, leftoverTags empty, reason set |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call selector with four releases | deleteReleases and leftoverTags are empty |
| 2 | Read the reason | States fewer than five releases |

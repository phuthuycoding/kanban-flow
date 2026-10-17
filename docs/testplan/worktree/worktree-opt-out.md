---
feature: worktree-opt-out
context: worktree
created: 20261017_1750
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | worktree-opt-out |
| Context | worktree |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`src/tests`) |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 2 | 2 | config default resolution |
| Integration | 5 | 5 | stage/doctor/operator/teardown behaviour |
| UI / E2E | 0 | 0 | no UI |
| **Total** | **7** | **7** | **config + behavioural coverage** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-003 | 2 | no worktree created or recorded |
| UC-002 | FR-001, FR-002 | TC-002, TC-004 | 2 | enabled:true identical to legacy |
| UC-003 | FR-003 | TC-005 | 1 | doctor silent / still suggests when enabled |
| UC-004 | FR-004 | TC-006, TC-007 | 2 | commands usable; teardown unaffected |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001, UC-002 | TC-001, TC-002 | yes | — |
| FR-002 | UC-001, UC-002 | TC-003, TC-004 | yes | — |
| FR-003 | UC-003 | TC-005 | yes | — |
| FR-004 | UC-004 | TC-006, TC-007 | yes | — |
| FR-005 | — | — | yes | text changes verified by review, no runtime test |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | none |
| Input | `worktreeConfig(root, undefined)` and `worktreeConfig(root, {})` |
| Steps | See steps table below |
| Expected outcome | `enabled === false` in both cases |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | call with `raw` undefined | `enabled === false` |
| 2 | call with `raw = {}` | `enabled === false` |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | none |
| Input | `worktreeConfig(root, { enabled: true })`, `worktreeConfig(root, { enabled: false })` |
| Steps | See steps table below |
| Expected outcome | explicit values honoured verbatim |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `enabled: true` | resolves `true` |
| 2 | `enabled: false` | resolves `false` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project via test helpers; no `worktree` block in config |
| Input | `kf stage <f> implementation` |
| Steps | See steps table below |
| Expected outcome | move succeeds; no `.worktrees/` dir; `.kfw.json` has no `worktree` field; stdout lacks `Worktree:`/`Domain:` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run stage move to implementation | succeeds |
| 2 | inspect meta + filesystem | no worktree recorded or created |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project; `worktree.enabled: true` |
| Input | `kf stage <f> implementation` |
| Steps | See steps table below |
| Expected outcome | worktree + branch created, `meta.worktree` recorded, output shows `Worktree:`/`Domain:` — identical to current tests' expectations |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run stage move with enabled:true | worktree provisioned as before |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | scratch project, default-off config vs `enabled: true` variant |
| Input | `kf doctor [--json]` |
| Steps | See steps table below |
| Expected outcome | disabled → no `worktree infra` finding/suggestion; enabled + missing infra → suggestion retained |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | doctor under disabled config | no worktree-infra finding |
| 2 | doctor under enabled + no infra | finding with `sudo kf worktree setup` |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | scratch project, default-off config |
| Input | `kf worktree list`, `kf worktree create <f>` |
| Steps | See steps table below |
| Expected outcome | commands run normally; `create` provisions even under default-off (operator intent) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `kf worktree list` | runs, no flag refusal |
| 2 | `kf worktree create <f>` | worktree created explicitly |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | item with recorded `meta.worktree` (seeded or created via `worktree create`), config default-off |
| Input | `kf archive <f>` (or `kf cancel <f> --reason x`) |
| Steps | See steps table below |
| Expected outcome | teardown executes; `meta.worktree` cleared; no orphan dir |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | archive item with recorded worktree | teardown runs despite disabled flag |
| 2 | inspect meta + dir | cleared / removed |

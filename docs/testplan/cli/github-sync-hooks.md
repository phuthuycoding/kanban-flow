---
feature: "github-sync-hooks"
context: "cli"
created: "20261010_1217"
status: planning
---

# Test Plan

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | github-sync-hooks |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest suite, `bash -n`, `shellcheck` if present, a scratch `.works` fixture, `gh` against a real test issue on this repo |
| Coverage target | 90% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 3 | 3 | config validation, KFW_* env, `kf issues sync` refusals |
| Integration | 1 | 1 | hook pack end-to-end on a temp project + real repo |
| UI / E2E | 0 | 0 | no UI surface |
| **Total** | **4** | **4** |  |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-005 | TC-001, TC-004 | 2 | config parsed; env present; doctor fixes |
| UC-002 | FR-003, FR-004 | TC-002, TC-003 | 2 | sync writes body; pack runs stages |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001 | yes |  |
| FR-002 | UC-001 | TC-001 | yes | env assertion |
| FR-003 | UC-002 | TC-002 | yes | sync command |
| FR-004 | UC-002 | TC-003 | yes | pack on fixture |
| FR-005 | UC-001 | TC-004 | yes | init + doctor |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001, FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | scratch project fixture |
| Input | config with `project` block; runHook on a probe hook |
| Expected output | valid/invalid configs accepted/refused correctly; hook sees KFW_PROJECT_* values |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | work item with filled spec + linked issue |
| Input | `kf issues sync <feature>` against a real test issue |
| Expected output | issue body equals spec minus frontmatter plus kf footer; refuses without link/spec |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | temp project: repository = this repo, pack installed, gh auth |
| Input | `kf new` + `kf stage` transitions |
| Expected output | issue created/linked, body synced, closed at dones/cancelled; bash -n clean on every pack file |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | temp project with pack partially deleted; `project` configured |
| Input | `kf doctor --fix` |
| Expected output | missing/divergent pack files restored; gh project-scope warning appears when token lacks it |

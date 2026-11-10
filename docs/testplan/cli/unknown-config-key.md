---
feature: unknown-config-key
context: cli
created: 20261110_1219
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | unknown-config-key |
| Context | cli |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (src/tests/doctor.test.ts), npm test |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 5 | 5 | runDoctor on written configs |
| Integration | 2 | 2 | cmdDoctor text, --json, --fix |
| UI / E2E | 0 | 0 | CLI only, no UI |
| **Total** | **7** | **7** | **all must pass** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007 | 7 | all pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-003, TC-004, TC-005, TC-006 | yes | docs row and CHANGELOG checked at review |
| FR-002 | UC-001 | TC-001, TC-002, TC-005, TC-007 | yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001, FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | config with `worktree` and `worktrees` blocks |
| Input | `runDoctor` on the project |
| Steps | See steps table below |
| Expected outcome | one WARNING, area `.kf/config.json`, message starts `unknown_config_key:` and names `worktrees`, action `did you mean "worktree"? rename or remove it` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `runDoctor` on the project | one WARNING, area `.kf/config.json`, message starts `unknown_config_key:` and names `worktrees`, action `did you mean "worktree"? rename or remove it` |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | config with an unknown key `notes` |
| Input | `runDoctor` |
| Steps | See steps table below |
| Expected outcome | one WARNING naming `notes`, action `remove it, or keep it as a note (kf ignores it)` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `runDoctor` | one WARNING naming `notes`, action `remove it, or keep it as a note (kf ignores it)` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | a config `kf init` wrote, plus one with `ship`, `stack` beside `stacks`, and `defaultContext` |
| Input | `runDoctor` on each |
| Steps | See steps table below |
| Expected outcome | no finding whose message starts `unknown_config_key:` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `runDoctor` on each | no finding whose message starts `unknown_config_key:` |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | config that is invalid JSON; config that is valid JSON but refused by the shape check (`schema: "other"`); no config file |
| Input | `runDoctor` on each |
| Steps | See steps table below |
| Expected outcome | no `unknown_config_key` finding; the existing config finding is reported |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `runDoctor` on each | no `unknown_config_key` finding; the existing config finding is reported |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-001, FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | config with unknown keys `foos`, `Worktree`, `context`, `ships` |
| Input | `runDoctor` |
| Steps | See steps table below |
| Expected outcome | four warnings in Object.keys order; `foos`, `Worktree` and `ships` without a hint; `context` hints `contexts` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `runDoctor` | four warnings in Object.keys order; `foos`, `Worktree` and `ships` without a hint; `context` hints `contexts` |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | config with `worktrees` and no ERROR finding |
| Input | `cmdDoctor` text and `--json` |
| Steps | See steps table below |
| Expected outcome | text lists the WARNING; JSON `findings` holds `{level: "WARNING", area: ".kf/config.json", message, action}`; exit 0 both times |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `cmdDoctor` text and `--json` | text lists the WARNING; JSON `findings` holds `{level: "WARNING", area: ".kf/config.json", message, action}`; exit 0 both times |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | config with `worktrees` and a legacy `stack` beside `stacks`, so `--fix` rewrites the file |
| Input | `cmdDoctor --fix` |
| Steps | See steps table below |
| Expected outcome | `--fix` removed `stack` (the file was rewritten) and the file still holds `worktrees`; the after-state findings still list the warning |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | write the config into a temp project | file written |
| 2 | run `cmdDoctor --fix` | the file still holds `worktrees`; the after-state findings still list the warning |

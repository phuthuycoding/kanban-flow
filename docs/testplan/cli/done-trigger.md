---
feature: "done-trigger"
context: "cli"
created: "20261010_2012"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | done-trigger |
| Context | cli |
| Test level | unit |
| UI scope | none |
| Tools / commands | vitest + hooks/issues test harness (stubbed `gh`, fake `.kfw.json`/repo env) |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 14 | 14 | meta, link, config/env, command flow, hook scripts, doctor/status |
| Integration | 0 | 0 | no new system boundary — `gh` is stubbed inside unit tests |
| UI / E2E | 0 | 0 | CLI feature, no UI |
| **Total** | **14** | **14** | **unit only** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001 | TC-013 | 1 | `dones.sh` never calls `issue close` |
| UC-002 | FR-002 | TC-001, TC-002 | 2 | meta fields valid; link writes correct field |
| UC-003 | FR-003, FR-004 | TC-003..005, TC-007..011, TC-014 | 9 | full delivery flow, idempotent, all fallbacks |
| UC-004 | FR-003 | TC-006 | 1 | refusal, zero side effects |
| UC-005 | FR-005 | TC-012 | 1 | warning present/absent correctly |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-013 | yes | script-level assertion on stubbed gh |
| FR-002 | UC-002 | TC-001, TC-002 | yes | |
| FR-003 | UC-003, UC-004 | TC-005..011, TC-014 | yes | step order verified by stub-call sequence |
| FR-004 | UC-003 | TC-003, TC-004, TC-007 | yes | statusMap parse + env emission + board call |
| FR-005 | UC-005 | TC-012 | yes | |
| FR-006 | — | — | n/a | docs-only; verified by review, not a test |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | FeatureMeta schema updated |
| Input | `.kfw.json` variants |
| Expected outcome | `pr` accepts `/pull/\d+` URL, rejects issue URL/other strings; `delivered` accepts boolean, rejects others |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `readFeatureMeta` on meta with valid `pr`/`delivered` | parses, fields present |
| 2 | meta with `pr` = issue URL or non-URL | validation error naming `pr` |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | work item + `.kfw.json` |
| Input | `kf issues link` variants |
| Expected outcome | `/pull/` URL → `pr`; bare number → `issue`; `--pr` number → `pr`; second `pr` refused; existing `issue` does not block `pr` |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `link f https://o/r/pull/28` | `meta.pr` written |
| 2 | `link f 26` | `meta.issue` written (unchanged behaviour) |
| 3 | `link f --pr 28` | `meta.pr` written |
| 4 | second PR link | refusal, meta unchanged |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | — |
| Input | config `statusMap` variants |
| Expected outcome | `delivered` key accepted; `delivered: 5` or unknown stage key still rejected |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `statusMap: {dones:"In review", delivered:"Done"}` | parses |
| 2 | `statusMap: {delivered: 5}` / `{bogus:"x"}` | named-field config error |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | statusMap.delivered configured |
| Input | `runHook` env |
| Expected outcome | `KFW_PROJECT_STATUS_DELIVERED` (and every other statusMap key) emitted |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | runHook env build with statusMap.delivered | env contains `KFW_PROJECT_STATUS_DELIVERED=Done` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | item in `testing`/`review` (not dones) |
| Input | `kf issues done` |
| Expected outcome | refusal naming archive first; nothing changes |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run `kf issues done` on non-dones item | exit 1, meta + issue untouched |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | dones item, `pr` set, stub `gh pr view` returns OPEN / CLOSED / error |
| Input | `kf issues done` |
| Expected outcome | exit 1; zero `issue close`/`item-edit` calls; `.kfw.json` unchanged |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | gh state=OPEN | refusal |
| 2 | gh state=CLOSED | refusal |
| 3 | gh error | refusal surfacing error |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-003, FR-004 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | dones item, `pr` MERGED, `issue` set, board configured, delivered.sh present |
| Input | `kf issues done` |
| Expected outcome | `gh pr view` → `delivered.sh` → `issue close` + `project item-edit` (delivered status) → `delivered` written |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run done | gh call sequence + meta flag verified |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | dones item, `issue` set, no `pr` |
| Input | `kf issues done` |
| Expected outcome | no `gh pr view` call; issue closed + flag written |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run done without `pr` | merge check skipped, delivery proceeds |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | item already `delivered` |
| Input | second `kf issues done` |
| Expected outcome | exit 0, "already delivered" note, idempotent side effects |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | re-run done | success, no duplicate failure |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | dones item, no `issue` |
| Input | `kf issues done` |
| Expected outcome | exit 0, warning "nothing to close", `delivered` still written |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run done with no issue link | flag + warning, exit 0 |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | dones item, no `delivered.sh` resolvable |
| Input | `kf issues done` |
| Expected outcome | warning "side effects skipped", `delivered` written, exit 0 |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run done with hook absent | flag + warning |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-005 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | dones items: (a) issue+!delivered, (b) issue+delivered, (c) no issue |
| Input | `runDoctor`, `kf status` |
| Expected outcome | WARNING on (a) only, naming `kf issues done` |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | runDoctor on the three fixtures | warning only on (a) |
| 2 | `kf status` on (a) | undelivered hint shown |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | stub `gh` logging calls, updated `dones.sh` |
| Input | run `dones.sh` with linked issue env |
| Expected outcome | board sync call present; `issue close` NEVER called |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | execute updated `dones.sh` | gh call log lacks `issue close` |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | dones item, `issue` already CLOSED on GitHub |
| Input | `kf issues done` |
| Expected outcome | close is a harmless no-op; flag + board still written; exit 0 |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run done with already-closed issue | success |

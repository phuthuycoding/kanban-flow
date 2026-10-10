---
feature: "release-on-tag"
context: "cli"
created: "20261010_1217"
status: planning
---

# Test Plan

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | release-on-tag |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | ruby YAML parse, `gh release view`, npm registry |
| Coverage target | 100% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 1 | 1 | workflow parses; jobs and guards shaped as specified |
| Integration | 1 | 1 | real tag drives the whole run on next release |
| UI / E2E | 0 | 0 |  |
| **Total** | **2** | **2** |  |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-003 | TC-001, TC-002 | 2 | all pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002 | yes | verify job order |
| FR-002 | UC-001 | TC-002 | yes | needs NPM_TOKEN first |
| FR-003 | UC-001 | TC-001, TC-002 | yes | notes extraction |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001, FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | branch checked out |
| Input | parse release.yml; dry-run the notes-extraction script against CHANGELOG.md |
| Expected output | tags trigger `v*`; verify step before test before publish before release; extraction returns the 0.6.0 section |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001, FR-002, FR-003 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | NPM_TOKEN secret exists; merged to main |
| Input | push tag `v0.6.1` on the next release (or a workflow_dispatch dry run) |
| Expected output | registry shows the version; release exists with its notes; a version-mismatch tag fails before publish |

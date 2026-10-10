---
feature: "ci-pipeline-dedup"
context: "cli"
created: "20261009_1920"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | ci-pipeline-dedup |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | `git`/`gh` CLI, `python3 -c 'import yaml'` (PyYAML absent → `ruby -ryaml`), Actions tab |
| Coverage target | 100% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 1 | 1 | YAML parses, jobs and triggers shaped as specified |
| Integration | 2 | 2 | real runs observed on GitHub after merge |
| UI / E2E | 0 | 0 | no UI surface |
| **Total** | **3** | **3** | workflow behaviour verified in the real Actions list |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-003 | TC-001, TC-002, TC-003 | 3 | all pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002 | yes | local YAML check + observed run count |
| FR-002 | UC-001 | TC-001, TC-003 | yes | stale-run cancellation observed |
| FR-003 | UC-001 | TC-001, TC-002 | yes | job names in the run |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001, FR-002, FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | branch checked out locally |
| Input | parse `.github/workflows/ci.yml` as YAML |
| Expected output | `on.push.branches == ["main"]`; `concurrency` group present; jobs `lint` and `test` exist, `check` gone; `test` matrix is [20, 22] |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001, FR-003 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | change merged to main; a PR branch exists |
| Input | push one commit to the PR branch |
| Expected output | Actions shows exactly one new run (event `pull_request`); jobs named `lint` and `test` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | a CI run for the PR is in progress |
| Input | push a second commit to the same branch |
| Expected output | the older run transitions to `cancelled`; the newer run completes |

---
feature: cli-refactor
context: harness
created: 20261024_1322
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | cli-refactor |
| Context | harness |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`npm test`), grep, `wc -l`, recorded-output comparison |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 1 | 1 | TC-002 |
| Integration | 6 | 6 | TC-001, TC-003…TC-007 |
| UI / E2E | 0 | 0 | CLI only |
| **Total** | **7** | **7** | **All must pass** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001…FR-006 | TC-001, TC-002, TC-003, TC-004 | 4 | Layout and layering as specified |
| UC-002 | FR-005…FR-008 | TC-005, TC-006, TC-007 | 3 | Byte-identical output, suite green |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001 | Yes | |
| FR-002 | UC-001 | TC-002 | Yes | |
| FR-003 | UC-001 | TC-002 | Yes | |
| FR-004 | UC-001 | TC-003 | Yes | |
| FR-005 | UC-001, UC-002 | TC-004, TC-005 | Yes | |
| FR-006 | UC-002 | TC-006 | Yes | |
| FR-007 | UC-002 | TC-007 | Yes | |
| FR-008 | UC-002 | TC-005, TC-006, TC-007 | Yes | |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Refactor applied |
| Input | `wc -l` over src (excluding tests); drive tests |
| Steps | See steps table below |
| Expected outcome | No source file over 500 lines; src/harness/drive/ holds claim, control and driver; src/tests/drive.test.ts passes unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Count lines | All ≤ 500 |
| 2 | Run drive tests | Green, test file untouched |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002, FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Refactor applied |
| Input | grep for `../cli/` imports under src/workflow, src/harness, src/ship, src/worktree; grep importers of gh/checkMergeGate/recordBypasses |
| Steps | See steps table below |
| Expected outcome | No lower-layer import of src/cli; gh/checkMergeGate come from integrations/github.ts; recordBypasses/bypassNote from workflow/bypass.ts |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the greps | No matches / expected sources only |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Refactor applied |
| Input | Existing archive-docs and cancel tests; import of canonicalContent/canonicalDocPaths from cli/commands/archive.js |
| Steps | See steps table below |
| Expected outcome | Old import path still resolves through re-export; canonical docs sync unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run archive-docs and cancel suites | Green |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Refactor applied |
| Input | grep cmdArchive in stage.ts, sync.ts, issues.ts; run sync, stage reopen-to-dones and issues done alias tests |
| Steps | See steps table below |
| Expected outcome | No synthetic cmdArchive calls remain; those flows behave as before |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Grep | No matches |
| 2 | Run sync/workflow/archive-delivery suites | Green |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-005, FR-008 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Recorded kf archive output captured before the change for: deliverable item, unmerged-PR refusal, wrong stage |
| Input | Run kf archive on the same fixtures after the change; call archiveItem directly |
| Steps | See steps table below |
| Expected outcome | stdout, stderr tag and exit code identical to the recording; archiveItem returns the matching typed outcome |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compare outputs | Byte-identical |
| 2 | Check outcomes | As expected |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-006, FR-008 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Recorded kf cancel output captured before the change for: success, missing --reason, live run refusal |
| Input | Run kf cancel on the same fixtures after the change; call cancelItem directly |
| Steps | See steps table below |
| Expected outcome | Identical output and exit codes; typed outcomes match |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compare outputs | Byte-identical |
| 2 | Check outcomes | As expected |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-007, FR-008 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Refactor applied |
| Input | Full suite; commands with an unknown item |
| Steps | See steps table below |
| Expected outcome | All existing tests pass with at most import-path edits; every command prints the same Unknown-feature message and exit code; typecheck, lint, build exit 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | npm run typecheck && npm run lint && npm run build && npm test | All exit 0 |

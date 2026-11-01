---
feature: cli-refactor
context: harness
created: 20261024_1322
status: archived
---
# Use Case

> **Partly superseded by `workflow-slim`:** `kf stage <feature> dones` no longer routes through archive — it is refused with a hint, because the stage is now `done` and is reached through the close (`kf status`, `kf sync` or `kf archive` after the merge); a reopen to legacy `dones` targets `done`. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | CLI users see identical behaviour |
| Requirement reference | FR-005, FR-006, FR-007, FR-008 |
| Goal | Every kf command prints the same output and exits with the same code as before the refactor |
| Primary actor | kf CLI user / agent |

## Supporting Actors
- Test suite

## Preconditions
- Recorded outputs of kf archive and kf cancel exist from before the change.

## Trigger
A user runs kf archive, kf cancel, kf stage, kf sync, kf issues done or any command with an unknown item.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | User | Runs kf archive on a deliverable item | Same stdout, stderr tag and exit code as before |
| 2 | User | Runs kf cancel with and without --reason | Same output and refusal as before |
| 3 | User | Runs any command naming an unknown item | Same "Unknown feature" message and exit 1 |
| 4 | Test suite | Runs the full suite | Green with only import-path changes in existing tests |

## Alternative Flows
### A1
- Trigger: kf stage <f> dones or a reopen to dones.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | stage routes through archiveItem | Same output as before |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Archive refused (unmerged PR, wrong stage) | archiveItem returns a refusal outcome | cmdArchive prints the identical refusal and exits 1 |

## Postconditions
- No observable behaviour change.

## Business Rules
- Byte-identical CLI output is the acceptance bar.

## Data
- Recorded outputs used by the new tests.

## Acceptance Criteria
- [ ] Recorded kf archive and kf cancel outputs match exactly for success and refusal fixtures.
- [ ] The full suite passes with no assertion changes in existing tests.

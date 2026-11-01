---
feature: harness-agents
context: harness
created: 20261101_0919
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Resolve a test dispute |
| Requirement reference | FR-005 |
| Goal | A test the developer believes is wrong goes back to its author, never gets bent to fit the code |
| Primary actor | Controller session |

## Supporting Actors
- developer, test-writer

## Preconditions
- UC-002 step 4 in progress.

## Trigger
The developer replies `STATUS: BLOCKED` with `TEST_DISPUTE: <file:line> <why>`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Ledgers the dispute and dispatches the test-writer with the line | test-writer re-reads the TC |
| 2 | test-writer | Test contradicts the TC → fixes it and re-runs | Fixed test, failing for the right reason |
| 3 | Controller | Resumes the developer with the fixed test | Back to UC-002 step 4 |

## Alternative Flows
### A1
- Trigger: the test-writer keeps the test, quoting the TC

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Controller ledgers `Ruling:` that the TC is binding and resumes the developer with it | Back to UC-002 step 4 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The developer's reason is that the TC contradicts an FR or another TC | Controller stops and reports a plan or requirement problem to the human | Task blocked, ledgered |
| A second dispute on the same test after a Ruling | Controller stops and reports to the human | Task blocked, ledgered |

## Postconditions
- Every dispute step is in the ledger.

## Business Rules
- The developer never edits a test; the controller never edits a test either.

## Data
- Dispute line: `TEST_DISPUTE: <test file:line> <why>`

## Acceptance Criteria
- [ ] kanban-implement states the route: fix or keep; kept → Ruling and developer resumed; TC-vs-FR contradiction or second dispute → stop to the human.

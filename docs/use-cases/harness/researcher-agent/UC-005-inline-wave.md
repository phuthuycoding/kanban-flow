---
feature: researcher-agent
context: harness
created: 20261102_1044
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | The controller runs a one-task wave inline |
| Requirement reference | FR-017 |
| Goal | Spend no developer subagent on a step that cannot run in parallel, without losing test-first or independent review |
| Primary actor | Controller session (plan and implement skills) |

## Supporting Actors
- Test-writer agent
- Code-reviewer agent

## Preconditions
- The plan records `Execution: wave <w> inline` for the wave, from `kf tasks <f> --graph`

## Trigger
The implement loop reaches a task in an inline wave

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Dispatches test-writers for the next 4 tasks in parallel | Failing tests ready ahead |
| 2 | Controller | Ledgers `developer dispatched` and `Note TASK-NNN: developer seat inline`, implements the task and commits it | Task commit; ledger grammar unchanged |
| 3 | Controller | Starts `kf verify` and an independent code-reviewer in the background, and starts task N+1 | Review overlaps the next task |
| 4 | Controller | Commits N+1 only after N's review is back and N's HIGH and MEDIUM findings are fixed | No commit on top of a failed review |

## Alternative Flows
### A1
- Trigger: Task N must deviate from a signature the plan fixes

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Ledger a `Ruling:` and re-dispatch the dependent tasks' test-writers | Tests follow the ruling; the controller never edits them |

### A2
- Trigger: The inline chain holds more than 5 tasks or large diffs

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | One developer subagent is resumed for the whole chain | The controller's context stays for coordination |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| N's review returns findings while N+1 is half written | N is fixed and re-reviewed first; N+1 waits uncommitted | N+1 may need rework; nothing committed is lost |

## Postconditions
- Every inline task has its test-writer, its commit and an independent review

## Business Rules
- The controller never reviews its own task

## Data
- Ledger: `Note TASK-NNN: developer seat inline`; plan: `Execution: wave <w> ...`

## Acceptance Criteria
- [ ] The plan skill records one `Execution:` line per wave and states them in the approval summary
- [ ] The implement skill states the inline seat, ahead test-writers, independent reviewer, review gate, drift ruling and long-chain rule
- [ ] `kf loop-stats` parses an inline ledger

---
feature: ade-sync
context: worktree
created: 20261014_2111
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Create worktree with no ADE reachable |
| Requirement reference | FR-001, FR-007 |
| Goal | Absent or stopped ADEs add zero noise and zero latency surprises |
| Primary actor | Developer |

## Supporting Actors
- None

## Preconditions
- No ADE binary on PATH, or binaries present but apps not running; or `adeSync: false` in machine config.

## Trigger
`kf worktree create <feature>` or stage → implementation.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Iterate adapters; every `isAvailable()` returns false (or `adeSync` false short-circuits before any call) | No subprocess spawned beyond detection |
| 2 | kf | No sync lines appended | Output identical to pre-feature contract |

## Alternative Flows
### A1
- Trigger: binary exists but app is stopped

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `isAvailable()` returns false after status check | Skipped silently — resumes at step 2 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Detection itself throws (malformed binary output) | Caught inside `isAvailable`, adapter treated unavailable | Silent skip |

## Postconditions
- Worktree created normally; no ADE lines in output; exit code 0.

## Business Rules
- Detection failure means "unavailable", never "error".

## Data
- MachineConfig `adeSync` boolean (default `true`).

## Acceptance Criteria
- [ ] PATH without `orca`/`herdr` → create output has no ADE lines.
- [ ] `adeSync: false` → zero adapter subprocess calls (verifiable via fake CLI argv files).

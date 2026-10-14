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
| ID | UC-003 |
| Name | Adapter failure degrades to warning |
| Requirement reference | FR-006 |
| Goal | A broken ADE never breaks worktree creation or removal |
| Primary actor | Developer |

## Supporting Actors
- Failing ADE CLI (non-zero exit, garbage output, or timeout)

## Preconditions
- Worktree create/remove in progress; one adapter is available but its attach/detach call fails.

## Trigger
An adapter throws or returns a non-zero result during `attach`/`detach`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Adapter | `attach()` throws (non-zero exit, timeout, unparsable JSON) | Error captured by orchestration |
| 2 | Orchestration | Convert to `{ ok:false, warning }`; continue with remaining adapters | Siblings still sync |
| 3 | kf | Print `  ⚠ <ADE>: <truncated error>` after normal create output | Exit code stays 0 |

## Alternative Flows
### A1 Failure during detach
- Trigger: teardown path

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Failure appended to `TeardownResult.warnings` | Existing `⚠` rendering shows it; removal still succeeds |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| All adapters fail | Each produces a warning | Create/remove still succeed |

## Postconditions
- Worktree state identical to a run without ADEs; warnings are the only residue.

## Business Rules
- Sync is side-effect-only: never throws across the orchestration boundary.

## Data
- `AdeSyncResult.warning` carries the truncated error.

## Acceptance Criteria
- [ ] A fake adapter/CLI exiting non-zero yields `⚠` in output and exit 0.
- [ ] A throwing adapter does not prevent a later adapter from running.

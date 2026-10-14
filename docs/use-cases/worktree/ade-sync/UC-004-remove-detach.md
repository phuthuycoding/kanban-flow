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
| ID | UC-004 |
| Name | Remove worktree detaches ADE state |
| Requirement reference | FR-005 |
| Goal | Removing a worktree leaves no stale workspace in ADEs |
| Primary actor | Developer |

## Supporting Actors
- Herdr server

## Preconditions
- A registered worktree exists; it was previously opened as a Herdr workspace.

## Trigger
`kf worktree remove <feature>` (also via `kf cancel` / `kf archive`, which share `teardownWorktree`).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | `teardownWorktree` runs remove hook and git removal | Checkout gone |
| 2 | Orchestration | `detachWorktreeFromAdes` iterates adapters | Only adapters with `detach` run |
| 3 | Herdr adapter | `worktree list` (cwd=root) → match path → `workspace close <open_workspace_id>` | Workspace closed |
| 4 | kf | Any detach failure joins `TeardownResult.warnings` | Printed as `⚠` lines |

## Alternative Flows
### A1 No open workspace for the path
- Trigger: worktree was never attached, or workspace already closed

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `worktree list` shows no `open_workspace_id` | Adapter returns null → no output line |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Path already deleted manually | `worktree list` no longer matches | Silent no-op |
| `workspace close` fails | Warning | Teardown succeeds |

## Postconditions
- Herdr shows no workspace bound to the deleted path; Orca needs no action (external rows vanish with the path).

## Business Rules
- Herdr detach uses `workspace close`, never `worktree remove` (kf owns git deletion).

## Data
- `open_workspace_id` from `herdr worktree list` JSON.

## Acceptance Criteria
- [ ] Removing a worktree with an open Herdr workspace closes that workspace.
- [ ] Removing one without an open workspace produces no extra output.

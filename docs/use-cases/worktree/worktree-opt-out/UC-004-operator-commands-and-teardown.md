---
feature: worktree-opt-out
context: worktree
created: 20261017_1750
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Operator commands + legacy teardown under default-off |
| Requirement reference | FR-004, NFR (no orphaned worktrees) |
| Goal | `kf worktree`/`kf proxy` stay usable under default-off, and an item carrying a recorded worktree still tears down on archive/cancel |
| Primary actor | Project owner |

## Supporting Actors
- `git`, proxy daemon

## Preconditions
- Project under default-off (or `enabled: false`)
- For teardown leg: an item whose `.kfw.json` records `meta.worktree` (created while the project was opted in, or created manually via `kf worktree create`)

## Trigger
`kf worktree list|create|remove|setup`, `kf proxy serve`, or `kf archive`/`kf cancel` on an item with `meta.worktree`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner | runs `kf worktree list` (or any subcommand) | executes normally — flag not consulted |
| 2 | Owner | runs `kf archive <f>` on item holding `meta.worktree` | teardown runs despite `enabled: false` |
| 3 | kf | clears `meta.worktree`, item → dones | no orphan worktree left |

## Alternative Flows
### A1
- Trigger: recorded worktree is dirty

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | teardown refuses as today | archive blocked until clean |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `meta.worktree` points at a deleted path | teardown reports "was already gone" | archive proceeds |

## Postconditions
- No worktree artefacts remain; branch kept per existing rules

## Business Rules
- The flag governs automatic behaviour; explicit operator commands and teardown obligations ignore it.

## Data
- `meta.worktree`: removed on teardown

## Acceptance Criteria
- [ ] `kf worktree list/create/remove/setup` and `kf proxy serve` work with worktree disabled
- [ ] `kf archive`/`kf cancel` on an item with recorded worktree tears it down under default-off

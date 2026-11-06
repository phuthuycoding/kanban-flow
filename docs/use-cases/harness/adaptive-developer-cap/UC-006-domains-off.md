---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-006 |
| Name | Turn the worktree domain layer off |
| Requirement reference | FR-009, FR-010, FR-011, FR-012 |
| Goal | Use per-item worktrees without the `.test` DNS + proxy infrastructure |
| Primary actor | Human (project owner) |

## Supporting Actors
- `kf` CLI
- Controller session (reads the direct URL)

## Preconditions
- `.kf/config.json` has `worktree.enabled: true`

## Trigger
The human sets `"domains": false` under `worktree`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Human | Sets `"worktree": { "enabled": true, "domains": false }` | Config loads |
| 2 | kf | `kf validate` / `kf doctor` skip `probeDomainInfra` | No `worktree_infra_missing`, no `worktree infra` line |
| 3 | kf | `kf approve` provisions the worktree (branch, dir, port, route) | Transition note shows `http://127.0.0.1:<port>` only |
| 4 | Controller | Reads `kf status --change <f>` | `Direct:` line, no `Domain:` line |
| 5 | Hooks | Run with `KFW_WORKTREE_PATH`, `KFW_WORKTREE_PORT`, `KFW_WORKTREE_BRANCH` | No `KFW_WORKTREE_DOMAIN` |

## Alternative Flows
### A1
- Trigger: `domains` absent or `true`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Every probe, output and env var as today | Unchanged behaviour |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `domains` is not a boolean | Config load fails | `worktree.domains must be boolean` |

## Postconditions
- Ports stay unique across repositories (route still registered)

## Business Rules
- Default `true`; `.kfw.json` keeps `domain`

## Data
- Config: `.kf/config.json` `worktree.domains`
- Registration: `.kfw.json` `worktree` (unchanged shape)

## Acceptance Criteria
- [ ] No infra finding in `kf validate` / `kf doctor` when off
- [ ] Direct URL only in status, transition note, `kf worktree create|list` when off
- [ ] Skills and the automation-writer say to use the direct URL when no domain is shown

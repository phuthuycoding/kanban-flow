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
| ID | UC-001 |
| Name | Default-off: no provisioning on implementation |
| Requirement reference | FR-001, FR-002 |
| Goal | A project without a `worktree` block moves an item to `implementation` without any worktree being created |
| Primary actor | Project owner / agent |

## Supporting Actors
- `git` (no worktree commands run)

## Preconditions
- `.kf/config.json` has no `worktree` block (or `enabled` absent)
- A work item exists in `planning`/`backlog` eligible to move to `implementation`

## Trigger
`kf stage <feature> implementation`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | runs `kf stage <f> implementation` | transition requested |
| 2 | kf | resolves `worktreeConfig` → `enabled: false` | provisioning skipped entirely |
| 3 | kf | writes `.kfw.json` meta | no `worktree` field recorded |
| 4 | kf | prints move confirmation | no `Worktree:`/`Domain:` lines in output |

## Alternative Flows
### A1
- Trigger: config sets `worktree: {}` (block present, `enabled` absent)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `enabled` resolves to default `false` | identical to main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Invalid `worktree.enabled` type (e.g. string) | `parseWorktreeConfig` throws naming the file | config error, move aborted |

## Postconditions
- Item sits in `.works/implementation/`; `.kfw.json` has no `worktree` field
- No `.worktrees/` directory created for the item

## Business Rules
- Provisioning is opt-in only; absence of the flag means off.

## Data
- `.kfw.json.meta.worktree`: absent when disabled

## Acceptance Criteria
- [ ] `kf stage <f> implementation` with no worktree config creates no worktree dir or branch
- [ ] `.kfw.json` carries no `worktree` key
- [ ] Stage output contains no `Worktree:`/`Domain:` lines

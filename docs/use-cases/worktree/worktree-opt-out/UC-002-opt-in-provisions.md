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
| ID | UC-002 |
| Name | Opt-in: provisioning unchanged when enabled |
| Requirement reference | FR-001, FR-002 |
| Goal | A project with `worktree.enabled: true` gets identical provisioning to the pre-change behaviour |
| Primary actor | Project owner / agent |

## Supporting Actors
- `git` (worktree add/branch), ADE attach path

## Preconditions
- `.kf/config.json` contains `"worktree": { "enabled": true }`
- A work item eligible to move to `implementation`

## Trigger
`kf stage <feature> implementation`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | runs `kf stage <f> implementation` | transition requested |
| 2 | kf | resolves `enabled: true` → `ensureWorktree` | worktree + branch created |
| 3 | kf | records `meta.worktree` | path/branch/domain/port stored |
| 4 | kf | prints move confirmation | `Worktree:`/`Domain:` lines shown |

## Alternative Flows
### A1
- Trigger: `enabled: false` explicitly set

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Explicit `false` honoured identically to absent | same as UC-001 main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `ensureWorktree` fails under `enabled: true` | move refused with setup error | message points at `worktree.enabled: false` to skip |

## Postconditions
- Worktree registered in `meta.worktree`; branch cut per `branchPrefix`

## Business Rules
- Explicit `true` preserves the full legacy behaviour byte-for-byte.

## Data
- `.kfw.json.meta.worktree`: `{ path, branch, domain, port }`

## Acceptance Criteria
- [ ] `enabled: true` creates worktree, branch and `meta.worktree` exactly as before the flip
- [ ] `enabled: false` behaves like UC-001

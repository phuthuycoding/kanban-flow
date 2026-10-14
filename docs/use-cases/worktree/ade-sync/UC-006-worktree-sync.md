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
| ID | UC-006 |
| Name | `kf worktree sync` broadcasts the current worktree |
| Requirement reference | FR-001, FR-009 |
| Goal | Re-attach worktrees into ADEs on demand — including worktrees created outside kf |
| Primary actor | Developer |

## Supporting Actors
- Orca runtime, Herdr server

## Preconditions
- `adeSync` not disabled; cwd resolves to a `.works` root (directly or via `git-common-dir` from inside a linked worktree).

## Trigger
`kf worktree sync [feature]`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Resolve target: arg → that feature's registered worktree; inside a linked worktree → `git rev-parse --show-toplevel`; at root with no arg → every registered worktree | Target list built |
| 2 | kf | For each target, look up the owning feature by registered path; foreign worktrees get label = branch basename or dir name | Attach context per target |
| 3 | kf | `attachWorktreeToAdes` per target | Same adapter path as create |
| 4 | kf | Print one line per target per ADE (or `⚠` on failure) | Per-ADE sync status |

## Alternative Flows
### A1 Inside a foreign (ADE-created) worktree
- Trigger: cwd's toplevel matches no registered `meta.worktree.path`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Build synthetic context — no feature binding, no `.works` write | Adapters attach the checkout anyway; resumes at step 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Named feature has no worktree | Error exit 1 | `Feature 'x' has no worktree` |
| cwd outside any git worktree / no `.works` | Error exit 1 | existing no-works error |
| No ADE reachable | Informative line, exit 0 | "no ADEs reachable" |

## Postconditions
- Every reachable ADE knows each synced worktree; `.works` metadata untouched for foreign checkouts.

## Business Rules
- Sync is read-only toward kf state — it never mutates registrations or routes.
- Idempotent: repeated runs converge (Herdr `already_open`; Orca list check).

## Data
- Target resolution: `git rev-parse --show-toplevel` vs registered `meta.worktree.path` (realpath both).

## Acceptance Criteria
- [ ] Inside an Orca-created worktree of a kf repo → broadcast to Herdr + Orca check; nothing written to `.works`.
- [ ] `kf worktree sync <feature>` re-attaches without recreating anything.
- [ ] Bare `sync` at root reports each registered worktree.

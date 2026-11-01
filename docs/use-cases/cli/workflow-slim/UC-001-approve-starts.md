---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case

> **Partly superseded by `drive-retire`:** the parts that use `kf drive` (config resolution, `--status`/`--watch`, drive supervisor and workers) or `kf run` no longer hold — both are removed; `travel` runs items itself in the session and the in-session loop is the only implementation path. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Approve starts implementation; `--backlog` defers |
| Requirement reference | FR-001, FR-002 |
| Goal | One human decision — approve — both seals the contract and starts (or parks) the item, with no second chat question |
| Primary actor | Maintainer |

## Supporting Actors
- `kf` CLI (`cmdApprove`, `transitionItem`, worktree provisioning)
- Phase skills `kanban-plan`, `kanban-flow` (they stop asking start-vs-backlog)

## Preconditions
- The item is in `planning` with a complete contract (`kf validate` reports only `approval_required`).
- `worktree.enabled` may be true or false; when true, the base checkout is reachable.

## Trigger
The maintainer replies "approve" (or "approve, backlog") to the planning summary; the agent runs `kf approve <feature>` or `kf approve <feature> --backlog`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Validates the contract and computes `contractHash` as today | Refusal with the validation report when incomplete |
| 2 | kf | Writes `meta.approval` (`approved`, by, at, contractHash) and clears `executionId` | Approval recorded |
| 3 | kf | Runs the planning → implementation transition: gates, `syncBase`, the `implementation` hook, worktree + branch + route when `worktree.enabled` | Item folder moves to `.works/implementation/`, `Worktree:` printed |
| 4 | kf | Prints `✓ Approved … → implementation` with the worktree path and `Next: kf drive <feature>` (or the implement skill when no drive is configured) | The agent proceeds without asking |

## Alternative Flows
### A1 — `--backlog`
- Trigger: the maintainer defers.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Steps 1–2 as in the main flow | Approval recorded |
| A1.2 | Transition planning → backlog (hook `backlog`, no worktree) | Item in `.works/backlog/`; `Next: kf stage <feature> implementation` when ready |

### A2 — already approved, unchanged contract
- Trigger: `kf approve` re-run on an approved planning item.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Approval is kept (same hash), the transition runs | Same as main flow step 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The transition fails after the approval was written (hook refused, worktree provisioning failed, base behind) | kf restores `meta.approval` to its previous value (pending), leaves the item in planning | Exit 1; message names the refused gate or the worktree error and says the approval was not kept |
| `kf approve` on an item outside planning | Refused as today | Exit 1, "Approval only applies during Phase 2 (planning)" |
| `--backlog` combined with a drive precondition warning (`task_harness_needs_worktree`) | Warning printed, approval and move still happen | Item in backlog with the warning on record |

## Postconditions
- The item is in `implementation` (worktree provisioned when enabled) or in `backlog`, with a valid approval fingerprint.
- `kf status` never prints "start (implementation) or backlog (defer)"; the next step is `kf drive` / the implement skill, or `kf stage … implementation` from backlog.

## Business Rules
- Approval and the stage move are one command; a failed move never leaves a stranded `approved` item in planning.
- `kf stage <feature> implementation` from backlog is unchanged and still requires the valid approval.
- Skills must not ask start-vs-backlog in chat; the human's reply to the plan summary carries the choice.

## Data
- `.kfw.json`: `meta.approval { status, by, at, contractHash }`, `stage`, `meta.worktree`.

## Acceptance Criteria
- [ ] `kf approve x` → stage `implementation`, worktree provisioned when enabled, approval valid.
- [ ] `kf approve x --backlog` → stage `backlog`, approval valid; `kf stage x implementation` later succeeds.
- [ ] A failing implementation hook leaves the item in planning with approval `pending` and exit 1.
- [ ] `kf status --change x` after approve prints no start/backlog decision text.

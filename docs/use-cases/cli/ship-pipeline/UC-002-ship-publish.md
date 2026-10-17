---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | `kf ship` publishes branch + PR, records `meta.pr` |
| Requirement reference | FR-005 |
| Goal | Create the item's pull request and persist it where `archive` already looks |
| Primary actor | Agent |

## Supporting Actors
- `git`, `gh` CLI

## Preconditions
- Item in `shipping` stage; `ship.enabled: true` in `.kf/config.json`
- `gh` authenticated; no `meta.pr` recorded yet

## Trigger
`kf ship <feature>`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | resolves branch: `meta.worktree.branch` else current checkout branch | branch chosen |
| 2 | kf | `git push -u origin <branch>` | branch on remote |
| 3 | kf | `gh pr create` (title/body from spec + plan summaries) | PR URL |
| 4 | kf | records `meta.pr` + `meta.ship.published` stamp | progress persisted |

## Alternative Flows
### A1
- Trigger: `meta.pr` already recorded

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | publish step skipped | proceeds to merge check |

### A2
- Trigger: `--draft` passed

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `gh pr create --draft` | draft PR recorded the same way |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `gh` missing / PR create fails | error surfaced verbatim; `meta.pr` untouched | `kf ship` exits non-zero, re-runnable |
| `ship.enabled` false/absent | prints the item's manual checklist (push, open PR, `kf issues link <f> --pr`) | exit 1, nothing written |

## Postconditions
- `meta.pr` set; PR open on the repo

## Business Rules
- One PR per item; publish never duplicates a recorded PR.

## Data
- `.kfw.json.meta.pr`, `.kfw.json.meta.ship.published`

## Acceptance Criteria
- [ ] First run creates + records PR; second run does not recreate
- [ ] Works for worktree and non-worktree items

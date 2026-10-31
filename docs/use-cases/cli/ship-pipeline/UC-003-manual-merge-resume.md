---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case

> **Superseded by `workflow-slim`.** The `shipping` stage, the `kf ship` pipeline, the `ship` config block and the `kanban-ship` skill with its ship-or-archive gate are gone: review opens the PR after the independent code-reviewer passes and watches CI, the human merges on GitHub, and the next `kf status --change <feature>` or `kf sync` closes the item into `done` (`kf ship` is a deprecated alias that exits 1; a release is a manual `gh release create`). Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Manual merge: ship reports waiting, resumes after merge |
| Requirement reference | FR-006, FR-008 |
| Goal | Under `merge: "manual"` the pipeline pauses truthfully and resumes once the human merges |
| Primary actor | Agent + human |

## Supporting Actors
- `gh` CLI, GitHub CI/reviewers

## Preconditions
- `meta.pr` recorded; PR open and unmerged; `merge: "manual"` (default)

## Trigger
`kf ship <feature>` (first and later runs)

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | `gh pr view --json state` → open, unmerged | merge pending |
| 2 | kf | prints "waiting for merge" + PR URL | exits 0 |
| 3 | Human | merges on GitHub (CI/review enforced there) | PR merged |
| 4 | Agent | re-runs `kf ship <f>` | merge detected → proceeds to enabled post-merge steps |

## Alternative Flows
### A1
- Trigger: `merge: "auto"` in config

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `gh pr merge --auto` scheduled once (stamped) | GitHub merges when CI green |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| PR closed unmerged | ship reports the state honestly | archive still refuses; human decides |
| `merge: auto` but repo lacks allow-auto-merge | explained refusal | item stays in shipping |

## Postconditions
- `meta.ship.merged` stamped once `gh` observes merge

## Business Rules
- `kf` never merges a PR itself; at most it schedules `--auto`.

## Data
- `.kfw.json.meta.ship.merged`, `meta.ship.autoMergeScheduled`

## Acceptance Criteria
- [ ] Manual mode reports waiting and exits 0 while unmerged
- [ ] Post-merge run advances to enabled steps
- [ ] `auto` schedules once, not per run

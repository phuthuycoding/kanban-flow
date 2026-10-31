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
| ID | UC-004 |
| Name | Post-merge: release + changelog steps |
| Requirement reference | FR-007, FR-008 |
| Goal | Once the PR is merged, cut the release and append the changelog entry — each only when enabled |
| Primary actor | Agent |

## Supporting Actors
- `git`, `gh` CLI

## Preconditions
- `meta.ship.merged` observed; `release`/`changelog` flags resolved (config + per-run overrides)

## Trigger
`kf ship <feature>` resuming past the merge check

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | `release: true` → compute tag (from package version convention / `gh release create <tag>`), notes generated from spec/report artifacts | release published; `meta.ship.released` stamped |
| 2 | kf | `changelog: true` → append entry to `CHANGELOG.md` matching existing format | entry added; `meta.ship.changelog` stamped |
| 3 | kf | prints "ready to archive" | pipeline complete |

## Alternative Flows
### A1
- Trigger: flag off or `--no-release` / `--no-changelog`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | step skipped, recorded as skipped (manual territory) | continues to next step |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `CHANGELOG.md` missing | create with standard header, then append | file created |
| `gh release create` fails (tag exists, perms) | error surfaced, stamp not written | re-runnable |

## Postconditions
- Release and/or changelog done or explicitly skipped; stamps in `.kfw.json`

## Business Rules
- Disabled ≠ failed: skipped steps are recorded so `archive` and re-runs see intent.

## Data
- `.kfw.json.meta.ship.released`, `.kfw.json.meta.ship.changelog` (values `done|skipped`)

## Acceptance Criteria
- [ ] Enabled steps run once total across re-runs
- [ ] Disabled/overridden steps recorded as skipped, never executed
- [ ] Release notes derive from the item's own artifacts

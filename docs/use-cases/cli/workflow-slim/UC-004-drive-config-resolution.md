---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Stale primary checkout still drives from the worktree config |
| Requirement reference | FR-006 |
| Goal | `kf drive` reads the harness it needs from the item worktree, then `origin/main`, then the primary checkout — a stale local `main` without a `harness` block no longer refuses the drive |
| Primary actor | Drive supervisor (`kf drive`) |

## Supporting Actors
- `readProjectConfig` / a new `resolveDriveConfig(root, feature)` in `src/project/config.ts`
- git (`git show origin/main:.kf/config.json`)

## Preconditions
- The item has a worktree with its own `.kf/config.json` (tracked file, present on the item branch), or `origin/main` has one, or only the primary checkout has one.

## Trigger
`kf drive <feature>` (or `kf run <feature> --task …`) starts and resolves `harness`, `worktree`, `project`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Resolves the project root as today (`findWorksRoot` through the git common dir) | `.works` located |
| 2 | kf | Reads `.kf/config.json` from the item worktree path recorded in `meta.worktree` when the file exists there | Config source = worktree |
| 3 | kf | Else reads `git show origin/main:.kf/config.json` from the primary repo | Config source = origin/main |
| 4 | kf | Else reads the primary checkout's `.kf/config.json` | Config source = primary |
| 5 | kf | Logs the source in the drive log and `--status`; the config hash used for the `config_changed` stop is computed from the resolved source | Drive starts from a stale primary |

## Alternative Flows
### A1 — no worktree (worktrees disabled)
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Step 2 is skipped; steps 3–4 apply | Behaviour unchanged for non-worktree projects except the `origin/main` fallback |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No source has a parsable config | Drive refuses as today, naming the three places it looked | Exit 1 |
| Worktree config and primary config differ mid-drive | `config_changed` fires only when the resolved source changes, as today | Named stop |
| `origin/main` has no `.kf/config.json` (project not yet onboarded on main) | Fallback to the primary checkout | Drive starts |

## Postconditions
- The drive runs with the item's own config; `kf drive --status` shows which source was used.

## Business Rules
- The resolution order is fixed: worktree → origin/main → primary. No flag changes it.
- `kf status`, `kf validate` and the other commands keep reading the primary checkout's config; only the drive and task runs resolve this way (the item worktree is where their work happens).

## Data
- `.kf/config.json` (three candidate locations); `runs/drive-<id>.jsonl` `config_source` field; `meta.drive.configHash`.

## Acceptance Criteria
- [ ] A drive started from a worktree whose primary `main` lacks `harness` still starts and logs `config_source: worktree`.
- [ ] With no worktree config, `origin/main`'s config is used; with neither, the primary's.
- [ ] `config_changed` behaviour is unchanged for the resolved source.

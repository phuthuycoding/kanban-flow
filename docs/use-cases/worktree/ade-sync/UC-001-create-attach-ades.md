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
| ID | UC-001 |
| Name | Create worktree attaches into running ADEs |
| Requirement reference | FR-001, FR-003, FR-004, FR-008 |
| Goal | A created worktree appears in every reachable ADE without manual steps |
| Primary actor | Developer running `kf worktree create` or `kf stage … implementation` |

## Supporting Actors
- Orca runtime (`orca` CLI), Herdr server (`herdr` CLI)

## Preconditions
- Work item exists in `.works`; repo is a git repository; `worktree.enabled` is not false; `adeSync` not disabled in machine config.

## Trigger
`kf worktree create <feature>` succeeds, or a stage transition into implementation auto-creates the worktree.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | `ensureWorktree` creates checkout, branch, route, runs create hook | Worktree registration returned |
| 2 | kf | Iterate `ADE_ADAPTERS`; call `isAvailable()` per adapter | Only reachable ADEs proceed |
| 3 | Herdr adapter | `herdr worktree open --path <wt> --branch <b> --label <feature> --no-focus` | Workspace created (`worktree_opened`/`already_open`) |
| 4 | Orca adapter | `orca repo add --path <root>` then `worktree list` membership check | Repo registered; worktree visibility confirmed or warned |
| 5 | kf | Print one `  <ADE>: <detail>` line (or `⚠` warning) per adapter in command output | User sees sync status |

## Alternative Flows
### A1 Worktree already registered (idempotent reuse)
- Trigger: `ensureWorktree` returns an existing registration

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Adapters still attach | Herdr reports `already_open`; Orca re-verifies listing — resumes at step 5 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| ADE reachable but attach fails | Catch, produce `⚠ <ADE>: <error tail>` | Create exits 0; worktree fully usable |
| Orca repo visibility = hide | Attach reports warning naming the in-app setting | Worktree registered, not yet listed in Orca |

## Postconditions
- Worktree open as a Herdr workspace labelled with the feature name.
- Repo registered in Orca; worktree listed when external-worktree visibility is on.
- Branch name follows resolved prefix (`<git-name>/<feature>` when a git name resolves).

## Business Rules
- Adapter order is registry order; each call bounded by timeout.
- Attach never mutates the git checkout.

## Data
- `AdeAttachContext`: `{ root, feature, worktree }`.
- `AdeSyncResult`: `{ ade, ok, detail, warning? }`.

## Acceptance Criteria
- [ ] Both ADEs reachable → output contains a Herdr sync line and an Orca line (visible or visibility warning).
- [ ] Re-running create on the same feature does not duplicate the Herdr workspace.
- [ ] Branch is `<user>/<feature>` when `git config user.name` resolves and no prefix options are set.

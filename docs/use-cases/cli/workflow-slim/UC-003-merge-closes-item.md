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
| ID | UC-003 |
| Name | Merge on GitHub, then the item is `done` and its worktree is gone |
| Requirement reference | FR-001, FR-005, FR-007 |
| Goal | Landing on the default branch is the only close; kf notices it and finishes the item without a `shipping` stage or an "archive?" question |
| Primary actor | Maintainer |

## Supporting Actors
- `kf` (`kf status`, `kf sync`, `kf archive`, `archiveItem`, canonical docs, worktree teardown)
- GitHub (`gh pr view` merge state, issue close, project board)
- Hook `.kf/hooks/done.sh` (formerly `dones.sh`)

## Preconditions
- Review report `PASS` for the current execution with `ci` not red; `meta.pr` recorded (or `landing: none`).
- Legal stages are `brainstorm, planning, backlog, implementation, testing, review, done, cancelled`; `.works/done/` exists.

## Trigger
The maintainer merges the PR on GitHub, then any of `kf status --change <feature>`, `kf status --all`, `kf sync`, `kf archive <feature>` runs.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Sees a review item with PASS and a recorded PR; `checkMergeGate` reports MERGED | Close path entered (the same `archiveItem` transaction, no prompt) |
| 2 | kf | Refuses when the item worktree is dirty | Exit 1 naming the worktree; nothing moves |
| 3 | kf | Runs the `done` hook (AC gate, issue close, board → `statusMap.done`) | Hook outcome as today's dones hook |
| 4 | kf | Removes the item worktree and its route; deletes the merged branch locally and on origin (`git push origin --delete`), skipping the remote delete when the branch is already gone | No worktree, no branch |
| 5 | kf | Writes canonical docs: when the current checkout is on the default branch, clean and not behind `origin/<default>`, into the working tree as today; otherwise (checkout behind origin, or on a deploy branch) into a branch `docs/<context>-<feature>` cut from `origin/<default>` in a temporary worktree, committed `docs(<context>): sync canonical docs for <feature>`, not pushed, recorded in `meta.docsBranch` | Docs landed in exactly one place; the path or branch name printed |
| 6 | kf | Moves the folder to `.works/done/`, stamps `delivered`/`deliveredAt`/`status: archived` | `kf status` shows stage `done`, board Done, issue CLOSED |

## Alternative Flows
### A1 — nothing to land
- Trigger: review PASS with `landing: none`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The landing rule replaces the merge gate: the item branch must have 0 commits ahead of its base (`unmergedCommitCount === 0`), else the close refuses naming the count ("landing: none but the branch has N commits — open a PR or cancel"); then steps 2–6, deleting the empty branch locally and on origin when it was pushed | Item `done` on the next `kf status`, or refused |

### A2 — legacy folders
- Trigger: `.works/shipping/*` or `.works/dones/*` exist from an earlier version.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | On the first `kf status`/`kf sync` after upgrade, kf moves `dones/*` → `done/*` (stage rewritten in `.kfw.json`, history kept), and `shipping/*` → `review/*` when the recorded PR is unmerged, `done/*` when merged | One-time migration printed; the agent never moves folders by hand |

### A3 — `kf stage <feature> dones` / `shipping`
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Refused with the exact hints from the plan's Global Constraints: `dones` → `the stage is now done: a review PASS item closes on merge via kf status, kf sync or kf archive`; `shipping` → `shipping is gone: open the PR at review, merge on GitHub, kf status closes the item` | Exit 1 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| PR recorded but not merged | Close refuses; `kf status` prints `Next: merge <PR URL> on GitHub, then kf status` | Item stays in review ("awaiting merge") |
| PR closed without merge | Close refuses; status names the closed PR and asks the human | Item stays in review |
| `kf ship <feature>` | Exits 1: "kf ship is deprecated: review opens the PR; merge on GitHub; kf status closes the item" | Nothing written |
| Remote branch delete refused (protected or missing) | Local delete still happens; the remote outcome is reported, the close continues | `done` with a note |
| `statusMap` still has the legacy `dones` or `shipping` key | `dones` mapped to `done`, `shipping` dropped; `kf doctor` reports `statusmap_legacy` once and `--fix` rewrites the file | Board sync works |

## Postconditions
- Finished item in `.works/done/`: no worktree, no merged branch, issue closed, board Done, canonical docs stamped.
- Humans were never asked "ship or archive?" or "archive?".

## Business Rules
- `merge: manual` — kf never merges the PR.
- `kf archive` stays as the explicit form of the same transaction and is idempotent.
- `kf ship` remains only as a deprecated alias for one major version; `kf deliver` is not built.

## Data
- `.kfw.json`: `stage`, `meta.pr`, `meta.delivered`, `meta.deliveredAt`, `meta.worktree`.
- `.kf/config.json`: `project.statusMap.done`.
- Hooks: `.kf/hooks/done.sh`, `kanban-flow/github-hooks/done.sh`.

## Acceptance Criteria
- [ ] `kf stage x shipping` and `kf stage x dones` exit non-zero with the hints.
- [ ] After the PR is merged, `kf status --change x` shows stage `done`, no worktree, the branch deleted locally and on origin, board Done.
- [ ] An unmerged PR keeps the item in review and names the merge as the next step with the URL.
- [ ] Canonical docs land on `docs/<context>-<feature>` from `origin/main` when the checkout is behind origin or on a deploy branch.
- [ ] Legacy `.works/dones` and `.works/shipping` items migrate on the next `kf status`.

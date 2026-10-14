---
feature: archive-after-merge
context: cli
created: 20261011_1108
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Archive delivers a merged item |
| Requirement reference | FR-002, FR-006 |
| Goal | One `kf archive` performs the full delivery finalization — and the old `kf issues done`/`delivered.sh`/`statusMap.delivered` apparatus is gone |
| Primary actor | Human maintainer |

## Supporting Actors
- `gh` CLI; `dones` hook pack (`lib-github.sh`: AC gate, `sync_project_status`, `close_issue_done`); GitHub Projects board

## Preconditions
- Item in `review` with a current PASS review report (direction gate), or already in `dones` for reconcile.
- `meta.pr` merged or absent; validation gates green or explicitly forced.

## Trigger
`kf archive <feature>` on a delivery-ready item.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | cmdArchive | Merge check (UC-001) passes or `pr` absent | Gate cleared |
| 2 | cmdArchive | Artifact + direction gates (existing) | Refusal still possible, unchanged |
| 3 | `dones` hook | AC gate, board → `statusMap.dones`, `close_issue_done` | Issue closed, card on Done-status |
| 4 | cmdArchive | Worktree teardown if registered | Dirty worktree refuses (unchanged) |
| 5 | cmdArchive | Folder move review → dones | Item lands in `dones/` |
| 6 | cmdArchive | Canonical docs sync (features) | `docs/` mirrors stamped |
| 7 | cmdArchive | `delivered`/`deliveredAt` written to `.kfw.json` | Flag last — the terminal fact |

## Alternative Flows
### A1
- Trigger: item already in `dones` (reconcile)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Merge check → gates → hook re-run → docs resync → flag | No folder move; same finalization set, idempotent |

### A2
- Trigger: `kind: bug`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Same flow minus canonical docs (bugs own none) | Flag + hook still apply |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `dones` hook fails (AC unchecked) | Refuse before move — unchanged gate | Exit 1, item stays in review |
| Docs sync fails after move | Existing rollback restores folder + docs + meta | Exit 1 "feature restored to review"; flag never written |
| `--skip-hooks` passed | Hook skipped, recorded as bypass (unchanged) | Move + docs + flag still complete |

## Postconditions
- Item in `dones` with `delivered: true`, `deliveredAt`; issue closed; board at `statusMap.dones`; canonical docs synced.
- `delivered.sh`, `statusMap.delivered` and `kf issues done`'s original command no longer exist — `issues done` forwards to archive with a deprecation warning; `KFW_PROJECT_STATUS_DELIVERED` is never emitted.

## Business Rules
- `dones` == delivered. `delivered` records the fact, never gates re-execution.
- Finalization side effects are idempotent; mid-pass failure leaves the item re-runnable.

## Data
- `.kfw.json`: `delivered`, `deliveredAt`, `issue`, `pr`, `bypasses`
- `docs/requirement|use-cases|testplan/<ctx>/<feature>*`: canonical copies

## Acceptance Criteria
- [ ] Successful archive moves folder, syncs docs, closes issue, moves board to `statusMap.dones`, stamps `delivered` last
- [ ] Mid-pass failure leaves item re-runnable with rollback semantics unchanged
- [ ] `dones.sh` calls `close_issue_done`; `delivered.sh` absent from pack and `GITHUB_HOOK_PACK`
- [ ] `kf issues done` removed as a distinct command — deprecated alias forwards to `kf archive` with a warning
- [ ] `KFW_PROJECT_STATUS_DELIVERED` no longer emitted; `statusMap.delivered` in existing config parses without error and is flagged inert by `kf doctor`

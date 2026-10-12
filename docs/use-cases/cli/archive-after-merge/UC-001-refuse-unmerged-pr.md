---
feature: "archive-after-merge"
context: "cli"
created: "20261011_1108"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Archive refuses an unmerged PR |
| Requirement reference | FR-001 |
| Goal | `kf archive` must not finalize an item whose recorded PR is not verifiably merged — exit 1, zero side effects, no `--force` escape |
| Primary actor | Human maintainer |

## Supporting Actors
- `gh` CLI (merge-state verification)

## Preconditions
- Work item is in `review` or `dones` stage; `.kfw.json` records `pr` (via `kf issues link <f> <pr-url>` or `--pr`).
- `.kf/config.json` has `repository` configured.

## Trigger
`kf archive <feature>` (or `kf stage <feature> dones`, which delegates to archive).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | Runs `kf archive <feature>` | Archive entry point reached |
| 2 | cmdArchive | Reads `.kfw.json` → `meta.pr` present | Merge check required |
| 3 | cmdArchive | `gh pr view <pr> -R <repo> --json state` | State returned |
| 4 | cmdArchive | State is `OPEN` (or `CLOSED`-unmerged) | Refusal path |
| 5 | cmdArchive | Prints refusal naming the PR and its state | Exit 1; folder, docs, hook, flag untouched |

## Alternative Flows
### A1
- Trigger: `gh` reports state `MERGED`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Gate passes | Continue to UC-002 main flow |

### A2
- Trigger: item already in `dones` (legacy reconcile) with unmerged `pr`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Same merge check runs before reconcile | Same refusal — docs resync, hook, flag all skipped |

### A3
- Trigger: work item `kind: bug` with unmerged `pr`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Same merge check — kind does not exempt | Refusal identical to feature |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `gh` missing, unauthenticated, or the call fails | Treated as unverifiable → refuse | Exit 1 "cannot verify PR state"; nothing touched |
| `gh pr view` returns unparseable output | Unverifiable → refuse | Exit 1; nothing touched |
| `repository` absent from config while `pr` is set | Unverifiable → refuse | Exit 1 naming the missing config |
| `--force` passed | Ignored for this gate | Same refusal — merge gate has no bypass (AC-gate force semantics unchanged) |

## Postconditions
- On refusal: item unchanged in stage, `.kfw.json` untouched, no hook ran, no docs written, no board/issue effect.
- On MERGED: proceeds to UC-002.

## Business Rules
- Merge evidence is the recorded `pr` field only; absent `pr` means human confirmation (UC-003).
- `delivered` is written by archive only — never by a read path.

## Data
- `.kfw.json.pr`: PR URL, written by `kf issues link`
- `.kf/config.json.repository`: repo used for `gh pr view -R`

## Acceptance Criteria
- [ ] PR OPEN → exit 1, zero side effects
- [ ] PR CLOSED-unmerged → exit 1, zero side effects
- [ ] `gh` unverifiable (missing/failed/unparseable) → exit 1, zero side effects
- [ ] `--force` does not bypass the refusal
- [ ] Applies to `dones`-stage reconcile and `kind: bug` items identically

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
| ID | UC-006 |
| Name | `kf sync` sweeps PR-linked items |
| Requirement reference | FR-001, FR-002 |
| Goal | One command — runnable by hand or cron/launchd — archives every review/dones item whose recorded PR has merged |
| Primary actor | Human maintainer / cron |

## Supporting Actors
- `gh` CLI (`pr view` per item)

## Preconditions
- `.kf/config.json` has `repository` configured; zero or more items carry `meta.pr`.

## Trigger
`kf sync` (no arguments).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | cmdSync | Lists work items in `review` and `dones` with `meta.pr` | Candidate set |
| 2 | cmdSync | `gh pr view <pr> -R <repo> --json state` per candidate | Merge state per item |
| 3 | cmdSync | For each `MERGED`: invoke the `cmdArchive` finalization path | Item delivered (UC-002/UC-004) |
| 4 | cmdSync | Report per-item outcome + summary | `archived` / `skipped (open)` / `skipped (unverifiable)` / `failed` |

## Alternative Flows
### A1
- Trigger: no PR-linked items

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Report "nothing to sync" | Exit 0 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No `repository` configured | Same error as `kf issues` family | Exit 1 naming the missing config |
| `gh` missing / a `pr view` fails | That item reported unverifiable, skipped | Others still processed; exit 0 with warnings |
| One item's archive fails | Its error captured, sweep continues | Failed item listed in summary; exit 1 |

## Postconditions
- Every merged PR-linked item is delivered or reported; unmerged items untouched.

## Business Rules
- Sync never touches items without `meta.pr` — no-PR delivery is an explicit human `kf archive`.
- Sync inherits archive's merge gate — it adds reach, not a second opinion.

## Data
- `.kfw.json.pr` — the sweep predicate

## Acceptance Criteria
- [ ] `kf sync` archives each MERGED PR-linked item through the same finalization path
- [ ] OPEN/CLOSED/unverifiable items are skipped and reported, not archived
- [ ] A single failing item does not stop the sweep and is reported
- [ ] No `repository` → exit 1 with the standard guidance

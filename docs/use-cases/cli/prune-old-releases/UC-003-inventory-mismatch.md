---
feature: prune-old-releases
context: cli
created: 20261029_2105
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Live inventory no longer matches the spec snapshot — the run stops and asks |
| Requirement reference | FR-001, FR-004 |
| Goal | Never delete from a stale list; recompute or no-op when the live inventory differs |
| Primary actor | Maintainer |

## Supporting Actors
- `gh` CLI
- git

## Preconditions
- A dry-run list exists (spec snapshot or a previously printed plan).

## Trigger
Live `gh release list` / `git ls-remote` does not match the list about to be deleted, or there are fewer than five GitHub Releases.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | System | Compares live inventory to the pending plan | Mismatch or fewer than five detected |
| 2 | System | Prints the difference and does not delete | GitHub, tags, npm unchanged |
| 3 | Maintainer | Asks for a new dry-run if they still want to prune | Returns to UC-001 |

## Alternative Flows
### A1
- Trigger: Fewer than five GitHub Releases already.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Selector returns a no-op plan with a reason | No leftover-tag deletes either until a new list is confirmed |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Inventory cannot be read | Stop with the read error | Nothing deleted |

## Postconditions
- Nothing was deleted from the stale list.

## Business Rules
- Recompute keep/delete from live data at execution time.
- If the live top five differ from the spec snapshot, stop and ask.
- Confirmation never carries over to a different inventory.

## Data
- Pending plan vs live `{ releases, remoteTags }`.

## Acceptance Criteria
- [ ] A mismatched inventory aborts with no deletes.
- [ ] Fewer than five releases is a no-op that does not delete leftover tags.
- [ ] A new prune requires a new dry-run and a new confirm.

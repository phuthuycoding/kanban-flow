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
| ID | UC-001 |
| Name | Maintainer dry-runs the keep/delete sets and confirms |
| Requirement reference | FR-004, FR-005 |
| Goal | See the exact keep, delete-release and leftover-tag lists and confirm them before anything is deleted |
| Primary actor | Maintainer |

## Supporting Actors
- `gh` CLI
- git (`ls-remote --tags origin`)

## Preconditions
- `gh` is authenticated for `phuthuycoding/kanban-flow`.
- The selector helper is available.

## Trigger
The maintainer asks for a dry-run of the prune.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | System | Reads live GitHub Releases and remote tags | Inventory captured |
| 2 | System | Runs `selectPruneSets` and `formatPruneDryRun` | Prints keep (5), delete-releases, leftover-tags |
| 3 | Maintainer | Confirms that exact printed list | Confirmation recorded for that list only |
| 4 | System | Does not call `gh release delete`, `git push`, or npm | Registry and GitHub unchanged |

## Alternative Flows
### A1
- Trigger: Maintainer rejects the list.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | No deletes run | GitHub Releases, tags and npm stay as they were |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `gh` or `git ls-remote` fails | Stop, print the error | Nothing deleted |

## Postconditions
- No GitHub Release, git tag, or npm version has changed.

## Business Rules
- Confirmation applies only to the printed list. A new inventory needs a new dry-run.
- npm is never called.

## Data
- Dry-run plan: `{ keep, deleteReleases, leftoverTags }` from live inventory.

## Acceptance Criteria
- [ ] Dry-run prints keep, delete-releases and leftover-tags.
- [ ] No delete command runs before the human confirms that list.
- [ ] npm is not invoked.

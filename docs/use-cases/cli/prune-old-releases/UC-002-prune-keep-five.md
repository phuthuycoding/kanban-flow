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
| ID | UC-002 |
| Name | Maintainer prunes GitHub Releases and leftover tags; five newest remain |
| Requirement reference | FR-001, FR-002, FR-003, FR-006 |
| Goal | After a confirmed dry-run, only the five newest GitHub Releases and their tags remain on origin |
| Primary actor | Maintainer |

## Supporting Actors
- `gh` CLI
- git

## Preconditions
- UC-001 succeeded for the current inventory.
- npm version list has been snapshotted.

## Trigger
The maintainer confirmed the printed dry-run list.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | System | Re-reads live inventory and asserts it still matches the confirmed plan | Match; continue |
| 2 | System | For each delete-release tag: `gh release delete <tag> --yes --cleanup-tag` | GitHub Release and its tag gone |
| 3 | System | For each leftover tag still on origin: delete the remote tag | Installer/pre-rewrite tags gone |
| 4 | System | `gh release list`, `git ls-remote --tags origin`, `npm view` | Five releases, five tags, npm snapshot unchanged |

## Alternative Flows
### A1
- Trigger: `gh release delete --cleanup-tag` already removed a tag that is also in leftoverTags.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Leftover pass skips that tag | Continue step 3 with the rest |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `gh release delete` fails for one tag | Stop; log the failed tag and the remainder | Already-deleted items stay deleted; remainder untouched |

## Postconditions
- Exactly five GitHub Releases remain; Latest is the newest kept tag.
- Remote tags equal those five (plus peeled `^{}` refs).
- npm versions match the pre-prune snapshot.

## Business Rules
- Keep set is `publishedAt` descending, tie-break tag name descending. Semver is not used.
- Spec-time expectation: keep `v0.13.0`, `v0.12.0`, `v0.11.5`, `v0.11.4`, `v0.11.3`.
- Do not recreate a deleted release.

## Data
- Confirmed plan from UC-001.
- Pre-prune npm version snapshot.

## Acceptance Criteria
- [ ] `gh release list` returns exactly five rows, the five newest by `publishedAt`.
- [ ] Latest is the newest kept tag.
- [ ] `git ls-remote --tags origin` lists only those five tags.
- [ ] npm versions match the pre-prune snapshot.

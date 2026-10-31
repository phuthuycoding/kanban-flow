---
feature: archive-after-merge
context: cli
created: 20261011_1108
status: archived
---
# Use Case

> **Partly superseded by `workflow-slim`:** the stage `dones` and the human `kf archive` run after the merge no longer hold — the stage is `done` (`done.sh`, `statusMap.done`; `kf stage <feature> dones` is refused, legacy `.works/dones/` items are migrated once), and the next `kf status --change <feature>` or `kf sync` closes a merged review-PASS item (`kf archive` remains a close path), removing the worktree and deleting the merged branch. The merged-PR delivery gate still holds. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Archive without PR evidence |
| Requirement reference | FR-003 |
| Goal | An item with no recorded `pr` archives on the human's explicit run — the invocation itself is the delivery confirmation |
| Primary actor | Human maintainer |

## Supporting Actors
- `dones` hook pack (when `issue` is linked)

## Preconditions
- Item in `review` (PASS) or `dones`; `.kfw.json` has no `pr` field.

## Trigger
`kf archive <feature>`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | cmdArchive | `meta.pr` absent → merge check skipped | Human run = confirmation |
| 2 | cmdArchive | Normal gate + finalization flow (UC-002) | Item delivered |

## Alternative Flows
### A1
- Trigger: no `issue` linked either

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Proceed + warn "no linked issue — tracker has no delivery record" | Archive completes; warning in output |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `pr` field present but empty string | Treated as absent | Proceeds (warn per A1 if also no issue) |

## Postconditions
- Item delivered; flag stamped; warning emitted when the tracker has no linked issue.

## Business Rules
- Human confirmation is always sufficient evidence — the merge gate exists to *refuse* contradicted delivery, never to demand PRs.
- `kf sync` never auto-archives no-PR items — they stay an explicit human decision.

## Data
- `.kfw.json.pr`: absent → gate skipped

## Acceptance Criteria
- [ ] `kf archive` on a no-`pr` item succeeds (gates permitting)
- [ ] Missing `issue` produces a warning, not a refusal
- [ ] Same behavior for features and bugs

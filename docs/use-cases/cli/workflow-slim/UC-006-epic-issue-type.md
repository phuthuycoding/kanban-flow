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
| ID | UC-006 |
| Name | Epic issue type exists; #95 is an Epic |
| Requirement reference | FR-010 |
| Goal | The repository's issue-type catalog has `Epic`, issue #95 (travel) carries it, and `gh issue create --type Epic` works — a GitHub catalog change, not a kf command |
| Primary actor | Maintainer (with the agent running `gh`) |

## Supporting Actors
- GitHub REST API (`/repos/{owner}/{repo}/issue-types`, issue `type` field), `gh api`, `gh issue edit`

## Preconditions
- `gh` is authenticated as a user who administers `phuthuycoding/kanban-flow`.
- Today the catalog lists Task (53025915), Bug (53025916), Feature (53025917); #95 has `type: null`; the org-level issue-types API returns 404 because the repo is user-owned.

## Trigger
The maintainer runs the step during this work item (it is in scope as GitHub work, FR-010), with the agent executing the commands.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | `gh api repos/phuthuycoding/kanban-flow/issue-types` — read the live catalog | Confirms Epic is absent |
| 2 | Agent | Attempts to create the type through the API available to this repository (repository- or owner-level issue-types endpoint), name `Epic`, with a description | Type created, or the API refuses |
| 3 | Agent | `gh issue edit 95 --type Epic` (or the GraphQL `updateIssueIssueType` mutation when the CLI flag is unavailable) | #95 `type.name == Epic` |
| 4 | Agent | `gh issue create --type Epic --title "<probe>" --body "<probe>"` in dry form, or verifies via `gh issue create --help` that the type is accepted; closes the probe if one was created | Acceptance evidence recorded in the testing report |

## Alternative Flows
### A1 — type already present
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Skip step 2 | Continue at step 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The API cannot create issue types on a user-owned repository (404 / 403) | Stop; print the GitHub settings URL where a human can enable or create the type; record the blocker in the testing report; do **not** close #100 and do **not** fake the type with a label | FR-010 BLOCKED, named |
| `gh issue edit --type` not supported by the installed `gh` | Use the GraphQL mutation; if that fails too, report | Named blocker |

## Postconditions
- `GET …/issue-types` includes `Epic`; #95's type is `Epic`; #100 can be closed by the human.

## Business Rules
- No kf command is invented for issue types.
- Only this repository's catalog changes.

## Data
- GitHub: issue-type catalog of `phuthuycoding/kanban-flow`; issue #95 `type`.

## Acceptance Criteria
- [ ] `GET .../issue-types` includes Epic; issue #95 `type.name` is Epic.
- [ ] `gh issue create --type Epic` succeeds on this repo (probe closed afterwards).
- [ ] If the API forbids it: the settings URL and the blocker are in the testing report; #100 stays open.

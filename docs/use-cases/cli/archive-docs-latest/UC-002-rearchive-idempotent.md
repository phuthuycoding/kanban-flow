---
feature: archive-docs-latest
context: cli
created: 20261013_1513
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Re-archive in dones stays idempotent with stamped docs |
| Requirement reference | FR-003 |
| Goal | Re-running archive on a dones item neither refuses on its own stamping nor overwrites real edits. |
| Primary actor | Maintainer/agent |

## Supporting Actors
- `kf archive` dones reconcile path; `kf sync`; `kf stage <feature> dones` after a cancel reopen

## Preconditions
- Item is in `dones` with canonical docs present.

## Trigger
`kf archive <feature>` on an item already in dones.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Maintainer/agent | Runs `kf archive <feature>` | Dones reconcile path starts |
| 2 | kf archive | Builds canonical content and compares with each existing doc | Identical docs count as unchanged |
| 3 | kf archive | Writes copies, re-runs the dones hook, keeps `delivered` | Exit 0, no bypass recorded |

## Alternative Flows
### A1
- Trigger: existing doc was written unstamped by an older version

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Stamp the existing doc with the same transform and compare | Equal → counts as unchanged; doc upgraded to `archived` at step 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A canonical doc was hand-edited after archive (e.g. superseded banner) | Refuse with `Canonical docs have changed since archive` | Exit 1; `--skip-specs` keeps the edit, `--force` restores and records a bypass |

## Postconditions
- Unchanged and legacy docs end stamped; edited docs untouched unless forced.

## Business Rules
- Normalization applies only to the existing doc through the same transform archive writes.

## Data
- `.kfw.json` `bypasses` only on a real `--force`.

## Acceptance Criteria
- [ ] Re-archive with unchanged docs exits 0 and records no bypass.
- [ ] A hand-edited canonical doc is still refused.
- [ ] Legacy unstamped docs are upgraded without refusal or bypass.

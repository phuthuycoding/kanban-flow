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
| ID | UC-004 |
| Name | Re-run reconciles legacy dones items |
| Requirement reference | FR-004 |
| Goal | Items archived before this feature (in `dones`, possibly with `delivered` from `kf issues done`) get docs resync + hook + flag from one `kf archive` re-run |
| Primary actor | Human maintainer |

## Supporting Actors
- `dones` hook pack; `gh` CLI (only when `pr` recorded)

## Preconditions
- Item already in `dones` (status `archived`), any prior flag state.

## Trigger
`kf archive <feature>` on a dones-stage item.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | cmdArchive | Merge check (only when `pr` recorded — unmerged refuses, UC-001) | Gate cleared |
| 2 | cmdArchive | Validation gates (existing changed-docs refusal preserved) | Refusal paths unchanged |
| 3 | `dones` hook | AC gate + board → `statusMap.dones` + `close_issue_done` re-run | Idempotent — closed issue/moved card are no-ops |
| 4 | cmdArchive | Canonical docs resync (features; changed-docs protection intact) | Docs current |
| 5 | cmdArchive | `delivered`/`deliveredAt` written | Legacy item gains the flag |

## Alternative Flows
### A1
- Trigger: item already carries `delivered` (archived then `issues done`'d under 0.8.0)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Flag honored; reconcile still re-verifies side effects | Output notes "already delivered — re-checked side effects" |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Canonical docs changed since archive | Existing refusal (`--skip-specs` / `--force` semantics unchanged) | Exit 1 listing changed docs |
| Hook fails (AC gate) | Reconcile refused — side-effect order means no partial flag | Exit 1; flag not written |

## Postconditions
- Item remains in `dones`; docs, board, issue and flag all current.

## Business Rules
- Every finalization effect is safe to re-run; `delivered` never blocks re-execution.
- The flag asserts "archive ran as delivery", not that every GitHub side effect succeeded (those stay fail-open).

## Data
- `.kfw.json.delivered`, `.deliveredAt` — honored when present, written when absent

## Acceptance Criteria
- [ ] Re-archive on dones item resyncs docs, re-runs the dones hook, stamps `delivered`
- [ ] Repeat run is a no-op-safe reconcile, not an error
- [ ] Existing `--skip-specs`/`--force`/changed-docs behavior unchanged

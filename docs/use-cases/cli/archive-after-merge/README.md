---
feature: archive-after-merge
context: cli
created: 20261011_1108
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Archive refuses an unmerged PR | [UC-001](UC-001-refuse-unmerged-pr.md) | Human maintainer | implemented |
| UC-002 | Archive delivers a merged item | [UC-002](UC-002-archive-delivers-merged-item.md) | Human maintainer | implemented |
| UC-003 | Archive without PR evidence | [UC-003](UC-003-archive-without-pr.md) | Human maintainer | implemented |
| UC-004 | Re-run reconciles legacy dones items | [UC-004](UC-004-reconcile-legacy-dones.md) | Human maintainer | implemented |
| UC-005 | Awaiting-merge state is visible | [UC-005](UC-005-awaiting-merge-visibility.md) | Human maintainer | implemented |
| UC-006 | `kf sync` sweeps PR-linked items | [UC-006](UC-006-sync-sweeps-pr-linked-items.md) | Human maintainer / cron | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001 | TC-001…TC-006 | Refusal for OPEN/CLOSED/unverifiable PR, on both stages, for bugs, no `--force` escape |
| UC-002 | FR-002, FR-006 | TC-007…TC-010, TC-021, TC-022 | Ordered finalization, flag last, `dones.sh` close restored, delivered apparatus removed |
| UC-003 | FR-003 | TC-011…TC-013 | No-PR proceed + no-issue warning, bugs included |
| UC-004 | FR-004 | TC-014, TC-015 | Idempotent reconcile: docs resync + hook + flag |
| UC-005 | FR-005, FR-007 | TC-016…TC-018 | status/doctor surface awaiting states; docs teach new semantics |
| UC-006 | FR-001, FR-002 | TC-019, TC-020 | Sweep archives merged items, skips the rest |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 6 |
| Actors | 3 |
| Functional requirements covered | 7 |
| Test cases linked | 22 |

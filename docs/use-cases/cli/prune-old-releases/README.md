---
feature: prune-old-releases
context: cli
created: 20261029_2105
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Maintainer dry-runs the keep/delete sets and confirms | [UC-001](UC-001-dry-run-confirm.md) | Maintainer | implemented |
| UC-002 | Maintainer prunes GitHub Releases and leftover tags; five newest remain | [UC-002](UC-002-prune-keep-five.md) | Maintainer | implemented |
| UC-003 | Live inventory no longer matches the spec snapshot — the run stops and asks | [UC-003](UC-003-inventory-mismatch.md) | Maintainer | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-004, FR-005 | TC-004, TC-007 | Dry-run prints lists; no delete and no npm call until confirm |
| UC-002 | FR-001, FR-002, FR-003, FR-006 | TC-001, TC-002, TC-003, TC-005 | Keep five by publishedAt; delete other releases and leftover tags |
| UC-003 | FR-001, FR-004 | TC-006, TC-008 | Recompute at execution; mismatch or fewer-than-five is a no-op that asks |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 3 |
| Actors | 1 |
| Functional requirements covered | 6 |
| Test cases linked | 8 |

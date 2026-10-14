---
feature: ade-sync
context: worktree
created: 20261014_2111
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Create worktree attaches into running ADEs | [UC-001](UC-001-create-attach-ades.md) | Developer | implemented |
| UC-002 | Create worktree with no ADE reachable | [UC-002](UC-002-create-no-ade.md) | Developer | implemented |
| UC-003 | Adapter failure degrades to warning | [UC-003](UC-003-adapter-failure-warning.md) | Developer | implemented |
| UC-004 | Remove worktree detaches ADE state | [UC-004](UC-004-remove-detach.md) | Developer | implemented |
| UC-005 | Add a new ADE adapter | [UC-005](UC-005-add-adapter.md) | kf maintainer | implemented |
| UC-006 | `kf worktree sync` broadcasts the current worktree | [UC-006](UC-006-worktree-sync.md) | Developer | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-003, FR-004, FR-008 | TC-001, TC-003, TC-004, TC-005, TC-006, TC-008, TC-011, TC-012 | covers attach + verify + prefix resolution |
| UC-002 | FR-001, FR-007 | TC-002, TC-010 | covers silent no-op + opt-out |
| UC-003 | FR-006 | TC-007, TC-008 | covers warning-not-failure |
| UC-004 | FR-005 | TC-009 | covers Herdr workspace close on remove |
| UC-005 | FR-002 | TC-013 | covers registry extension without lifecycle edits |
| UC-006 | FR-001, FR-009 | TC-014, TC-015 | covers sync-here / sync-one / sync-all |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 6 |
| Actors | 2 (developer, kf maintainer) — ADE apps act as supporting systems |
| Functional requirements covered | 9 |
| Test cases linked | 15 |

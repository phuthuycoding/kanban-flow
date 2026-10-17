---
feature: worktree-opt-out
context: worktree
created: 20261017_1750
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Default-off: no provisioning on implementation | [UC-001](UC-001-default-off-no-provisioning.md) | Project owner / agent | implemented |
| UC-002 | Opt-in: provisioning unchanged when enabled | [UC-002](UC-002-opt-in-provisions.md) | Project owner / agent | implemented |
| UC-003 | Doctor stays silent about domain infra when disabled | [UC-003](UC-003-doctor-silent-when-disabled.md) | Project owner | implemented |
| UC-004 | Operator commands + legacy teardown under default-off | [UC-004](UC-004-operator-commands-and-teardown.md) | Project owner | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-003 | default-off stage move creates nothing |
| UC-002 | FR-001, FR-002 | TC-002, TC-004 | enabled:true reproduces today's provisioning |
| UC-003 | FR-003 | TC-005 | no infra finding or setup suggestion when disabled |
| UC-004 | FR-004 | TC-006, TC-007 | worktree commands work; recorded worktree tears down |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 2 |
| Functional requirements covered | 5 |
| Test cases linked | 7 |

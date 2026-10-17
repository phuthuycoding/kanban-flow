---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Move a PASS-reviewed item into shipping | [UC-001](UC-001-move-to-shipping.md) | Agent | implemented |
| UC-002 | `kf ship` publishes branch + PR, records `meta.pr` | [UC-002](UC-002-ship-publish.md) | Agent | implemented |
| UC-003 | Manual merge: ship reports waiting, resumes after merge | [UC-003](UC-003-manual-merge-resume.md) | Agent + human | implemented |
| UC-004 | Post-merge: release + changelog steps | [UC-004](UC-004-release-changelog.md) | Agent | implemented |
| UC-005 | Archive a shipped item (`shipping → dones`) | [UC-005](UC-005-archive-shipped.md) | Agent | implemented |
| UC-006 | Archive a non-code item directly from review | [UC-006](UC-006-archive-direct.md) | Agent | implemented |
| UC-007 | No `ship` config → unchanged legacy pipeline | [UC-007](UC-007-no-ship-config.md) | Project owner | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002, TC-003 | stage exists; PASS-gated entry |
| UC-002 | FR-005 | TC-005 | PR created + recorded, idempotent |
| UC-003 | FR-006, FR-008 | TC-006, TC-007 | manual wait + resume; overrides honoured |
| UC-004 | FR-007, FR-008 | TC-007 | release/changelog per flags, recorded |
| UC-005 | FR-003 | TC-008 | archive from shipping incl. unmerged refusal |
| UC-006 | FR-003 | TC-008 | direct review→dones unchanged |
| UC-007 | FR-004, FR-011 | TC-004, TC-009 | absent block = legacy; sync sweeps shipping |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 7 |
| Actors | 3 |
| Functional requirements covered | 11 |
| Test cases linked | 9 |

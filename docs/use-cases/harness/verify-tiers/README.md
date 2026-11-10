---
feature: verify-tiers
context: harness
created: 20261109_1700
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Verify a task on its related tests | [UC-001](UC-001-task-tier.md) | Agent session | implemented |
| UC-002 | Verify a wave with the full suite | [UC-002](UC-002-wave-verify.md) | Agent session | implemented |
| UC-003 | Hold the next wave until its predecessor's suite passes | [UC-003](UC-003-wave-barrier.md) | kf CLI (kf next) | implemented |
| UC-004 | Trace a wave failure back to a task | [UC-004](UC-004-wave-failure.md) | Agent session | implemented |
| UC-005 | Reuse the last wave's record at the gates | [UC-005](UC-005-gate-reuse.md) | Agent session | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007 | related config, task tier on both paths, deletions and renames, unchanged without related, failures, bug tasks |
| UC-002 | FR-003, FR-004, FR-007 | TC-008, TC-009, TC-010, TC-011, TC-012, TC-013 | wave run, record and log, bad input, no worktree, record reader, ledger lines and kf record, loop-stats |
| UC-003 | FR-004 | TC-014, TC-015, TC-016, TC-017, TC-018 | wave action, developer hold, release and re-owe, barrier off without stage, resume, liveness |
| UC-004 | FR-005 | TC-019, TC-020 | Wave verify decide, reopen by wave, decided note, exit 3 |
| UC-005 | FR-006, FR-008, FR-009 | TC-021, TC-022, TC-023, TC-024 | gate on the wave record, this repository's config, skills and docs |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 5 |
| Actors | 3 |
| Functional requirements covered | 9 |
| Test cases linked | 24 |

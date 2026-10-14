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
| ID | UC-003 |
| Name | Agent reconciles docs superseded by the new feature |
| Requirement reference | FR-004, FR-005, FR-006, FR-007 |
| Goal | Earlier features' canonical docs never contradict the behavior a newly archived feature delivers. |
| Primary actor | Agent running kanban-archive |

## Supporting Actors
- Human reviewing the docs PR

## Preconditions
- Feature has PASS reports and its change has merged.

## Trigger
`kanban-archive` reaches step "2b. Reconcile superseded docs".

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | Reads `reconcile.md`, the spec's `## Affected surfaces` and the plan's Documentation Impact | Candidate behaviors listed |
| 2 | Agent | Greps `docs/requirement`, `docs/use-cases`, `docs/testplan`, `docs/workflow` for those behaviors | Contradicting docs found |
| 3 | Agent | Adds `> **Superseded by <feature>.** <what changed>` under the title of each contradicted requirement / UC index / UC file / test plan | Old snapshot bodies kept, marked |
| 4 | Agent | Updates `docs/workflow/*` text to the new behavior | Workflow docs current |
| 5 | Agent | Fills the feature report `## Docs Reconciled` section | Reconcile visible at review |
| 6 | Agent | Runs `kf archive`, then commits docs as `docs({context}): sync canonical docs for {feature}` on its own branch/PR | Docs land after the merge |

## Alternative Flows
### A1
- Trigger: no earlier doc describes the changed behavior

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Record `None — <reason>` in `## Docs Reconciled` | Continue at step 6 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Superseding is partial or unclear | Banner names only the replaced part; ask the human when the scope is ambiguous | No body rewrite of another feature's snapshot |

## Postconditions
- No canonical doc contradicts current behavior without a superseded marker.

## Business Rules
- Never rewrite another feature's snapshot body; mark it.
- A banner on an older feature makes its re-archive report changed docs; `--skip-specs` keeps it.

## Data
- Feature report `## Docs Reconciled` section.

## Acceptance Criteria
- [ ] `kanban-archive` SKILL.md has the reconcile step and links an existing `reconcile.md`.
- [ ] Git handoff names `docs({context}): sync canonical docs for {feature}`.
- [ ] Feature report template has `## Docs Reconciled`.
- [ ] done-trigger UC-001 carries a superseded banner.

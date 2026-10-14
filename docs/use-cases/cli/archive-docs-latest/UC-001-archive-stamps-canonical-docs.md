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
| ID | UC-001 |
| Name | Archive stamps every canonical doc as archived |
| Requirement reference | FR-001, FR-002, FR-007 |
| Goal | Canonical docs left by `kf archive` declare themselves archived, and delivered use cases read `implemented`. |
| Primary actor | Maintainer/agent |

## Supporting Actors
- `kf archive` (canonical docs sync)

## Preconditions
- Feature in `review` with current PASS testing and review reports and a feature report; recorded PR merged or none recorded.

## Trigger
`kf archive <feature>` (or `kf stage <feature> dones`).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Maintainer/agent | Runs `kf archive <feature>` | Gates pass |
| 2 | kf archive | Reads each source artifact and builds its canonical content | Requirement, UC index, UC files, diagram, test plan get `status: archived` in frontmatter |
| 3 | kf archive | Rewrites UC index links and the Status cells of its "Use Case Files" table | `planned` → `implemented`; coverage table untouched |
| 4 | kf archive | Copies the testing result as-is | Result keeps `status: PASS` |
| 5 | kf archive | Writes all copies and moves the item to dones | Canonical docs reflect a delivered feature |

## Alternative Flows
### A1
- Trigger: a source artifact has no frontmatter

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Copy the source unchanged | Archive continues at step 3 |

### A2
- Trigger: one-time backfill of docs archived by earlier versions

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Run the same canonical transform over existing `docs/use-cases|testplan` files | No canonical doc keeps `status: planning` |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A source artifact is missing | Existing error `Cannot sync canonical docs: missing source artifact` | Archive refused, previous docs rolled back |

## Postconditions
- Every canonical copy with frontmatter except the testing result carries `status: archived`.
- UC index rows read `implemented`.

## Business Rules
- `.works/` artifacts are never modified; only canonical copies are transformed.
- Only the "Use Case Files" table Status column changes.

## Data
- Canonical docs: `docs/requirement|use-cases|testplan/{context}/{feature}`.

## Acceptance Criteria
- [ ] Canonical UC index, UC files, diagram and test plan contain `status: archived`; the result keeps `status: PASS`.
- [ ] UC index rows read `implemented`; the coverage table is unchanged.
- [ ] A source without frontmatter is copied unchanged.

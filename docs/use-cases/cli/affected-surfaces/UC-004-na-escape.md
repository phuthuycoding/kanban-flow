---
feature: "affected-surfaces"
context: "cli"
created: "20261012_1935"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | N/A escape for code-only changes |
| Requirement reference | FR-002 |
| Goal | A feature touching no user-facing surface declares it honestly — one line, no ceremony |
| Primary actor | Human maintainer |

## Supporting Actors
- `checkStageGate`, `checkTraceability`

## Preconditions
- Feature spec in brainstorm touching no docs/landing/help surfaces

## Trigger
Human writes `N/A` as the sole content of `## Affected surfaces`, then stages to planning.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Human | `## Affected surfaces` body = `N/A` (any case) | honest declaration |
| 2 | `checkStageGate` | Section has real content → passes | brainstorm → planning allowed |
| 3 | `checkTraceability` | `N/A` short-circuits coverage check | no warnings downstream |

## Alternative Flows
### A1 — `N/A` plus real bullets
- Trigger: section lists `N/A` and also surface names

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Gate passes (real content); coverage check treats real bullets as declared (`N/A` line ignored) | warn applies to the named surfaces only |

## Postconditions
- Code-only features pay one line of honesty, not a ceremony
- The escape is visible in the spec — a human reviewing the contract sees the `N/A` claim and can challenge it

## Acceptance Criteria
- [ ] `N/A` (and `n/a`, `N/A.` variants after trim) passes the gate
- [ ] `N/A` sections produce zero coverage warnings
- [ ] `N/A` alongside real bullets does not exempt the named surfaces

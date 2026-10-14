---
feature: affected-surfaces
context: cli
created: 20261012_1935
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Validate warns on uncovered surface |
| Requirement reference | FR-003 |
| Goal | A declared surface absent from the plan produces a visible WARNING, never a silent miss |
| Primary actor | Agent / maintainer |

## Supporting Actors
- `checkTraceability` validation
- `kf validate`, `kf status`, `kf approve` (all consume `validateFeature`)

## Preconditions
- Item is `kind: feature` in `planning` or later
- Spec has a filled `## Affected surfaces` with real items (not `N/A`)
- `phase-2-implementation-plan.md` exists

## Trigger
`kf validate --change <feature>` (or any path through `validateFeature`).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | `checkTraceability` | Parse declared surface lines from the spec section | surface list |
| 2 | `checkTraceability` | Search the plan text for each surface's words (case-insensitive) | coverage per surface |
| 3 | `checkTraceability` | Emit WARNING `affected_surface_uncovered` per uncovered surface | warning lists the surface name |
| 4 | Human | Sees the warning in validate output before approving | adds coverage or edits the spec |

## Alternative Flows
### A1 — `N/A` section
- Trigger: sole content is `N/A`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Check short-circuits — nothing to cover | no warnings |

### A2 — plan missing
- Trigger: no `phase-2-implementation-plan.md` (still in early planning)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Every declared surface warns | honest — there is no coverage yet; other artifact checks handle the missing plan |

### A3 — false positive on naming
- Trigger: surface spelled differently in the plan

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Warning still fires | human reads the named surface and decides — WARNING never blocks |

## Postconditions
- Warnings are informational: `validate` still passes (unless `--strict`), `kf stage` unaffected
- Specs without the section (legacy, bug) produce no findings from this check

## Acceptance Criteria
- [ ] Uncovered declared surface → WARNING naming the surface
- [ ] Covered surface → silent
- [ ] `N/A`, missing section, bug kind, brainstorm stage → no findings
- [ ] Warning is non-blocking (valid still true without `--strict`)

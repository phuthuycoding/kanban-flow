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
| ID | UC-001 |
| Name | Spec gate refuses unfilled surfaces |
| Requirement reference | FR-001, FR-002 |
| Goal | A feature spec cannot leave brainstorm without a real `## Affected surfaces` declaration |
| Primary actor | Human maintainer (via `kf stage` / `kf validate`) |

## Supporting Actors
- `checkStageGate` artifact gate

## Preconditions
- Work item is a `kind: feature` (or unset kind) in `brainstorm`
- Spec file exists and is otherwise filled

## Trigger
Human runs `kf stage <feature> planning` or `kf validate --change <feature>` on a spec whose `## Affected surfaces` section is absent or without real content.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Human | Run `kf stage <feature> planning` | transition attempt |
| 2 | `checkStageGate` | Parse spec body for `## Affected surfaces`; inspect content | section absent or placeholder/comment-only/empty |
| 3 | `checkStageGate` | Emit ERROR `affected_surfaces_missing` | `gate_blocked` finding, exit 1 |
| 4 | Human | Add the section — real lines or `N/A` | re-run passes that check |

## Alternative Flows
### A1 — section missing entirely
- Trigger: spec lacks the `## Affected surfaces` heading (custom template, deliberate deletion, legacy spec still in brainstorm)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Same refusal as main flow — `affected_surfaces_missing` | human adds the heading + content |

### A2 — placeholder untouched
- Trigger: spec still contains `{affected_surfaces}`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Existing `isFilledFile` check already refuses (`gate_blocked` / `artifact_unfilled`) | new check agrees — either way it cannot pass |

### A3 — comment-only or empty section body
- Trigger: heading present, body contains only the template's suggestion comment or whitespace

| Step | Action | Outcome / return to main flow |
|---|---|---|
| 1 | Content check finds no real line → `affected_surfaces_missing` | human writes `N/A` or real surfaces |

## Postconditions
- Refusal is a finding, exit 1, zero side effects — no folder move, no meta write
- Bug items and non-brainstorm stages never hit this check

## Acceptance Criteria
- [ ] Missing heading → ERROR at brainstorm stage
- [ ] Placeholder/comment/empty-only body → ERROR
- [ ] `N/A` or any real bullet line → no finding
- [ ] `kind: bug` and stages other than `brainstorm` → check never fires

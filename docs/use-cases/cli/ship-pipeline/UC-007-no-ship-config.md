---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-007 |
| Name | No `ship` config → unchanged legacy pipeline |
| Requirement reference | FR-004, FR-011 |
| Goal | A project without a `ship` block experiences zero behavioural change; `kf ship` explains itself instead of failing weirdly |
| Primary actor | Project owner |

## Supporting Actors
- `kf sync` sweep

## Preconditions
- `.kf/config.json` has no `ship` block (or `enabled: false`)

## Trigger
Normal pipeline usage; optionally `kf ship <feature>` or `kf sync`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner | works items through stages | every gate identical to pre-feature |
| 2 | Owner | runs `kf ship <f>` anyway | prints manual checklist for the item + how to enable; exit 1 |
| 3 | kf | `kf sync` runs | sweeps `shipping` items with merged PRs too (harmless when unused) |

## Alternative Flows
### A1
- Trigger: human still routes an item into `shipping` manually

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | stage is generic state — allowed from review+PASS regardless of `ship.enabled` | ship steps then run as manual; archive still delivers |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `ship` block with wrong field types | config error naming file + field (existing style) | pipeline untouched |

## Postconditions
- Legacy projects observe no difference

## Business Rules
- `ship.enabled` gates the automation, not the stage; the stage is generic pipeline state.

## Data
- `ship` config block; `meta.ship` only exists after `kf ship` ran

## Acceptance Criteria
- [ ] No `ship` block → identical pipeline end-to-end (hard gate)
- [ ] `kf ship` on disabled project prints manual checklist and writes nothing
- [ ] `kf sync` includes `shipping` in its merged-PR sweep

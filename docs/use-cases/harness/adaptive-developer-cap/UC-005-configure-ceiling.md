---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Set the ceiling in config and read it from kf tasks --json |
| Requirement reference | FR-004, FR-007, FR-008 |
| Goal | Bound the parallelism of a project whose tests cannot take many suites at once |
| Primary actor | Human (project owner) |

## Supporting Actors
- `kf` CLI

## Preconditions
- `.kf/config.json` exists

## Trigger
The human sets `harness.developers.max` and a controller runs `kf tasks <f> --json`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Human | Sets `"harness": { "developers": { "max": 3 } }` | Config saved |
| 2 | kf | `validateHarness` accepts an integer 1..16 | Config loads |
| 3 | Controller | Runs `kf tasks <f> --json` | Output carries `developers: {max: 3, source: "config"}` |

## Alternative Flows
### A1
- Trigger: Key absent

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `developers: {max: 6, source: "default"}` | Return to the main flow |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| max 0, 17, 2.5 or "4" | Command fails | `harness.developers.max must be an integer from 1 to 16` |
| `harness.developers` not an object | Command fails | `harness.developers must be an object { max? }` |

## Postconditions
- Legacy harness keys still carried through and reported by `kf doctor`

## Business Rules
- Range 1..16, default 6
- `harness.parallel` stays a legacy key

## Data
- Ledger: `<item>/loop/progress.md` cap rulings, wait lines, rerun notes
- Config: `.kf/config.json` `harness.developers.max`

## Acceptance Criteria
- [ ] `kf tasks --json` reports the validated ceiling and its source
- [ ] README and harness.md document the key
- [ ] Issue #126 states the chosen design

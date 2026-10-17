---
feature: command-tree
context: cli
created: 20261017_1750
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Legacy flat spelling keeps working |
| Requirement reference | FR-003, FR-005 |
| Goal | Every one of the 27 existing spellings behaves byte-for-byte identical through the alias layer |
| Primary actor | Scripts / agent |

## Supporting Actors
- Project hooks, CI, skill text still using flat names

## Preconditions
- Any existing flat command (`kf new`, `kf stage`, `kf archive`…)

## Trigger
Invocation with a legacy spelling

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | caller | runs `kf stage <f> implementation` | argv enters resolver |
| 2 | resolver | alias → canonical path `feature move` | leaf node resolved |
| 3 | dispatcher | same handler + same spec | identical `CmdResult` |

## Alternative Flows
### A1
- Trigger: `kf help <alias>` (e.g. `kf help stage`)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | alias resolves to canonical node | prints canonical usage + names the canonical path |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Alias removed by accident in registry | equivalence test fails | caught at test time |

## Postconditions
- Identical stdout/stderr/exit code to pre-tree behaviour

## Business Rules
- Aliases are silent: no deprecation warnings; discovery happens via `help`.

## Data
- alias map in the tree registry

## Acceptance Criteria
- [ ] Table-driven equivalence test passes for every legacy spelling
- [ ] `kf help <alias>` names the canonical path

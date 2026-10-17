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
| ID | UC-004 |
| Name | `kf bug finish` on a feature-kind item refuses |
| Requirement reference | FR-002 |
| Goal | The noun acts as a kind check so the wrong verb family can't operate on the wrong item |
| Primary actor | Agent |

## Supporting Actors
- `.kfw.json` kind field

## Preconditions
- A `kind: feature` item exists

## Trigger
`kf bug finish <feature-item>` (or any non-start verb under the wrong noun)

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | agent | runs `kf bug finish my-feature` | noun wrapper engaged |
| 2 | kf | loads item meta → `kind: feature` ≠ `bug` | refused before handler runs |
| 3 | kf | prints "…is a feature — use `kf feature finish`" | exit 1, nothing mutated |

## Alternative Flows
### A1
- Trigger: kind matches noun

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | passes through to handler | normal verb behaviour |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Legacy flat spelling (no noun) | no kind check — verbs stay kind-agnostic as today | identical to current behaviour |

## Postconditions
- No state change on mismatch

## Business Rules
- The check lives in the noun wrapper; handlers stay kind-agnostic.
- `bug start` vs `feature start` differ only by the default `--type`.

## Data
- `.kfw.json.kind`

## Acceptance Criteria
- [ ] `kf bug finish` on a feature refuses with a pointer to the right noun
- [ ] `kf feature finish` on a bug refuses symmetrically
- [ ] Flat spellings apply no kind check

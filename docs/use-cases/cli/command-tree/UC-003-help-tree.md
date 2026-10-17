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
| ID | UC-003 |
| Name | `kf help` renders the command tree |
| Requirement reference | FR-004 |
| Goal | Help reflects the real grammar — nouns with their verbs, not a flat list |
| Primary actor | Human |

## Supporting Actors
- none

## Preconditions
- Tree registry built

## Trigger
`kf help`, `kf help <noun>`, `kf help <noun> <verb>`, `kf <path> --help`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | user | `kf help` | grouped tree: top-level commands + noun groups with verb lists |
| 2 | user | `kf help feature` | noun's verbs + one-line each |
| 3 | user | `kf help feature move` | leaf's usage text |
| 4 | user | `kf feature move --help` | same leaf help at any depth |

## Alternative Flows
### A1
- Trigger: unknown path under a known noun (`kf help feature wat`)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | nearest-parent help + error | user sees valid verbs |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf help <nonsense>` | error + top-level help | unchanged from today |

## Postconditions
- Help text is generated from the tree — single source of truth

## Business Rules
- Aliases may be hidden from top-level listing but always resolvable via `help <alias>`.

## Data
- none

## Acceptance Criteria
- [ ] `kf help` groups by noun; `kf help <path>` works at any depth
- [ ] `--help` flag resolves identically to `kf help <path>`

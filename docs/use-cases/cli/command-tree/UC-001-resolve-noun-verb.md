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
| ID | UC-001 |
| Name | Resolve `kf feature start` to the `new` handler |
| Requirement reference | FR-001, FR-002 |
| Goal | Noun→verb paths resolve to the existing handlers with identical semantics |
| Primary actor | Agent / human |

## Supporting Actors
- none

## Preconditions
- CLI installed; registry built

## Trigger
`kf feature start auth login-flow` / `kf bug start billing timeout`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | user | types `kf feature start <ctx?> <name>` | argv enters resolver |
| 2 | resolver | longest-path match → `feature` → `start` leaf | leaf spec drives parseArgs |
| 3 | dispatcher | leaf `run` = `cmdNew` | work item created |
| 4 | `bug start` variant | injects `--type bug` default | `kind: bug` item |

## Alternative Flows
### A1
- Trigger: ambiguous or unknown verb (`kf feature wat`)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | resolution fails at `feature` node | prints `feature` verb list + error (not generic help) |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Ambiguous prefix (`kf feat`) | refuse, never guess | error + closest help |

## Postconditions
- Work item created exactly as `kf new` would

## Business Rules
- Verbs resolve before positionals; a feature named "feature" is still usable via explicit legacy spelling.

## Data
- `ParsedArgs` gains resolved `path`; `command`/`positionals`/`options` unchanged for handlers

## Acceptance Criteria
- [ ] `kf feature start <name>` ≡ `kf new <name>`; `kf bug start` sets `kind: bug`
- [ ] Unknown verb under known noun prints that noun's verbs

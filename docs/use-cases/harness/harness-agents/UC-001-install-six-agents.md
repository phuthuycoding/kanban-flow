---
feature: harness-agents
context: harness
created: 20261101_0919
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Install the six agents |
| Requirement reference | FR-001, FR-009 |
| Goal | One install registers all six kanban agents the skills dispatch by name |
| Primary actor | Human operator |

## Supporting Actors
- kf CLI (`kf install`, `kf uninstall`, `kf doctor --fix`)

## Preconditions
- kanban-flow package with `skills/kanban-flow/agents/` holding six agent bodies.
- A runtime with an agent registry (Claude Code: `.claude/agents`).

## Trigger
The operator runs `kf install` (or an upgrade relinks the skills).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Operator | Runs `kf install --scope project` | kf links or copies skills |
| 2 | kf | Iterates `MANAGED_AGENTS` | code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer `.md` files exist in the agents dir |
| 3 | Operator | Reads `kf install -h` | Help names the six agents |

## Alternative Flows
### A1
- Trigger: the operator runs `kf uninstall`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf removes the managed agents | The six managed files are gone; a foreign agent file stays |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A managed agent file is missing or stale | `kf doctor --fix` relinks every managed agent | The agents dir holds all six again |

## Postconditions
- The runtime can dispatch `Agent(developer)`, `Agent(test-writer)`, `Agent(automation-writer)`.

## Business Rules
- Foreign agent files are never removed.
- Every surface that lists the agents names six.

## Data
- MANAGED_AGENTS: the list of six agent names in `src/integrations/install.ts`

## Acceptance Criteria
- [ ] A project-scope install creates the six agent files.
- [ ] Uninstall removes the six managed files and keeps a foreign one.
- [ ] Help text, README, Pages site and docs/workflow name six agents.

---
feature: researcher-agent
context: harness
created: 20261102_1044
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | A user with an old install runs kf install and moves to the kf plugin |
| Requirement reference | FR-004, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016 |
| Goal | Move an existing kanban-* install to the kf plugin and kf- copies with no data loss |
| Primary actor | Human |

## Supporting Actors
- `kf` CLI
- `claude` CLI

## Preconditions
- An older kanban-flow left `kanban-*` skill entries, possibly `travel`, and loose agent files in `.claude/agents`, or per-runtime copies

## Trigger
The user runs `kf install` (or `kf doctor --fix`, or `kf uninstall`)

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Removes the legacy entries kf owns (`kanban-*` links/dirs, a kf-owned `travel`, kf-owned loose agents, old per-runtime copies) and lists them | Old install gone |
| 2 | kf | For claude: reads `claude plugin list --json`, then runs `marketplace add <pkg root>` and `install kf@kanban-flow --scope <user|project>` | The plugin is installed and loads in place |
| 3 | kf | For the other runtimes: renders the 10 `kf-<name>` copies into `.agents/skills` (into `.kiro/skills` for kiro), once per dir | Copies installed |
| 4 | kf | Prints a summary: what was removed, what was installed, what was left untouched | The user sees the result |

## Alternative Flows
### A1
- Trigger: The plugin is registered at a stale path (after an nvm switch)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Runs `marketplace add <current root>` only | Re-pointed, no reinstall |

### A2
- Trigger: The plugin is already current

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | No write calls; only the read-only `list` | Idempotent |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `claude` is not on PATH, or a `claude plugin` call fails | Quotes the output, prints the manual `/plugin` commands, exits non-zero (`kf init`: warns and continues) | The plugin is not reported as installed |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A foreign entry (a user `review` skill, an unowned `travel`, a regular file) | Left untouched and reported | No user data lost |

## Postconditions
- `/kf:<name>` works in Claude Code; `kf-<name>` works in the other runtimes
- `kf doctor` reports healthy

## Business Rules
- kf deletes only what it owns: a prefixed `kanban-*`/`kf-*` entry, or an entry matched by manifest or link

## Data
- Manifest: `.kanban-flow-skills.json`, `.kanban-flow-agents.json`
- Plugin state: `claude plugin list --json`: id, enabled, readFromFolder

## Acceptance Criteria
- [ ] A temp dir holding the legacy install migrates cleanly
- [ ] A foreign `review` and an unowned `travel` are untouched
- [ ] A stale path is re-pointed

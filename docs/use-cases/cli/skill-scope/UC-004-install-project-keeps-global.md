---
feature: "skill-scope"
context: "cli"
created: "20261010_1832"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Install project leaves global copies untouched |
| Requirement reference | FR-003 |
| Goal | `kf install --scope project` writes project-local copies and never removes or modifies `~`-level skills — they may serve other projects. |
| Primary actor | maintainer |

## Supporting Actors
- AI coding agents

## Preconditions
- A `.works/` project exists.
- `~` dirs may or may not already hold managed skills.

## Trigger
`kf install --scope project`, or `kf install` on a project configured `skills.scope: "project"`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | runs `kf install --scope project` | scope resolves to `project` |
| 2 | system | copies managed skills into `{root}/.<agent>/skills` | project copies created (copy mode, never links — a link into a package dir would break on checkout/share) |
| 3 | system | `~` dirs left alone entirely | any global links/copies unchanged |
| 4 | system | output reports project dirs + scope | maintainer sees where skills landed |

## Alternative Flows
### A1 — both scopes end up populated
- Trigger: global skills already installed; maintainer adds a project copy

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | project copy installed normally | both exist; the agent's own precedence (project over user) applies — no warning needed |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `--scope project` outside `.works/` | refuse — there is no project dir to write | `not a kanban project` error |
| agent unsupported / dir unwritable | per-agent failure line | non-zero code, other agents still processed |

## Postconditions
- Project agent dirs hold copied managed skills.
- `~` dirs are byte-for-byte unchanged.

## Business Rules
- Project scope always copies — symlinks are a global-scope mechanism only.
- Install never removes skills at the *other* scope; removal is a decision `kf uninstall` or the global-cleanup rule owns.

## Data
- Same `InstallScope.scope` resolution as UC-003.

## Acceptance Criteria
- [ ] With `~` links present, `kf install --scope project` leaves every `~`-level entry untouched and produces real directories (not links) under `{root}/.<agent>/skills`.
- [ ] `kf install` (no flag) on a `skills.scope: "project"` project behaves identically.
- [ ] `kf install --scope project` outside `.works/` fails with the existing not-a-project message.

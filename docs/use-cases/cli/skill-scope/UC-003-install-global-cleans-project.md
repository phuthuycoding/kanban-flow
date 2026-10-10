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
| ID | UC-003 |
| Name | Install global cleans the project copies |
| Requirement reference | FR-001, FR-003 |
| Goal | `kf install --scope global` (or effective global) puts linked/copied skills into `~` dirs and removes the managed skills from the project's agent dirs so no stale project copy can shadow the global set. |
| Primary actor | maintainer |

## Supporting Actors
- AI coding agents

## Preconditions
- Project has managed skills under `{root}/.<agent>/skills` (installed before this feature, or via `--scope project`).
- Configured scope is `global` or absent.

## Trigger
`kf install` or `kf install --scope global`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | runs `kf install` | effective scope resolves to `global` |
| 2 | system | links each managed skill into `~/.<agent>/skills` (copy fallback per UC-001 A1) | global install done; mode reported |
| 3 | system | configured scope ≠ `"project"` → `removeSkillsFrom` on each project agent dir | managed copies gone; unrelated skills untouched |
| 4 | system | output lists `~` dirs, landed mode, and cleaned project dirs | maintainer sees both actions |

## Alternative Flows
### A1 — configured scope is `"project"`
- Trigger: `skills.scope: "project"` in config, and maintainer passes `--scope global` explicitly

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | global install proceeds (step 2) | `~` copies exist |
| A1.2 | cleanup is skipped — the config declared project | project copies preserved; output notes both now exist |

### A2 — run outside a `.works/` project
- Trigger: `kf install --scope global` in a plain directory

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | no config to read → scope `global`; nothing to clean | `~` dirs get skills; no `.works` error |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `--scope project` outside a `.works/` project | cannot resolve project dirs → refuse | `not a kanban project` error |
| symlink failure on all skills | whole-agent fallback to copy | output states "copied" |

## Postconditions
- `~` dirs hold the managed skills for the chosen agents.
- Project agent dirs hold no managed skills (unless the config opted into project scope).

## Business Rules
- Cleanup is governed by the *configured* scope, never by the one-off flag alone.
- `removeSkillsFrom` deletes links, never the packaged targets.

## Data
- `InstallScope.scope`: `"global" | "project"`, flag override over `skills.scope` over default.

## Acceptance Criteria
- [ ] With project copies present and no `skills` field, `kf install` produces `~` symlinks and removes all eight managed dirs from `<root>/.claude/skills` while leaving an `unrelated/` skill dir intact.
- [ ] With `skills.scope: "project"`, `kf install --scope global` leaves the project copies in place and prints a note that both scopes now hold skills.
- [ ] `kf install --scope global` outside `.works/` succeeds and touches only `~` dirs.
- [ ] The packaged `skills/` tree is byte-identical before and after a global install + uninstall cycle (links removed, targets intact).

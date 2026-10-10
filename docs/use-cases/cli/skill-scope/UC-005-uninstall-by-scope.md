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
| ID | UC-005 |
| Name | Uninstall at a chosen scope |
| Requirement reference | FR-004 |
| Goal | `kf uninstall --scope <s>` removes the eight managed skills at exactly that scope, warns when removing global (shared across projects), and reports dirs where nothing was found. |
| Primary actor | maintainer |

## Supporting Actors
- AI coding agents

## Preconditions
- Managed skills may exist at either or both scopes.

## Trigger
`kf uninstall [--scope global|project]` (default: effective scope).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | runs `kf uninstall --scope global` | scope resolves to `global` |
| 2 | system | prints a one-line warning that global skills serve every project | maintainer is told the blast radius |
| 3 | system | `removeSkillsFrom` on each agent's `userSkillsDir` | managed links/copies removed; unrelated skills untouched |
| 4 | system | reports removed count + "already clean" per dir | output shows what happened where |

## Alternative Flows
### A1 — project scope
- Trigger: `--scope project` or effective scope project

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | removes managed skills from `{root}/.<agent>/skills` only | `~` entries untouched; no shared-scope warning needed |

### A2 — `--purge`
- Trigger: `kf uninstall --purge` (existing behavior)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | purge confirmation and `.works`/`.kf`/docs removal unchanged | scope removal happens for the effective scope; purge semantics untouched |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `--scope project` outside `.works/` | refuse — no project dirs exist | `not a kanban project` |
| `--scope global` outside `.works/` | proceed — removal needs no config | `~` dirs cleaned |
| nothing installed at the scope | per-agent "already clean" line | exit 0 — removing nothing is not a failure |

## Postconditions
- The named scope holds no managed skills; the other scope is untouched.
- Packaged `skills/` targets intact after removing links.

## Business Rules
- Uninstall acts on exactly one scope per invocation (`--scope all` is out of scope).
- `--force` keeps its existing meaning (purge prompt skip) — it does not suppress the global warning line.

## Data
- Same `InstallScope.scope` resolution as UC-003.

## Acceptance Criteria
- [ ] `kf uninstall --scope global` removes the eight `~` entries (links or copies), leaves a project copy in place, and prints the shared-across-projects warning.
- [ ] `kf uninstall --scope project` removes project copies only; `~` entries survive.
- [ ] `kf uninstall --scope global` works outside `.works/`.
- [ ] Re-running uninstall at an already-clean scope exits 0 with "already clean" lines.

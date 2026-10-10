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
| ID | UC-001 |
| Name | Fresh init defaults to global skills |
| Requirement reference | FR-001, FR-002, FR-003, FR-005 |
| Goal | A maintainer running `kf init` non-interactively gets the eight managed skills in the agent's `~`-level dir — linked to the package — with nothing written under the project's agent dirs. |
| Primary actor | maintainer |

## Supporting Actors
- AI coding agents (consume the installed skills)

## Preconditions
- Project has no `skills` field in `.kf/config.json` (fresh or legacy config).
- kf package `skills/` dir contains all eight managed skills.

## Trigger
`kf init --defaults` (or `kf init -i` choosing Quick setup, or `kf init --minimal`).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | runs `kf init --defaults` in the project | scaffolding runs (`.works/`, `.kf/`, docs dirs) |
| 2 | system | resolves effective scope → `global` (no `skills` field) | target = each configured agent's `userSkillsDir()` |
| 3 | system | links each managed skill `~/.<agent>/skills/kanban-*` → `<pkg>/skills/kanban-*` | symlinks created |
| 4 | system | no configured scope `"project"` → removes any managed skills under the project's agent dirs | stale project copies cleaned |
| 5 | system | reports installed location + landed mode per agent | output shows `~` dirs and "linked" |

## Alternative Flows
### A1 — symlink unavailable
- Trigger: `symlink()` throws (EPERM, Windows) or package root is ephemeral (npx cache)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | fall back to copying the skill dir | copy lands; output states "copied" for that agent |
| A1.2 | continue at main flow step 4 | cleanup/report identical |

### A2 — agent has no usable user dir
- Trigger: an adapter whose `userRel` resolves to nothing the agent reads

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | skip that agent with a warning line naming it | other agents unaffected; warning in output |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `~` dir unwritable / HOME unset | install reports the failing agent + error; init returns the failure instead of pretending success | non-zero exit, error naming the dir |
| package `skills/` incomplete | existing guard: missing packaged skill aborts with `skill missing` | no partial install |

## Postconditions
- `~/.<agent>/skills/kanban-*` present as links (or copies) for each configured agent.
- Project's `.<agent>/skills` contains no managed skills.
- No `skills` field required in config; the default stays `global`.

## Business Rules
- Absent `skills.scope` means `global` everywhere scope is resolved (single `effectiveSkillsScope`).
- Only the eight managed names are ever removed from a project dir; unrelated skills survive.

## Data
- `ProjectConfig.skills.scope`: `"global" | "project"`, optional.

## Acceptance Criteria
- [ ] `kf init --defaults` on a fresh project leaves `~/.claude/skills/kanban-*` as symlinks into `<pkg>/skills/` (lstat-verified) and creates nothing under `<project>/.claude/skills`.
- [ ] Output names the `~` target dirs and states "linked" (or "copied" on fallback) per agent.
- [ ] With `symlink()` forced to fail, the same run copies and says so.

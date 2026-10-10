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
| ID | UC-002 |
| Name | Onboarding asks scope and persists the answer |
| Requirement reference | FR-002, FR-005 |
| Goal | Interactive `kf init` asks where skills live; the answer lands in `.kf/config.json` as `skills.scope` and drives the install that follows. |
| Primary actor | maintainer |

## Supporting Actors
- none

## Preconditions
- Interactive TTY `kf init` (bootstrap path, "Customize" chosen) — `Quick setup` takes the default without asking further.
- Project may or may not have a `skills` field already.

## Trigger
`kf init -i` → Customize path reaches the skills question.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | system | asks "Install skills globally for all projects, or into this project only?" (default: global) | maintainer sees the choice among the other setup questions |
| 2 | maintainer | answers "project" | `answers.skillScope = "project"` |
| 3 | system | `saveConfig` writes `skills.scope: "project"` into `.kf/config.json` | config records the explicit choice |
| 4 | system | installs into `{root}/.<agent>/skills` (copy mode) | project-scoped skills exist |
| 5 | system | summary output names the scope | maintainer sees what was chosen |

## Alternative Flows
### A1 — Quick setup
- Trigger: maintainer picks "Quick setup — defaults"

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | no scope question; `skillScope` defaults to `global` | joins UC-001 main flow |
| A1.2 | summary line shows scope alongside contexts/stacks/reviewer | the default is visible, not hidden |

### A2 — existing config already carries `skills.scope`
- Trigger: re-run `kf init` on a configured project

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | the question's default reflects the configured value | Enter keeps it; a new answer overwrites |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `skills.scope` in config holds a garbage string | `readProjectConfig` throws a named-field error before any install happens | `Invalid project config … skills.scope must be "global" or "project"` |
| non-TTY run | `bootstrapDefaults` supplies `global`; no prompt is attempted | deterministic defaults |

## Postconditions
- `.kf/config.json` contains the chosen `skills.scope`.
- Installed skills match the chosen scope.

## Business Rules
- Scope is per project; there is no user-level config file.
- The flag (`--scope`) never rewrites `skills.scope` — config is only set through onboarding/defaults/manual edit.

## Data
- `BootstrapAnswers.skillScope`: `"global" | "project"`.
- `ProjectConfig.skills`: `{ scope: "global" | "project" }`, written by `saveConfig` only.

## Acceptance Criteria
- [ ] Interactive `kf init` shows the scope question; answering "project" yields `skills.scope: "project"` in `.kf/config.json` and skills under the project agent dir.
- [ ] Answering "global" (or Quick setup) yields global install per UC-001.
- [ ] `askAll` on a config with `skills.scope: "project"` defaults the question to project.
- [ ] A garbage `skills.scope` value fails `readProjectConfig` with a message naming the field and the two allowed values.

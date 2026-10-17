---
feature: worktree-opt-out
context: worktree
created: 20261017_1750
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Doctor stays silent about domain infra when disabled |
| Requirement reference | FR-003 |
| Goal | `kf doctor` never reports or repairs worktree domain infra for an opted-out project |
| Primary actor | Project owner |

## Supporting Actors
- `probeDomainInfra` (dnsmasq/proxy checks)

## Preconditions
- Project has worktree disabled (absent block or `enabled: false`)
- Machine may or may not have domain infra — irrelevant

## Trigger
`kf doctor` / `kf doctor --fix` / `kf doctor --json`

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Owner | runs `kf doctor` | diagnostics start |
| 2 | kf | resolves `wtCfg.enabled === false` | infra probe skipped |
| 3 | kf | prints findings | no `worktree infra` area, no `sudo kf worktree setup` suggestion |

## Alternative Flows
### A1
- Trigger: `enabled: true` and infra missing

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | probe runs; finding reports `sudo kf worktree setup` repair | today's behaviour preserved |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `--fix` on opted-out project | nothing about worktree infra is "repaired" | no unexpected mutations |

## Postconditions
- Opted-out projects see a clean doctor output with no domain-infra noise

## Business Rules
- Doctor never suggests machine-level onboarding for a subsystem the project did not opt into.

## Data
- Doctor findings list: omits `worktree infra` entries when disabled

## Acceptance Criteria
- [ ] `kf doctor` on default-off project shows no worktree-infra finding
- [ ] `kf doctor` on `enabled: true` + missing infra still suggests `sudo kf worktree setup`

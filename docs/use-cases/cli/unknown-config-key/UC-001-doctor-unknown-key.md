---
feature: unknown-config-key
context: cli
created: 20261110_1219
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Doctor reports an unknown config key with a hint |
| Requirement reference | FR-001, FR-002 |
| Goal | A key kf does not read in `.kf/config.json` is reported, with the intended key named for a singular/plural slip |
| Primary actor | Developer |

## Supporting Actors
- None

## Preconditions
- The project has `.kf/config.json` that parses and passes the shape check.

## Trigger
The developer runs `kf doctor`, `kf doctor --json` or `kf doctor --fix`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Developer | runs `kf doctor` | doctor reads the config |
| 2 | kf | compares each top-level key with the known set (`ProjectConfig` keys plus `ship`) | unknown keys found |
| 3 | kf | prints one WARNING per unknown key, area `.kf/config.json`, message `unknown_config_key: "<key>" is not a kf config key and is ignored.` | the developer sees the key |
| 4 | kf | names `did you mean "<k>"?` when adding or dropping one trailing `s` gives a known key | the developer sees the intended key |

## Alternative Flows
### A1
- Trigger: no near match

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | action reads `remove it, or keep it as a note (kf ignores it)` | step 3 |

### A2
- Trigger: `kf doctor --fix`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | fixes run, the unknown key is left in the file | the after-state still lists the warning |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| config missing, invalid JSON or refused by the shape check | the check returns nothing | only the existing config findings |

## Postconditions
- The config file is unchanged; the exit code depends only on ERROR findings.

## Business Rules
- Warning only; `--fix` never edits the key.
- Keys handled by the legacy checks (`ship`, `stack`, `defaultContext`) are known and never warn as unknown.
- Exact, case-sensitive match only; the legacy `ship`, `stack` and `defaultContext` are never hint targets.

## Data
- `.kf/config.json`: top-level keys.

## Acceptance Criteria
- [ ] `"worktrees"` beside `"worktree"` → WARNING naming `worktrees`, action `did you mean "worktree"?`, also in `--json`.
- [ ] `"notes"` → WARNING, action to remove or keep as a note.
- [ ] Only known keys (incl. `ship`, `defaultContext`) → no `unknown_config_key` finding.
- [ ] After `--fix` the key remains and is still reported; exit 0 with only warnings.

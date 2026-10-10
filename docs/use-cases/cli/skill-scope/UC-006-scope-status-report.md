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
| ID | UC-006 |
| Name | Autoconfig and doctor report scope, status and stale skills |
| Requirement reference | FR-006, FR-007 |
| Goal | `kf autoconfig` and `kf doctor` tell the maintainer the effective scope, each configured agent's install status at that scope (linked / copied / broken / stale / missing), and the repair command; `doctor --fix` performs the repair. |
| Primary actor | maintainer |

## Supporting Actors
- AI coding agents (consume the autoconfig briefing)

## Preconditions
- A `.works/` project (doctor/autoconfig still project-bound), config readable.
- A shared `skillsStatus()` helper exists that inspects one agent's dir at one scope.

## Trigger
`kf autoconfig` or `kf doctor [--fix]`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | maintainer | runs `kf autoconfig` | briefing prints "Skills installed (scope: global)" with per-agent status |
| 2 | system | for each configured agent evaluates `skillsStatus()` at the effective scope: link valid → linked; link dangling → broken; dir present → compare content with `PKG_SKILLS_DIR` → copied or stale; absent → missing | checklist rows reflect the real state |
| 3 | system | configured scope `global` + managed skills still in a project dir → extra checklist row flagging duplicates | suggests `kf uninstall --scope project` (or `kf install`, which cleans) |
| 4 | maintainer | runs `kf doctor --fix` on a stale/broken agent | reinstall at effective scope (link-or-copy); configured-scope cleanup applied; re-run reports clean |

## Alternative Flows
### A1 — scope project
- Trigger: `skills.scope: "project"`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | same checks run against `{root}/.<agent>/skills` | stale = content differs; no link semantics (project never links) |

### A2 — JSON output
- Trigger: `kf doctor --json`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | findings carry the same statuses in structured form | machine-readable parity |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| managed dir exists but `SKILL.md` missing inside | counts as missing for that skill (existing semantics) | partial-set finding |
| `~` dir unreadable | status `missing`/`unknown` reported, never a crash | finding with the path and error |
| `skills.scope` garbage | config check already reports it; skills checks still run on default global | one config finding, not a cascade |

## Postconditions
- The maintainer knows scope, per-agent status, and the fix command without running any other tool.
- `--fix` leaves the effective scope consistent: fresh links/copies, no leftover project duplicates (when configured scope is global).

## Business Rules
- A live symlink is never "stale" — it tracks the package; a *dangling* one is "broken".
- Status at a scope ignores the other scope except the explicit duplicate-project-copies check.
- `--fix` performs only repairs needing no human decision (reinstall + the configured-scope cleanup).

## Data
- `skillsStatus(agentDir)` → `{ mode: "linked" | "copied" | "missing", stale: boolean, broken: boolean }` (exact shape settled in implementation; both callers share it).

## Acceptance Criteria
- [ ] `kf autoconfig` prints the effective scope and per-agent `linked`/`copied`/`stale`/`broken`/`missing` status at that scope, with `kf install`/`kf doctor --fix` named as fixes.
- [ ] Hand-editing an installed SKILL.md in a copied dir flips that agent to `stale`; `kf install` restores it to clean.
- [ ] A simulated dangling link (target removed) shows as `broken`; `doctor --fix` re-creates it.
- [ ] With `skills.scope: "global"` and managed skills in a project dir, both tools flag the project copies as duplicates to remove.
- [ ] `kf doctor` exits non-zero while any configured agent is missing/stale/broken and exits 0 after `--fix` on a clean project.

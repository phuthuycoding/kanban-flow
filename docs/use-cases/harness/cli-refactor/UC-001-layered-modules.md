---
feature: cli-refactor
context: harness
created: 20261024_1322
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Maintainer finds driver, archive and cancel logic in the layer named after it |
| Requirement reference | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006 |
| Goal | A maintainer changing the driver, archive, cancel, bypass or GitHub behaviour edits one module in the right layer, and lower layers never depend on the CLI |
| Primary actor | Maintainer |

## Supporting Actors
- kf CLI (callers of the moved functions)

## Preconditions
- The refactor is merged.

## Trigger
The maintainer needs to change how archive works, or how the driver stops.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Maintainer | Opens src/harness/drive/ | Finds claim.ts, control.ts and driver.ts, each under 500 lines |
| 2 | Maintainer | Opens src/workflow/archive.ts | Finds archiveItem with a typed outcome; canonical docs in canonical-docs.ts |
| 3 | Maintainer | Checks who calls archive | stage, sync and issues call archiveItem; only cmdArchive renders CLI output |
| 4 | Maintainer | Checks imports of workflow/harness/ship/worktree | None import from src/cli |

## Alternative Flows
### A1
- Trigger: Old code imports a moved name from its old module.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The old module re-exports the name | Import keeps working; returns to step 4 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A move would create a circular import | Typecheck/lint and review catch it | Task not done until resolved |

## Postconditions
- Responsibilities match module names; no lower layer imports src/cli.

## Business Rules
- Pure refactor: no behaviour change.

## Data
- No metadata or config shape changes.

## Acceptance Criteria
- [ ] No file under src/ exceeds 500 lines.
- [ ] grep finds no `../cli/` import in src/workflow, src/harness, src/ship or src/worktree.
- [ ] stage.ts, sync.ts and issues.ts contain no call to cmdArchive.

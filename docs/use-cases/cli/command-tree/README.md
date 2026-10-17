---
feature: command-tree
context: cli
created: 20261017_1750
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Resolve `kf feature start` to the `new` handler | [UC-001](UC-001-resolve-noun-verb.md) | Agent / human | implemented |
| UC-002 | Legacy flat spelling keeps working | [UC-002](UC-002-legacy-alias.md) | Scripts / agent | implemented |
| UC-003 | `kf help` renders the command tree | [UC-003](UC-003-help-tree.md) | Human | implemented |
| UC-004 | `kf bug finish` on a feature-kind item refuses | [UC-004](UC-004-kind-mismatch.md) | Agent | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002 | longest-path resolution + verb mapping |
| UC-002 | FR-003, FR-005 | TC-003 | identical CmdResult via alias |
| UC-003 | FR-004 | TC-004 | tree help + path help + alias help |
| UC-004 | FR-002 | TC-005 | kind check refuses cross-noun |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 3 |
| Functional requirements covered | 6 |
| Test cases linked | 6 |

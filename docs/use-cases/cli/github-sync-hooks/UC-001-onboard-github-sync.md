---
feature: "github-sync-hooks"
context: "cli"
created: "20261010_1217"
id: UC-001
---

# UC-001 — Maintainer onboards a project to GitHub sync

## Actor
Maintainer running `kf init` on a repo with a GitHub origin and a GitHub Projects board.

## Preconditions
- `gh` is installed and authenticated with `repo` (and `project` when a board is used).
- `.kf/config.json` will carry `repository` (detected) and a `project` block.

## Main Flow
1. `kf init` detects the origin remote → `repository`.
2. Customize asks "Install GitHub sync hooks?" → yes copies the pack into `.kf/hooks/`.
3. Maintainer writes the `project` block (owner, number, statusMap, acGate).
4. `kf doctor` confirms no warnings; `gh project` scope is verified.
5. `KFW_REPOSITORY` and `KFW_PROJECT_*` are present in every hook run.

## Alternate Flows
- No repository: the prompt is skipped and the pack no-ops.
- `acGate: false`: the dones hook skips the AC check, still syncs status and closes the issue.

## Postconditions
- `.kf/hooks/` contains the generic pack; no line hardcodes the repo or a field ID.

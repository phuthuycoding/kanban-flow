---
uc: "UC-001"
feature: "done-trigger"
context: "cli"
---

# UC-001 — Archive leaves issue open and board at intermediate status

## Goal
`kf archive` completes the kanban lifecycle without claiming delivery on the tracker.

## Actors
- Primary: maintainer/agent archiving a work item
- Secondary: `dones.sh` (GitHub sync pack), `gh`

## Preconditions
- Project has the GitHub sync pack installed (`.kf/hooks/dones.sh` from the updated pack), `repository` set, item linked to an issue.
- Item is in `review` with a current PASS report.

## Trigger
`kf archive <feature>` → the `dones` stage hook runs.

## Main Flow
1. `dones.sh` resolves the linked issue URL.
2. AC gate evaluates (unchanged): unchecked acceptance criteria refuse the archive.
3. `sync_project_status dones` moves the board card to the status the project's `statusMap.dones` maps (recommended: an intermediate status, not "Done").
4. `close_issue_done` is no longer invoked — the issue stays open.
5. Archive proceeds; `.kfw.json` marked archived.

## Alternative Flows
- A1. `statusMap.dones` still maps to "Done" → board moves to Done at archive. That is the project's own mapping choice; the issue still stays open.
- A2. No `project` board → step 3 no-ops (existing project_ready guard).
- A3. GitHub unreachable → warn, archive proceeds (fail-open).

## Exception Flows
- E1. Unchecked AC → hook exits 1, archive refused — unchanged.
- E2. Unreadable `.kfw.json` → hook exits 1, archive refused — unchanged.

## Postconditions
- Issue: OPEN. Board: `statusMap.dones` status. Work item: `dones` stage.
- `kf issues done` remains available to mark delivery.

## Business Rules
- Archive never closes an issue; only `kf issues done` (or GitHub-native `Closes #N` / manual) does.

## Acceptance Criteria
- [ ] With a stubbed `gh`, running `dones.sh` performs the board sync but never calls `issue close`.
- [ ] Archive on a linked item leaves the issue open; board status follows `statusMap.dones`.
- [ ] AC-gate refusal behaviour unchanged.

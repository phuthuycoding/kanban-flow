---
feature: done-trigger
context: cli
created: 20261010_1946
kind: feature
status: archived
---
# Spec Requirement

## Feature
done-trigger

## Objective
Decouple "archived" from "delivered" on the GitHub sync path: `kf archive` stops closing the linked issue and stops claiming board "Done"; a new `kf issues done <feature>` command is the single delivery trigger — it verifies the linked PR merged (when recorded), closes the issue, moves the board card to the delivered status and marks the work item delivered.

## Problem Statement
The GitHub sync pack's `dones.sh` hook treats `kf archive` as delivery: it closes the linked issue ("Work item archived in kf.") and moves the board card to the status mapped to `dones` — unconditionally, once the AC gate passes. But archive only ends the kanban lifecycle; the code may be uncommitted, in an unmerged PR, or merged-but-unreleased. On 2026-10-10, `skill-scope` was archived with its entire diff uncommitted and issue #26 + board card were both reported "Done" — a false delivery signal on the public tracker (bug item `archive-closes-issue-unmerged` records the reproduction). There is no delivery-aware step anywhere in the pack: no PR tracking on the work item, no post-archive event, no close mechanism other than the stage hook.

## Scope
### In Scope
- `dones.sh` (packaged `kanban-flow/github-hooks/dones.sh` + the seeded installed copy's behavior): stop calling `close_issue_done`; board sync at archive continues via `statusMap.dones`, which projects re-point to an intermediate status.
- `.kfw.json` `pr` field + `kf issues link <feature> <ref>` extended to accept a pull request URL/number (writes `pr`, keeps `issue` for issue refs) or an equivalent small linking surface.
- `kf issues done <feature>` command: the single delivery trigger — closes the issue, syncs the board to the delivered status, records `delivered` in `.kfw.json`.
- `statusMap.delivered` board status (project config, default "Done") + the packaged `delivered.sh` hook mechanism that performs the GitHub side effects on the delivery event.
- Visibility: `kf status`/`kf doctor` surface "archived but not delivered" so an open-but-done item is discoverable.
- Docs: `Closes #N` PR-body convention as the zero-code complement; updated hook-pack + project-board documentation.

### Out of Scope
- Auto-detecting merges in the background (polling daemons, webhooks) — no always-on machinery; `kf issues done` is the explicit human trigger.
- A `merge` evidence mode inside `dones.sh` — declined: detection without a PR record is unreliable for non-worktree/docs items; the command-based trigger replaces it.
- `cancelled.sh` closing issues as not-planned — correct as-is.
- Changes to the AC gate (`acGate` semantics untouched: it still gates archive on checked acceptance criteria).
- Release/deploy tracking beyond "merged" — `kf issues done` asserts delivery the human confirms, not CI/release status.

## Actors
- Maintainer/agent driving a work item to delivery (runs `kf issues done` after merging).
- The GitHub sync pack (bash hooks + `lib-github.sh`) performing issue/board side effects.
- `gh` CLI as the GitHub transport.

## Functional Requirements
### FR-001
- Requirement: `dones.sh` no longer calls `close_issue_done`. At archive the hook still runs the AC gate and `sync_project_status dones`, but the issue is left open and board placement follows `statusMap.dones` (which the pack seeds/documents as an intermediate status, e.g. "In review", no longer "Done").
- Priority: must
- Notes: this removes the false-close at its source; the seeded pack's `statusMap` example and docs change accordingly.

### FR-002
- Requirement: work items can record a PR: `.kfw.json` gains a `pr` field (URL, same shape as `issue`), written by `kf issues link <feature> <n|url>` — the command detects whether the ref is a pull request or an issue and writes `pr` or `issue` accordingly. `kf issues link` refuses to overwrite an existing `pr` (same rule as `issue`).
- Priority: must
- Notes: smallest viable linking surface — reuses the existing command; `pr` is optional metadata, items without it still work.

### FR-003
- Requirement: `kf issues done <feature>` performs delivery, in order: (a) refuse when the item is not archived/dones or has no linked issue; (b) when `.kfw.json.pr` is set, verify via `gh pr view` that the PR is merged — refuse if it is not, with a `--force`-style escape only if the product decision allows; (c) run the `delivered` event: close the issue with a delivery comment, move the board card to `statusMap.delivered` (default "Done"); (d) write `delivered: true` (+ timestamp) into `.kfw.json`. Idempotent: a delivered item is a no-op success.
- Priority: must
- Notes: "one trigger for board + issue" per maintainer decision. Mechanism for (c) mirrors the stage-hook architecture: `kf issues done` runs `.kf/hooks/delivered.sh` (seeded by the pack; project → user → package precedence) — if no delivered hook exists, the command still records `delivered` and warns that GitHub side effects did not run.

### FR-004
- Requirement: `statusMap` gains a `delivered` key (default "Done") validated alongside existing keys; `sync_project_status` accepts the `delivered` pseudo-stage. `project` config validation rejects unknown `delivered` shapes the same way it does today.
- Priority: must
- Notes: one new key, same machinery.

### FR-005
- Requirement: `kf status --change <feature>` and `kf doctor` report a warning for an item in `dones` whose linked issue is still open / `delivered` absent — pointing at `kf issues done`.
- Priority: should
- Notes: fail-visible guard against forgetting the delivery step; the check must not break `doctor` for projects without the GitHub pack (no issue field → no warning).

### FR-006
- Requirement: `Closes #N` convention documented — the issue body's footer or `kf issues` docs recommend referencing the issue in the PR so GitHub's native merge-close also fires; `kf issues done` remains the board-sync + delivered-flag path even when GitHub already closed the issue (idempotent close).
- Priority: could
- Notes: zero-code safety net for the PR flow.

## Non-Functional Requirements
- Fail-open/fail-closed conventions preserved: GitHub outage during `delivered` hook → warn, `delivered` flag still recorded; unreadable `.kfw.json` → refuse, same as other hooks.
- No new always-on processes, daemons or polling.
- `delivered` flag + `pr` field are additive to `.kfw.json` — older readers must ignore them safely.

## Main Use Cases
- UC-001 Archive leaves issue open and board at intermediate status
- UC-002 Link a PR to the work item
- UC-003 `kf issues done` delivers: issue closed, board Done, flag recorded
- UC-004 `kf issues done` refuses when PR not merged
- UC-005 Doctor/status surfaces an archived-but-undelivered item

## Constraints
- Bash hook machinery stays bash; the `delivered` event reuses `lib-github.sh` (`close_issue_done`, `sync_project_status`) rather than reimplementing board field-id resolution in TypeScript.
- Projects without `project` board: `delivered` hook skips board sync silently, closes issue only.
- Items without a linked issue or without the GitHub pack: `kf issues done` still records `delivered` (or refuses cleanly if there is nothing to mark — decide in planning; default: record flag, warn).
- Seeded hooks are project-owned — `doctor` divergence rules unchanged; the pack ships the new `delivered.sh`, installed copies get it on re-seed.

## Assumptions
- A PR is the normal delivery path for this project (`gh pr` available wherever the pack runs — same precondition as the rest of the pack).
- "Delivered" means merged (or equivalent human-confirmed delivery for items without a PR), not released/deployed.
- Board + issue share one delivery trigger (maintainer decision 2026-10-10).

## Acceptance Criteria
- [ ] After `kf archive` on a pack-installed project: the linked issue stays open and the board card sits at the `statusMap.dones` (intermediate) status — verified on a real or stubbed `gh`.
- [ ] `kf issues link <feature> <PR-url>` writes `pr` (not `issue`) into `.kfw.json`; a second link refuses.
- [ ] `kf issues done <feature>` with a merged PR linked: issue closed with evidence comment, board → `statusMap.delivered`, `.kfw.json` gains `delivered`; re-run is a no-op.
- [ ] `kf issues done` with an unmerged PR refuses and changes nothing (issue open, board unchanged, no flag).
- [ ] `kf issues done` with no PR linked still delivers after the human confirms via the command (issue closed, board Done) — the PR check only applies when `pr` is set.
- [ ] `kf doctor`/`kf status` warns on a dones item with `delivered` absent — and stays silent for items with no issue link.
- [ ] AC-gate behavior unchanged: unchecked AC still refuses archive before any of this runs.

## Edge Cases
- `pr` linked but the PR was closed-unmerged → refuse like unmerged.
- Issue already closed (native `Closes #N` on merge or by hand) → `kf issues done` still records `delivered` + board sync; closing again is a harmless no-op.
- `delivered` hook missing from an older installed pack → `kf issues done` records the flag and warns GitHub side effects were skipped.
- GitHub outage mid-`done` → warn + flag recorded; a re-run reconciles (idempotent).
- Item archived before this feature exists (e.g. `skill-scope`): `delivered` absent → doctor warning points at `kf issues done`; running it delivers retroactively.
- `statusMap` without `delivered` key → default "Done" applies; a project may map `delivered` to any board option name.
- `kf issues done` on a bug item — same rules; bug issues also close via delivery trigger.
- `KFW_REPOSITORY`/repository unset → `kf issues done` refuses politely (nothing to sync against).

## Open Questions
- For an archived item whose issue is not linked (no `issue` field): should `kf issues done` refuse or record-only? (Default recorded above; confirm at planning.) FR-003 and Constraints currently state both — resolve in planning.
- Command name: `kf issues done` vs `kf issues deliver`/`ship` — `done` echoes the dones stage which is exactly the conflation being fixed; decide in planning.
- Should `dones.sh` also stop the board move (board stays at review status until `done`)? Current proposal keeps `sync_project_status dones` so the card visibly leaves the review column into the intermediate status the project maps.
- Challenged alternatives, rejected: (a) "delivered" as a real stage reusing `kf stage` — ripples folder moves/validator/gates for one event; (b) auto-deliver on `kf status`/`doctor` when `pr` merged — read commands must not cause GitHub side effects; (c) fix = delete `close_issue_done` only — does not address board Done-while-unmerged, which is half the complaint.

## Test Strategy
- Level: unit
- UI Tests: none
- Tools: vitest + existing hooks test harness (stubbed `gh`, fake `.kfw.json`/repo env — `src/tests/hooks.test.ts` patterns)
- Coverage Target: 80%

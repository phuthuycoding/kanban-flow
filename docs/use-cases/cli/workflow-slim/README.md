---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Approve starts implementation; `--backlog` defers | [UC-001](UC-001-approve-starts.md) | Maintainer | implemented |
| UC-002 | Tester, then independent review with PR and CI watch | [UC-002](UC-002-review-pr-ci.md) | Drive workers (tester, code-reviewer) | implemented |
| UC-003 | Merge on GitHub, then the item is `done` and its worktree is gone | [UC-003](UC-003-merge-closes-item.md) | Maintainer | implemented |
| UC-004 | Stale primary checkout still drives from the worktree config | [UC-004](UC-004-drive-config-resolution.md) | Drive supervisor | implemented |
| UC-005 | Morning travel: carry-over, sized plan, approval, loop, end of day | [UC-005](UC-005-travel-day.md) | Travel | implemented |
| UC-006 | Epic issue type exists; #95 is an Epic | [UC-006](UC-006-epic-issue-type.md) | Maintainer | implemented |
| UC-007 | Day progress: running A/SLOTS, Needs you vs Waiting to merge, parallel worktrees | [UC-007](UC-007-progress-block.md) | Travel | implemented |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002 | TC-005, TC-006, TC-007, TC-008 | `kf approve x` → implementation with worktree; `--backlog` → backlog; no start/backlog prompt; approval rolled back when the move fails |
| UC-002 | FR-003, FR-004 | TC-009, TC-010, TC-011, TC-012, TC-030 | PR recorded before PASS; `ci:` recorded; PASS refused on red CI or non-PASS tests; no CI recorded as `none`; findings come from `code-reviewer` |
| UC-003 | FR-001, FR-005, FR-007 | TC-001, TC-002, TC-003, TC-004, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-029, TC-031, TC-032, TC-033 | Stage list without `shipping`, `dones` → `done`, migration of legacy folders and statusMap keys; merged PR → done with hook before delete, docs, issue, board, worktree and branch handled; `landing: none` only on an empty branch; unmerged PR → awaiting merge bucket with URL; `kf ship` non-zero |
| UC-004 | FR-006 | TC-020, TC-021 | Config read from the item worktree, then `origin/main`, then the primary checkout; drive starts from a stale primary |
| UC-005 | FR-008, FR-009, FR-011, FR-012, FR-013 | TC-022, TC-023, TC-024, TC-025, TC-026 | Skill text carries the morning plan, loop, end of day; size rule; measure line; budget and calibration computed from `estimates.md` |
| UC-006 | FR-010 | TC-027 | Live `gh api` check: Epic in the issue-type catalog, #95 typed Epic |
| UC-007 | FR-014, FR-015 | TC-022, TC-028, TC-029 | Progress block headings, lines and dispatch rule; `kf status --all` buckets; overlapping-file items marked sequential |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 7 |
| Actors | 4 (Maintainer, Travel, Drive supervisor, Drive workers) |
| Functional requirements covered | 15 (FR-001 … FR-015) |
| Test cases linked | 33 |

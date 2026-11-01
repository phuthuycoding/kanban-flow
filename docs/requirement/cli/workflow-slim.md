---
feature: workflow-slim
context: cli
created: 20261029_2157
kind: feature
status: archived
---
# Spec Requirement

## Feature
workflow-slim

## Objective
Run kanban-flow as a **multi-worker day**: many items, many worktrees, one surface that always answers three questions — what must I decide, what must I do, how many workers are running — and close each item at `done` with no `shipping` stage. Travel is that surface (same day-shape as a nonstop day orchestrator — morning plan, worker slots, end-of-day stats — including estimates). Add a GitHub **Epic** issue type and set #95 to it (#100).

## Problem Statement
The pipeline is a single-item ceremony. Chat asks start-vs-backlog and ship-vs-archive. The human cannot see how many drives are live, or tell a **decision** (approve a spec) from an **action** (merge this PR). `shipping` is a command mixed into the stage list; `statusMap` has no `shipping` key; worktrees linger until a forgotten `kf archive`. Parallel worktrees exist in the harness; skills do not run the day as a worker pool.

## How it works

Two layers. The human lives on the **day**. Each ticket still walks the **item** ladder.

### Layer A — Day (travel)

Morning: yesterday’s ledger + `kf status --all` + this repo’s PRs with red CI → **today’s plan** (T-shirt size, batch budget) → the human approves or edits.

Then a loop until end of day. Each started item occupies **one worker slot** and **one item worktree**. Default 3 slots (`slots=N`). Same repo + overlapping files → sequential. Travel does not write product code.

Every wake-up prints (or refreshes) one block:

```
Tick N — running: A/SLOTS | done: X | blocked: Z | queued: R | points: P
⏸ Needs you (decide)
  - t2 confirm spec workflow-slim
  - t4 approve plan (or --backlog)
▶ Running
  - t1 workflow-slim implementation (.worktrees/workflow-slim)
  - t3 cli-refactor review / CI
✓ Waiting to merge (do this on GitHub)
  - t5 https://github.com/…/pull/104 — ! gh pr merge 104
```

| Human | When |
|---|---|
| **Decide** | Spec, plan, daily plan, destructive question |
| **Do** | Merge a CI-green PR — command is printed |
| **Idle** | `running: A/SLOTS` — leave the workers |

End of day: done / blocked / waiting-to-merge / carry-over + hit rate, bias, throughput. Next morning starts from carry-over.

### Layer B — Item (no ship)

```
brainstorm → planning
  kf approve           → implementation → testing → review → GitHub merge → done
  kf approve --backlog → backlog
```

Coder + verify → tester → review (open PR + code-reviewer + watch CI) → tester again if code changed → PASS and CI green → Waiting to merge → merge → `done` (canonical docs from `origin/main`, tear worktree, delete merged branch).

Spec / approve / merge surface as **Needs you** or **Waiting to merge**. Skills do not ask start-vs-backlog or ship-vs-archive in chat while travel is running. `kf ship`, if still in the binary, is deprecated and exits non-zero.

### Worktree

`kf approve` (without `--backlog`) creates one worktree per item. Drive task worktrees tear down after the task. The item worktree lives until `done` or `cancelled`. On `done` with the branch on origin/main: remove the worktree and delete the branch. Dirty tree refuses the move. Two items in parallel = two worktrees.

## Scope
### In Scope
- Drop stage `shipping`. Rename `dones` → `done` (folder `.works/done/`). Legal stages: brainstorm, planning, backlog, implementation, testing, review, done, cancelled.
- `kf approve` → implementation (worktree up). `kf approve --backlog` → backlog.
- Review: spawn code-reviewer; push/open PR; watch CI and fix; re-test if code changed.
- Auto-`done` when origin/main has the change (or nothing to land). Archive internals: docs from `origin/main`, issue, board, worktree teardown, delete merged branch.
- `kf drive` config: item worktree `.kf/config.json`, else `origin/main`, else primary checkout.
- Day control plane: travel skill, ledger, estimates, progress block (`running: A/SLOTS`, Needs you, Waiting to merge). Phase skills write those buckets; they do not invent extra chat gates.
- One started item = one worktree = one travel slot; overlapping files sequential.
- `skills/travel/SKILL.md` (#95, #96–#98). T-shirt estimates in `.kf/travel/estimates.md` (day-orchestrator mindset; no external binary).
- GitHub issue type **Epic** on `phuthuycoding/kanban-flow`; set #95 to that type (#100).
- Docs: lifecycle, state-machine, gates, cli-reference, harness, skills, CHANGELOG. Remove `kanban-ship` from the flow.
- Migration: `.works/shipping` and `.works/dones` → `review` (unmerged) or `done` on the next `kf status`.

### Out of Scope
- A `kf travel` or `kf deliver` CLI command (travel is a skill).
- Copying an external orchestration pane or depending on an external CLI.
- Auto-merging PRs (`merge: manual` stays).
- Collapsing implementation / testing / review into one folder.
- A `chore` kind.
- Model escalation (`sonnet` → `opus`) — follow-up; this item uses the project’s drive runner.
- Changing issue types on other repositories.

## Affected surfaces
- CLI: `kf approve --backlog`, `kf stage` (no `shipping`; `dones` hints `done`), `kf archive` (internal / on-merge), `kf ship` deprecation, `kf drive` config root, `kf drive --status` / `--watch` worker activity and stop code `usage_limit`, `kf status` next-step.
- `runs/<id>.log` of a drive worker streams while the worker runs; the default `claude` runner argv.
- `.works/done/`; hook `dones.sh` renamed or keyed on stage `done`.
- `.kf/config.json` `statusMap`: `done: Done`; no `shipping` key.
- Skills: `kanban-flow`, `kanban-plan`, `kanban-implement`, `kanban-test`, `kanban-review`, `kanban-archive`; `kanban-ship` out of the flow; add `skills/travel/SKILL.md`.
- `.kf/travel/progress.md`, `.kf/travel/estimates.md` (contents gitignored).
- `docs/workflow/{lifecycle,state-machine,gates,cli-reference,harness,skills}.md`, CHANGELOG.
- GitHub issue-type catalog; issue #95 `type`.
- N/A: landing page, npm JS API besides the CLI.

## Actors
- Maintainer: **decide** (spec, plan, daily plan, destructive), **do** (merge PR), otherwise leave workers running.
- Travel: day orchestrator. Does not write product code.
- Drive workers: coder, tester, code-reviewer — one item worktree each.

## Functional Requirements

### FR-001 Stages
Legal stages: `brainstorm`, `planning`, `backlog`, `implementation`, `testing`, `review`, `done`, `cancelled`. `kf stage <n> shipping` and `kf stage <n> dones` fail with a hint (`shipping` is gone; `dones` → `done`).
Priority: must

### FR-002 Approve starts
`kf approve <n>` fingerprints the contract and stages to **implementation** (provisions a worktree when enabled). `kf approve <n> --backlog` fingerprints and stages to **backlog**. Skills do not ask start-vs-backlog.
Priority: must

### FR-003 Review = PR + reviewer + CI
After testing PASS, review, in this order: (a) spawn/run a **code-reviewer** on the branch diff (the orchestrator must not write the review report in place of that agent when a runner/subagent is available); a FAIL/REJECT verdict returns to implementation before any PR exists; (b) only after the reviewer PASS, push the item branch and open a PR if none is recorded — a PR is opened for reviewed code only; (c) if the repo has GitHub Actions on the PR, watch checks until green or failed; on fail, the item returns to implementation, the fix is re-tested and re-reviewed, then pushed to the same PR and watched again. No CI → skip watch, record “no CI” in the review report. The review report is written PASS only when the reviewer passed and CI is green or absent.
Priority: must

### FR-004 Re-test after change
Reviewer FAIL/REJECT, or CI red after a code fix that is not yet re-tested: return to implementation, new testing execution, then review again. Review PASS is refused while the current execution’s tests are not PASS or CI is red.
Priority: must

### FR-005 Merge closes the item
Review PASS + CI green (or no CI) + PR merged into the default branch, or PASS + nothing to land → item becomes `done` on the next `kf status` / `kf sync` / `kf archive`. Canonical docs land on `docs/<context>-<feature>` from `origin/main` when the current checkout is a deploy branch or behind origin. Worktree is removed; merged branch is deleted locally and on origin. Dirty worktree refuses the move. Unmerged recorded PR: close refuses (awaiting merge). Humans are not asked “archive?”.
Priority: must

### FR-006 Config from worktree or origin
`kf drive` loads `.kf/config.json` from the item worktree if it exists, else `origin/main`, else the primary checkout.
Priority: must

### FR-007 Status next-step
After review PASS with an unmerged PR, `kf status` next-step is to merge that PR (URL). After merge, the item is `done`. `kf ship` is never a next command.
Priority: must

### FR-008 Morning plan
`skills/travel/SKILL.md` is the day orchestrator. New calendar day (`date +%F`): read the last ledger section, carry every non-`done` line, add actionable kf items (implementation/testing/review with current approval; this repo’s PRs with red CI), size each line (FR-011), print today’s plan (Batch 1 within FR-013 budget, Needs you, Waiting to merge, Calibration), **wait for the human to approve or edit** before any `kf drive`. After approval, write `## YYYY-MM-DD` and start Batch 1. Same-day re-entry (`travel` / `continue`) resumes the loop and does not rebuild the plan.
Priority: must
Notes: #95, slices #96–#98.

### FR-009 Loop and end of day
After the plan is approved, travel loops until end of day: keep up to N slots (default 3, or `slots=N`) busy with `kf drive <feature>` for started items; do not pass `--watch`; poll `--status`. Collect stops; refill. Review PASS + CI green → ledger `waiting-to-merge` with the PR URL. `verify_failed` / FAIL review / crash: one crash retry then `blocked` with reason + next command. Travel does not `kf approve`, `kf archive`, or merge. A ledger line `driving` or `blocked` means travel owns that car: `kanban-flow` / `kanban-implement` must not start a second drive; the human session that opened the stop owns it until they say the fix is done. End of day (user says stop, or nothing actionable): print done / blocked / waiting-to-merge / carry-over; rewrite unfinished lines as `carry-over` for tomorrow.
Priority: must

### FR-010 Epic issue type
Repository `phuthuycoding/kanban-flow` has an enabled issue type named `Epic`. Issue #95 has that type. `gh issue create --type Epic` succeeds on this repo. Do not invent a kf command for issue types. If the API cannot create types on a user-owned repo, stop with the GitHub settings URL; do not fake a type with a label.
Priority: must
Notes: #100.

### FR-011 T-shirt size
Travel sizes every planned line **S=1 / M=2 / L=4 / XL=8**. Defaults (agent time, not human hours): S < 5 min and ≤ 3 files; M 5–20 min and ≤ 10 files; L 20–60 min and ≤ 30 files; XL > 60 min or > 30 files or needs a spec. Size is the **higher** of time vs files. XL is marked “should split” and is not dispatched until split or the human overrides. The thresholds never change: the estimate and the measured actual are both sized with these defaults, so the hit rate compares like with like. Learning corrects the estimated **minutes** per kind: each `estimates.md` row records the raw estimated minutes (`estmin`) and the measured `work`; once a kind has ≥ 20 measured rows with `estmin`, its factor = the median of `work ÷ estmin` over its last 30 such rows, clamped to 0.5–3, and the estimate's minutes are multiplied by the factor before sizing. The factor corrects both ways (work slower or faster than estimated), is computed only from raw estimates and measured work so it cannot feed on itself, and does not correct the file count. Rows without `estmin` are skipped for learning, not refused; travel also writes a row without `estmin` for an item that already had implementation, testing or review runs when travel first planned it (`learn=no`), because its `work` covers more than the estimate.
Amended 2026-10-31 (human decision): learning from the minutes error with one sizing rule for est and actual, replacing learned size thresholds and the “estimate one size up” advice; rows of items first planned mid-flight do not teach the factor.
Priority: must

### FR-012 Measure on done
When a ledger line becomes `done`, append one line to `.kf/travel/estimates.md`: `date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin` (`estmin` = the raw estimated minutes, FR-011; a row without it ends at `gap`). **work** = sum of the durations of the item's ended runs whose stage is implementation, testing or review, across every day, not only the day it closes (not time waiting on the human). `kf status --change <f> --json` exposes no approval timestamp, so the window is that stage filter: runs from before a re-approval are counted too. **path** = the distinct stages of those same runs, in order.
Amended 2026-10-31 (human decision): work and path across days in implementation/testing/review (no approval timestamp in kf status JSON, so filtered by stage), and the `estmin` field. **files** = `git diff --shortstat` of the item worktree vs its base. **actual** = size from work+files, higher of the two. Cancelled/restarted → `actual -`, excluded from stats.
Priority: must

### FR-013 Batch budget and calibration
Morning Batch 1 budget = median daily throughput (sum of actual points) when ≥ 3 days of estimates exist; otherwise 10 **tasks**. End of day prints hit rate (est=actual / n), bias (over vs under), throughput, and a warning if this week’s hit rate is below last week’s. The plan’s Calibration line states the rule and the history lines it rests on, or “none yet”. Compute in the skill from `estimates.md`. Do not require an external stats command.
Priority: must

### FR-014 Progress block
Travel’s progress block always shows: `running: A/SLOTS`; every **Needs you** line (decision + item id + question); every **Waiting to merge** line (PR URL + exact `gh pr merge` command); running item ids with worktree paths. `kf status --all` ends with the same two buckets computed from kf state — **Needs you** (items pending a human decision) and **Waiting to merge** (review PASS with an unmerged PR: URL + merge command; a canonical-docs branch awaiting push) — plus `Running: N` live drives; the slot ratio `A/SLOTS` is travel’s, since kf has no slots. Skills must not ask start-vs-backlog or ship-vs-archive in chat; those become Needs you or Waiting to merge.
Priority: must

### FR-015 One worktree per item
Each implementation/testing/review item has its own worktree. Travel will not dispatch two items in parallel that the plan marked `sequential` (same repo, overlapping files). Task worktrees still merge back and tear down per drive. Item worktree lives until `done` or `cancelled` (FR-005).
Priority: must

### FR-016 Drive shows its workers
While `kf drive` runs, a human can see what each worker is doing and why a worker stopped, without opening a JSON blob. (a) The worker's log `runs/<id>.log` fills while the worker runs (the default `claude` runner streams JSON lines; a runner that emits one JSON object at exit is still accepted). (b) `kf drive --status` and the `--watch` heartbeat print, per live run, the worker's latest activity: the last tool call (name plus the file or the head of the command) or the last assistant text, with its age; `--tail` prints those readable lines, not raw JSON. (c) When a worker exits non-zero, the task reason and the stop reason carry the worker's own error text (the `result` string of an `is_error` result), not only `worker exited 1`. (d) A worker that fails on an API usage limit (HTTP 429 / `usage_limit_reached`) does not burn a retry: the task returns to `pending`, the drive stops with code `usage_limit`, the reason quotes the worker's reset text, and `kf drive <feature>` later resumes the same worker session with its uncommitted work intact.
Priority: must

## Non-Functional Requirements
- Existing feature/bug tests update to the new stage names in the same change.
- Travel copies the **day shape and estimation mindset** of a nonstop day orchestrator. It does not copy an external pane or binary.
- #100 is a GitHub catalog change.

## Main Use Cases
- UC-001 Approve starts implementation; `--backlog` defers
- UC-002 Tester then independent review + PR + CI watch
- UC-003 Merge on GitHub then item is `done`, worktree gone
- UC-004 Stale primary checkout still drives from worktree config
- UC-005 Morning travel: carry-over + sized plan, human approves, loop; end of day stats + carry-over
- UC-006 Epic type exists; #95 is an Epic
- UC-007 Day progress: running A/SLOTS, Needs you vs Waiting to merge, two worktrees in parallel

## Constraints
- `merge: manual`: kf never squash-merges the feature PR.
- Contexts unchanged.
- Do not move `.works/` by hand; migration is kf.

## Assumptions
- No shipping stage; no required deliver command; PR+CI in review; merge closes the item.
- The human’s primary UX is the travel day block, not per-item chat gates.
- #95’s original “short skill, do not copy nonstop” is overridden.
- #96–#98 are slices of travel, not separate kf items.
- #106 is this kf issue; #95 and #100 are in-scope GitHub work.

## Acceptance Criteria
- [ ] `kf approve x` → implementation; `kf approve x --backlog` → backlog.
- [ ] `kf stage x shipping` exits non-zero.
- [ ] Review of a code item records a PR URL and, when Actions exist, a green (or fixed-to-green) check run before PASS.
- [ ] After that PR is merged, `kf status --change x` shows stage `done`, no worktree, board Done.
- [ ] Drive from a worktree whose primary `main` lacks `harness` still starts.
- [ ] `skills/travel/SKILL.md` implements morning plan + approve + loop + end-of-day carry-over; kanban-flow/implement treat travel as owner of `driving`/`blocked` cars.
- [ ] Plan lines carry a size; XL is flagged to split; Batch 1 respects FR-013 budget.
- [ ] A `done` travel line writes `estimates.md`; end-of-day prints hit rate, bias, throughput.
- [ ] Progress block shows `running: A/SLOTS`, Needs you (decisions only), Waiting to merge with a merge command.
- [ ] Two overlapping-file items are marked sequential and not driven in the same tick.
- [ ] `GET .../issue-types` includes Epic; issue #95 `type.name` is Epic.
- [ ] CHANGELOG + lifecycle/state-machine/harness/skills describe the two-layer day+item model without a ship gate.
- [ ] While a drive runs, `kf drive x --status` names each live worker's last tool call; a worker killed by a 429 leaves the drive stopped `usage_limit` with the reset text, the task `pending`, and the next `kf drive x` resumes its session.

## Edge Cases
- No CI: review PASS allowed after reviewer PASS; report says no CI.
- `kf ship`: non-zero, message points at review PR + merge + status.
- Leftover `.works/shipping/*` with a merged PR migrate to `done`; unmerged stay in `review` (awaiting merge).
- Second travel session must see `driving` and must not start a second drive.
- Epic type API forbidden: stop with the settings URL; do not close #100 as done.
- SLOTS full and Needs you non-empty: still print Needs you every tick.

## Open Questions
- None. `kf ship` / `kf deliver` are not built; `kf ship` is deprecated only.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest; stage/approve/archive/drive fixtures; source-surface test for travel skill text (progress block headings, estimate fields); live `gh api` for issue types in the work item, not in CI fixtures if types cannot be created there
- Coverage Target: 80% of new stage-name, approve-backlog, config-resolution, on-merge-done, and travel estimate helpers

## Related GitHub issues
- https://github.com/phuthuycoding/kanban-flow/issues/106 (this kf item)
- https://github.com/phuthuycoding/kanban-flow/issues/95 (travel)
- https://github.com/phuthuycoding/kanban-flow/issues/96 #97 #98 (travel slices)
- https://github.com/phuthuycoding/kanban-flow/issues/100 (Epic type)

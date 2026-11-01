---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case

> **Partly superseded by `drive-retire`:** the parts that use `kf drive` (config resolution, `--status`/`--watch`, drive supervisor and workers) or `kf run` no longer hold — both are removed; `travel` runs items itself in the session and the in-session loop is the only implementation path. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Morning travel: carry-over, sized plan, approval, loop, end of day |
| Requirement reference | FR-008, FR-009, FR-011, FR-012, FR-013 |
| Goal | One skill runs the day as a worker pool: plan in the morning with sizes and a budget, the human approves, the loop keeps N slots busy with `kf drive`, the day ends with stats and carry-over |
| Primary actor | Travel (`skills/travel/SKILL.md`) |

## Supporting Actors
- Maintainer (approves or edits the plan; merges PRs)
- `kf status --all --json`, `kf drive <feature>` / `--status`, `kf tasks <feature> --json`
- `skills/travel/scripts/estimates` (node: `size`, `measure`, `stats`, `overlap`)
- Ledger `.kf/travel/progress.md`, measurements `.kf/travel/estimates.md`

## Preconditions
- The project has `.works/` and a harness drive configured (`harness.verify.stage`, `worktree.enabled`).
- `.kf/travel/` is gitignored (seeded by `kf init`).

## Trigger
The maintainer says "travel" / "morning" / "continue" in a session.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Travel | Reads `date +%F`; when the ledger's last section is an earlier day: reads it, carries every non-`done` line forward | Carry-over list |
| 2 | Travel | Reads `kf status --all --json`; adds actionable items: implementation/testing/review with current approval and no `driving`/`blocked` owner; this repo's open PRs with red CI | Candidate list |
| 3 | Travel | Sizes each line with `estimates size <minutes> <files>` (S=1 / M=2 / L=4 / XL=8, the higher of time and files; learned thresholds once ≥ 20 measured rows); marks XL "should split"; marks pairs with overlapping Files `sequential` (`estimates overlap`) | Sized plan |
| 4 | Travel | Computes the Batch 1 budget (`estimates stats`: median daily throughput when ≥ 3 days exist, else 10 tasks) and prints today's plan: Batch 1, Needs you, Waiting to merge, Calibration line | Plan printed |
| 5 | Maintainer | Approves or edits the plan | Decision |
| 6 | Travel | Writes `## YYYY-MM-DD` to the ledger with the approved lines (`queued`), starts Batch 1: up to N slots (default 3, `slots=N`) of `kf drive <feature>` for started items, no `--watch` | Ledger lines `driving` |
| 7 | Travel | Loop: polls `kf drive <feature> --status`; on stop collects the code; refills slots from the queue; prints the progress block (UC-007) every tick | Items move |
| 8 | Travel | Review PASS + CI green → ledger `waiting-to-merge` with the PR URL and the exact merge command; `verify_failed` / FAIL review / crash → one crash retry then `blocked` with reason + next command | Buckets filled |
| 9 | Travel | When a line becomes `done` (kf reports stage `done`): `estimates measure` appends `date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap` to `estimates.md` | Measurement recorded |
| 10 | Travel | End of day (user says stop, or nothing actionable): prints done / blocked / waiting-to-merge / carry-over, hit rate, bias, throughput, a warning when this week's hit rate is below last week's; rewrites unfinished lines as `carry-over` | Ledger closed for the day |

## Alternative Flows
### A1 — same-day re-entry
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The ledger's last section is today | Resume the loop at step 7; do not rebuild the plan |

### A2 — fewer than 3 days of measurements
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Budget = 10 tasks; Calibration line says "none yet" | Plan printed |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A ledger line already says `driving` or `blocked` (another session owns it) | Travel does not start a second drive; the line is listed under Running or Needs you with its owner | One car, one owner |
| `kf drive` refuses (preconditions) | Line → `blocked` with kf's reason and next command | Needs you |
| XL line in Batch 1 | Not dispatched until split or the human overrides in the plan step | Needs you: "split or override" |
| Cancelled or restarted item | Measurement line with `actual -`, excluded from stats | Recorded |

## Postconditions
- The day's ledger section records every line's final state; `estimates.md` has one row per `done` line; carry-over seeds tomorrow.
- Travel never ran `kf approve`, `kf archive`, `kf stage` or a merge.

## Business Rules
- Travel does not write product code; coder/tester/reviewer are drive roles in item worktrees.
- Human decisions (spec, plan, daily plan, destructive) surface as Needs you; the merge is a Do with the command printed.
- No `kf travel` CLI; the helper script is `skills/travel/scripts/estimates`, run with `node`.

## Data
- `.kf/travel/progress.md`: `## YYYY-MM-DD` sections; lines `<id> · <feature> · <kind> · <size> · queued|driving|waiting-to-merge|blocked|done|carry-over · <note/url/next command>`.
- `.kf/travel/estimates.md`: header + one row per measured line, fields in FR-012 order.

## Acceptance Criteria
- [ ] `skills/travel/SKILL.md` implements morning plan → human approval → loop → end-of-day carry-over, and `kanban-flow`/`kanban-implement` treat a `driving`/`blocked` line as owned.
- [ ] Plan lines carry a size; XL is flagged to split; Batch 1 respects the FR-013 budget.
- [ ] A `done` line writes `estimates.md`; end of day prints hit rate, bias, throughput.
- [ ] `estimates size`, `stats`, `measure`, `overlap` behave per FR-011/012/013 and FR-015 in unit tests.

---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-007 |
| Name | Day progress: running A/SLOTS, Needs you vs Waiting to merge, parallel worktrees |
| Requirement reference | FR-014, FR-015 |
| Goal | Every travel tick answers three questions in one block — what must I decide, what must I do, how many workers are running — and two items never share a worktree or run in parallel when their files overlap |
| Primary actor | Travel |

## Supporting Actors
- Maintainer (reads the block; decides or merges)
- `kf drive --status --json`, `kf status --all --json`, `kf tasks <feature> --json`
- Phase skills (`kanban-flow`, `kanban-plan`, `kanban-review`) that write Needs you / Waiting to merge lines instead of asking in chat

## Preconditions
- A travel day is open (UC-005 step 6 done).

## Trigger
Every wake-up of the travel loop (a drive stop, a poll tick, the human typing `travel`).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Travel | Counts live drives (`driving` lines whose `kf drive --status` is running) against SLOTS | `running: A/SLOTS` |
| 2 | Travel | Collects every pending human **decision**: spec to confirm, plan to approve (or `--backlog`), destructive question, XL to split, a blocked line's question | `⏸ Needs you (decide)` lines: decision + item id + question |
| 3 | Travel | Collects every **Do**: review PASS + CI green items with an unmerged PR | `✓ Waiting to merge` lines: PR URL + `! gh pr merge <n>` (kf does not know the repo's merge style; the human picks it) |
| 4 | Travel | Lists running items with their worktree paths | `▶ Running` lines |
| 5 | Travel | Prints the block: `Tick N — running: A/SLOTS \| done: X \| blocked: Z \| queued: R \| points: P` then the three buckets | One block, always complete, even when SLOTS is full |

## Alternative Flows
### A1 — overlapping files
- Trigger: two queued items whose plans' `Files` unions overlap (`estimates overlap`), or the same repo with an unknown allowlist.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The pair is marked `sequential` in the plan; the second is not dispatched while the first is `driving` | At most one of them in Running per tick |

### A2 — two independent items
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Both dispatched; each `kf drive` works in its own item worktree (`.worktrees/<a>`, `.worktrees/<b>`) | Two Running lines with two worktree paths |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| SLOTS full and Needs you non-empty | Needs you is still printed every tick | The human is never left guessing |
| A phase skill asks start-vs-backlog or ship-vs-archive in chat while travel runs | That is a defect in the skill; the slim skills write the bucket line instead | Needs you / Waiting to merge |
| `kf status --all` run by hand during a travel session | Shows the same buckets from kf state (review PASS + unmerged PR = awaiting merge with URL) | Consistent surface |

## Postconditions
- The maintainer can act from the block alone: decide, merge, or leave the workers running.

## Business Rules
- Decisions and Dos are different buckets; a merge is never listed as a decision.
- One started item = one worktree = one slot.

## Data
- `.kf/travel/progress.md` lines; `kf drive --status --json` (step, live runs); `meta.pr`; plan `Files` columns.

## Acceptance Criteria
- [ ] The progress block shows `running: A/SLOTS`, Needs you (decisions only), Waiting to merge with a merge command, Running with worktree paths.
- [ ] Two overlapping-file items are marked sequential and are not driven in the same tick.
- [ ] Two independent items run in two worktrees at once.

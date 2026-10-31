---
name: travel
description: 'Run the day as a worker pool over kanban-flow items: a morning plan from yesterday''s carry-over and kf status, each line T-shirt sized against a daily budget, human approval, then a loop that keeps N slots busy with kf drive, sorts every stop into Needs you, Waiting to merge or blocked, and ends the day with calibration and carry-over. Use when the user says travel, morning, continue, or asks to run the day.'
---

# Travel — the day orchestrator

Argument: optional `slots=N` (default 3).

Travel runs the **day**; each item still walks its own ladder through `kf drive`. One started item = one worker slot = one item worktree. Travel writes no product code and edits no work item artifact.

**Travel only starts and reads drives.** It never runs `kf approve`, `kf archive`, `kf stage`, `kf ship`, `kf cancel` or a merge (`gh pr merge`, `git merge`, `git push`). Those are the human's: travel prints them as Needs you or Waiting to merge lines with the exact command. It runs `kf drive <f>`; do not pass `--watch` (or `--follow`) — a watcher blocks the session on one item.

State lives in two gitignored files (`kf init` seeds `.kf/travel/` into `.gitignore`):

| File | Holds | Format |
|---|---|---|
| `.kf/travel/progress.md` | the ledger: one `## YYYY-MM-DD` section per day | [references/ledger-format.md](references/ledger-format.md) |
| `.kf/travel/estimates.md` | one measured row per `done` line | [references/estimation.md](references/estimation.md) |

The helper is `node <this skill dir>/scripts/estimates` (`size`, `measure`, `stats`, `overlap`); it reads only its arguments and `estimates.md`. Below, `estimates` means that command.

---

## 0. Enter

```bash
date +%F
kf status --all --json
```

Read the last `## ` section of `.kf/travel/progress.md`.

- **Last section is today** → same-day re-entry: do not rebuild the plan. Go to §3 and resume the loop from the ledger.
- **Earlier day, or no ledger** → §1.

## 1. Morning plan

1. **Carry-over.** Every line of the last section whose state is not `done` becomes a candidate (its `carry-over` note says why).
2. **Actionable kf items.** From `kf status --all --json` → `features[]`: `stage` ∈ implementation / testing / review and `approval: "approved"`, not already a candidate. Skip any item a ledger line marks `driving` or `blocked` with another owner (§5).
3. **Red CI.** `gh pr list --state open --json number,url,headRefName,statusCheckRollup`: a PR with a failing check whose `headRefName` is an item's `worktree.branch` joins that item's line (note `CI red`); one that maps to no item goes to Needs you.
4. **Buckets.** `needsYou[]` and `waitingToMerge[]` of the same JSON become the plan's Needs you and Waiting to merge sections verbatim — including a `docsBranch` entry (a canonical-docs branch awaiting push, with its `git push` command).
5. **Size every line** — [references/estimation.md](references/estimation.md): estimate agent minutes and files, then `estimates size <minutes> <files> .kf/travel/estimates.md`. XL is marked `should split` and is not dispatched until the human splits it or overrides it in the plan.
6. **Sequential pairs.** For every pair of candidates, `estimates overlap "<files A>" "<files B>"` over the union of each item's pending task Files (`kf tasks <f> --json`). `sequential` → mark the pair; unknown Files (empty) is `sequential` with everything.
7. **Budget.** `estimates stats .kf/travel/estimates.md` → the `budget:` line (median daily actual points when ≥ 3 days are measured, else `10 tasks`) and the `calibration:` line. Fill Batch 1 in priority order (carry-over, then review, testing, implementation) until the next line would exceed the budget; the rest is Batch 2.
8. **Print the plan** in the shape of [references/daily-plan.md](references/daily-plan.md): Batch 1, Batch 2, Needs you, Waiting to merge, Calibration.

**Then wait for the human to approve or edit the plan.** No `kf drive` runs before that word. Apply edits (drop, reorder, resize, override an XL, change `slots=N`) and reprint once.

## 2. Open the day

After approval, append to `.kf/travel/progress.md`:

```text
## YYYY-MM-DD
slots: N · budget: <budget line>
t1 · <feature> · <kind> · <size> · queued · <note>
…
```

Rewrite the previous section's unfinished lines as `carry-over` (if the morning did not already). Then start the loop.

## 3. The loop

Each **tick**:

1. **Poll** every `driving` line: `kf drive <f> --status --json`. Act on `state` and `stopCode` (§4).
2. **Refill**: while live drives < N, take the next `queued` line (Batch 1 first, then Batch 2) that is not XL, whose item is in implementation / testing / review with a current approval, and that has no `sequential` partner already `driving`. A `sequential` pair is never dispatched in the same tick; two independent items run in two worktrees at once.

   ```bash
   kf drive <feature>
   ```

   Started or Resumed → line `driving`. Refused → line `blocked` with kf's reason and next command (Needs you).
3. **Print the progress block** (below) — every tick, even when every slot is full.
4. **Wait** 2–5 minutes (a background `sleep`, or the runtime's wait/monitor tool), then tick again. Never `--watch`.

**End of day** when the human says stop, or nothing is `driving` and nothing `queued` is dispatchable: §6.

### Progress block

Printed exactly in this shape, every tick:

```text
Tick N — running: A/SLOTS | done: X | blocked: Z | queued: R | points: P
⏸ Needs you (decide)
  - <id> <decision> <feature> — <question>
▶ Running
  - <id> <feature> <step> (<worktree path>)
✓ Waiting to merge (do this on GitHub)
  - <id> <PR URL> — ! gh pr merge <n> --squash
  - <id> <docsBranch> awaiting push — ! git push -u origin <docsBranch>
```

- `A` = `driving` lines whose `--status` state is `running`; `SLOTS` = N. `points` = the actual points of today's `done` lines.
- **Needs you** holds decisions only: spec to confirm, plan to approve (or `--backlog`), XL to split or override, a `blocked` line's question, a red-CI PR with no item, a destructive question. Each line names the decision, the item id and the question.
- **Running** names each live item with its worktree path (`worktree.path` from `kf status --change <f> --json`).
- **Waiting to merge** holds Dos: every review PASS item with an unmerged PR (URL + the exact merge command) and every `docsBranch` awaiting push. A merge is never a Needs you line.
- An empty bucket prints `  (none)`.

## 4. Stop codes

`kf drive <f> --status --json` gives `state` (`running` | `crashed` | `stopped` | `ready`), `stopCode`, `reason`, `nextCommand`.

| State / code | Ledger line | Action |
|---|---|---|
| `running` | `driving` | leave it |
| `ready` | `waiting-to-merge` | review PASS, PR open, CI watched: `kf status --change <f> --json` → `pr`; note the PR URL, `! gh pr merge <n> --squash` and `files=<n>` (§6 needs it after the worktree is gone) |
| `usage_limit` | stays `driving`, note `usage limit — reset <text from reason>` | the account is out of quota: dispatch nothing new, wait until the reset the reason quotes, then `kf drive <f>` (resumes the same worker session; it is not a retry) |
| `crashed`, `internal_error`, `verify_failed`, `worker_blocked` | `driving`, note `retry 1/1` → then `blocked` | one retry: `kf drive <f>`. Stopped again → `blocked` with kf's `reason` and `nextCommand` |
| `loop_limit`, `tasks_blocked`, `transition_refused`, `git_error`, `config_changed`, `budget` | `blocked` | reason + next command → Needs you |
| `requirement_bug`, `plan_change_needed`, `approval_changed` | `blocked` | the contract needs the human: Needs you with kf's `nextCommand` (a `kf stage … planning` travel prints, never runs) |
| `stopped_by_user` | `blocked`, note `stopped by the human` | the human owns it; never restart it |

When `kf status --all --json` shows a `waiting-to-merge` item at stage `done` (the human merged; `kf status` closed it): line → `done`, then measure (§6). A `blocked` line returns to `queued` only when the human says the fix is done.

## 5. Ownership

A ledger line `driving` or `blocked` means travel owns that item's drive: `kanban-flow` and `kanban-implement` sessions do not start a second `kf drive` on it (kf refuses a second live drive anyway). When the human opens a `blocked` item in another session, that session owns the fix until the human says it is done; travel then re-queues the line. A second travel session that finds a line `driving` lists it under Running and starts nothing for it.

## 6. Measure and end of day

**On `done`:** append the row ([references/estimation.md](references/estimation.md) says where each value comes from):

```bash
node <skill dir>/scripts/estimates measure --file .kf/travel/estimates.md --id <id> --feature <f> --kind <kind> --est <size> --work <minutes> --review <minutes> --files <n> --rounds <n> --path <stage→stage> --tier <tier>
```

A line cancelled or restarted from scratch gets the same call with `--cancelled` (`actual -`, excluded from stats).

**End of day:** print

```text
Day YYYY-MM-DD — done: X | blocked: Z | waiting-to-merge: W | carry-over: C | points: P
✓ Done          <id> <feature> <est>→<actual>
✗ Blocked       <id> <feature> — <reason> — next: <command>
✓ Waiting       <id> <PR URL> — ! gh pr merge <n> --squash
→ Carry-over    <id> <feature> <size>
<estimates stats lines: hit rate, bias, throughput, sizes, calibration, warning>
```

Then rewrite every line that is not `done` as `carry-over` with its note kept; `waiting-to-merge` and `blocked` keep their reason in the note so tomorrow's plan shows it.

---

## References

- [references/daily-plan.md](references/daily-plan.md) — the morning plan printout.
- [references/ledger-format.md](references/ledger-format.md) — `progress.md` sections, lines and states.
- [references/estimation.md](references/estimation.md) — sizes, inputs, `estimates.md` rows, budget and calibration.
- `scripts/estimates` — `size`, `measure`, `stats`, `overlap`; bad input exits 1 with a message.

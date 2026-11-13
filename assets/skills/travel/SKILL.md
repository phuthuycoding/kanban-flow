---
name: travel
description: 'Run the day as the controller of kanban-flow items: a morning plan from yesterday''s carry-over and kf status, each line T-shirt sized against a daily budget, human approval, then this session runs the phase skills of up to N started items, each in its own worktree, dispatching their seats in the background; sorts every stop into Needs you, Waiting to merge or blocked, and ends the day with calibration and carry-over. Use when the user says travel, morning, continue, or asks to run the day.'
---

# Travel — the day orchestrator

Argument: optional `slots=N` (default 3).

Travel runs the **day**, and after approval it is the controller: this session runs each item's phase skills itself (implementation, testing, review, each with its seats), the way one `kf:flow` session would. It keeps up to `slots=N` items started. One started item = one slot = its own worktree. It dispatches an item's seats (test-writer, developer, code-reviewer) in the background and advances another item while they run, so the slots overlap. `slots=1` behaves like one kanban-flow session: one item at a time, its phases in order. Travel writes no product code and edits no work item artifact.

**Travel never approves, archives, merges or pushes to main.** It never runs `kf approve`, `kf archive`, `kf cancel` or a merge (`gh pr merge`, `git merge`), and never pushes to main; its `kf status --all` refresh does close an item whose PR the human already merged — that close is kf's, on the human's merge. It may run the forward `kf stage` moves (implementation to testing to review), `kf stage <f> implementation` from testing or review on a FAIL verdict (the repair loop), and the item branch push and `gh pr create` that kf:test and kf:review prescribe, inside the item worktree. Every other backward, planning or backlog `kf stage` move, and every REQUIREMENT_BUG, is the human's. The human's commands are printed as Needs you or Waiting to merge lines with the exact command. Phase skills run inside the item worktree and branch, never on main.

State lives in two files under `.kf/travel/`, which is gitignored: `kf init` adds the `.gitignore` entry, and `kf doctor --fix` adds it to an upgraded project:

| File | Holds | Format |
|---|---|---|
| `.kf/travel/progress.md` | the ledger: one `## YYYY-MM-DD` section per day | [references/ledger-format.md](references/ledger-format.md) |
| `.kf/travel/estimates.md` | one measured row per `done` line | [references/estimation.md](references/estimation.md) |

The helper is `node ${CLAUDE_PLUGIN_ROOT}/assets/skills/travel/scripts/estimates` (`size`, `measure`, `stats`, `overlap`); it reads only its arguments and `estimates.md`. Below, `estimates` means that command.

---

## 0. Enter

```bash
date +%F
kf status --all --json
```

Read the last `## ` section of `.kf/travel/progress.md`.

- **Last section is today** → same-day re-entry. A session starting fresh, with no run of its own to continue, reads the `session:` line first: stamped under 60 minutes ago, stop and ask the human whether another travel session is running. Otherwise do not rebuild the plan. Go to §3 and resume the loop from the ledger; every `driving` `owner=travel` line is yours to resume; a `blocked` line stays blocked until the human says the fix is done (§5).
- **Earlier day, or no ledger** → §1.

## 1. Morning plan

1. **Carry-over.** Every line of the last section whose state is not `done` becomes a candidate (its `carry-over` note says why), except a `blocked` line and one marked `owner=human`: those stay under Needs you and are copied unchanged into each new day's section until the human says the fix is done. A line that was `driving` when the session ended is a candidate like any other; its item resumes from its own `loop/progress.md` (§3), never from the start.
2. **Actionable kf items.** From `kf status --all --json` → `features[]`: `stage` ∈ implementation / testing / review and `approval: "approved"`, not already a candidate. Skip any item with a `blocked` or `owner=human` line in the last section (§5).
3. **Red CI.** `gh pr list --state open --json number,url,headRefName,statusCheckRollup`: a PR with a failing check whose `headRefName` is an item's `worktree.branch` joins that item's line (note `CI red`); one that maps to no item goes to Needs you.
4. **Buckets.** `needsYou[]` and `waitingToMerge[]` of the same JSON become the plan's Needs you and Waiting to merge sections verbatim — including a `docsBranch` entry in `waitingToMerge[]` (legacy only: a canonical-docs branch an earlier release's close left — today's close writes nothing under `docs/` — awaiting push, or not proven merged with a `reason`, with the entry's own `command`) and a `canonical docs for <f> never landed` decision in `needsYou[]` (a docs branch with nothing left to push and no landing proven: re-land or leave them), or a `run <remedy> first, then re-run kf status --all: canonical docs for <f> are not proven landed` one when the lookup could not run until the human fixes the origin.
5. **Size every line** — [references/estimation.md](references/estimation.md): estimate agent minutes and files for the remaining work, then `estimates size <minutes> <files> .kf/travel/estimates.md <kind>`; it corrects the minutes by the kind's learned factor and sizes with the default thresholds. That size feeds only today's budget and batching. A line planned for the first time records `est0=<size>` (the size the human approves) and your raw minutes as `estmin=<n>`. A carried line keeps its first `est0` and `estmin`, because `work` is measured across days. XL is marked `should split` and is not dispatched until the human splits it or overrides it in the plan.
6. **Sequential pairs.** For every pair of candidates, `estimates overlap "<files A>" "<files B>"`; `sequential` → mark the pair. An item's files (`kf tasks <f> --json` → `tasks[]`):
   - pending tasks (not `done`) → the union of their `files`; any pending task with `files` null → `sequential` with everything;
   - no pending task (testing, review) → the `files` of every task in the plan;
   - a `pr` line → the PR's changed paths (`gh pr view <n> --json files`).
7. **Budget.** `estimates stats .kf/travel/estimates.md` → the `budget:` line (median daily actual points when ≥ 3 days are measured, else `10 tasks`) and the `calibration:` line. Fill Batch 1 in priority order (carry-over, then review, testing, implementation) until the next line would exceed the budget; the rest is Batch 2.
8. **Print the plan** in the shape of [references/daily-plan.md](references/daily-plan.md): Batch 1, Batch 2, Needs you, Waiting to merge, Calibration.

**Then wait for the human to approve or edit the plan.** No item is started before that word. Apply edits (drop, reorder, resize, override an XL, change `slots=N`) and reprint once.

## 2. Open the day

After approval, append to `.kf/travel/progress.md`:

```text
## YYYY-MM-DD
slots: N · budget: <budget line>
session: <ISO time from the clock>
t1 · <feature> · <kind> · <size> · queued · est0=<size> · estmin=<n> · <note>
…
```

Rewrite the previous section's unfinished lines as `carry-over` (if the morning did not already), leaving `blocked` and `owner=human` lines as they are; a carried item keeps its worktree and its `loop/progress.md`. Then start the loop.

## 3. The loop

Each **tick**:

1. **Collect** the seats that reported since the last tick (background notifications). For each, read the item's `loop/progress.md` and act as the item's phase skill says: the next task, the `kf verify` gate, the review, the fix loop. Advance every item whose seat reported; add the seat's reported duration to the item's `work=<n>`, and for a review seat also to its `review=<n>`, on its `.kf/travel/progress.md` line, except an implementation-phase seat when the item's ledger has timestamped seat lines, whose minutes `measure` takes from `kf loop-stats` (§6); dispatch the next seat of each in the background, then move on to another item while it runs. Never wait on one item's seat while another item has work to do.
2. **Refresh** `kf status --all --json`: replace Needs you and Waiting to merge with its `needsYou[]` and `waitingToMerge[]` plus travel's own decisions; a `waiting-to-merge` line whose item now has `stage` `done` → `done`, then measure (§6).
3. **Refill**: while started items < `slots=N`, take the next `queued` line (Batch 1 first, then Batch 2) that is not XL, whose item is in implementation / testing / review with a current approval, and whose `sequential` partners (if any) are all `done`: a partner that is `driving`, `waiting-to-merge` or `blocked` still blocks, because its changes are not on main yet. A `sequential` pair is never dispatched in the same tick; two independent items run in two worktrees at once. Start an item by creating or entering its worktree (`kf status --change <f> --json` → `worktree.path`) and running the phase skill for its current stage, exactly as a `kf:flow` session would; the line becomes `driving` with `owner=travel`.
4. **Print the progress block** (below) — every tick, even when every slot is full — and re-stamp the day's `session:` line from the clock.
5. **Wait** for the next seat to report (the runtime's wait/monitor tool; a background `sleep` of 2–5 minutes when nothing is due), then tick again.

**End of day** when the human says stop, or nothing is `driving` and nothing `queued` is dispatchable: §6.

**Resume after compaction.** Read `.kf/travel/progress.md` first, and keep replying to the human in the `language:` line of its last section until the human writes in another (today's section is the source of truth for which items are `driving`, `blocked`, `waiting-to-merge`), then each `driving` item's `loop/progress.md`: in implementation, the head and next task's ledger lines — each task's own seats, verify and rounds, read through `kf next --resume`, as kf:implement's Resume section says. Travel restarts no item: it never recreates a worktree that exists, never reruns a task already marked done there (a `complete` line), and re-dispatches only the seats the item's ledger shows unfinished.

### Line states

- `driving` — this travel session is running that item's phases (implementation, testing or review), with a seat possibly working in the background; the note carries `owner=travel`.
- `blocked` — a phase skill stopped for the human (REQUIREMENT_BUG, a plan change, a fix-loop breaker, a reopened task's `cap reached` stop): the line carries the reason, the next command and its owner (§5), and goes to Needs you. It returns to `queued` only when the human says the fix is done.
- `waiting-to-merge` — review PASS with the PR open: the line carries the PR URL, `! gh pr merge <n>`, `files=<n>` and `work=<n> review=<n>` (§6 needs them after the worktree is gone). The human merges.
- `done` — `kf status --all --json` reports stage `done` (merged and closed), or review passed with nothing to land (`landing: none`): measure at once (§6).

### Progress block

Printed exactly in this shape, every tick:

```text
Tick N — running: A/SLOTS | done: X | blocked: Z | queued: R | points: P
⏸ Needs you (decide)
  - <id> <decision> <feature> — <question>
▶ Running
  - <id> <feature> <step> (<worktree path>)
✓ Waiting to merge (do this on GitHub)
  - <id> <PR URL> — ! gh pr merge <n>
  - <id> <docsBranch> awaiting push — ! git push -u origin <docsBranch>
  - <id> <docsBranch> not proven merged (<reason>) — ! <command>
  - <id> <docsBranch> not proven merged (<reason>) — <next>
```

- `A` = `driving` lines; `SLOTS` = N. `points` = the actual points of today's `done` lines.
- **Needs you** holds decisions only: spec to confirm, plan to approve (or `--backlog`), XL to split or override, a `blocked` line's question, a red-CI PR with no item, a review PASS item kf could not close (`review PASS but not closed: <refusal heading> <failed check codes>`), canonical docs that never landed (`canonical docs for <f> never landed (<reason>): re-land them on a fresh docs branch for a PR with kf archive <f>, or leave them` — the human decides; travel never runs that `kf archive`), canonical docs that could not be looked up (`run git remote set-head origin -a first, then re-run kf status --all: canonical docs for <f> are not proven landed (<reason>); if they still are not, re-land them on a fresh docs branch for a PR with kf archive <f>, or leave them` when origin/HEAD is not set, `run git remote add origin <url> first, then ` when there is no origin — never called never landed), a destructive question. Each line names the decision, the item id and the question.
- **Running** names each live item with its worktree path (`worktree.path` from `kf status --change <f> --json`).
- **Waiting to merge** holds Dos: every review PASS item with an unmerged PR (URL + the exact merge command) and every `docsBranch` entry: `awaiting push` when it has no `reason` (with its `git push` command), `not proven merged (<reason>)` when it has one, with the entry's `command` copied verbatim — `git push -u origin <docsBranch>`, or `kf status --all` when the local branch is gone and the merged-PR lookup could not run; that entry has `kind: "lookup-rerun"` and its line is `not proven merged (<reason>) — <next>` with the entry's `next` copied verbatim (`re-run kf status --all once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive <f>`), the same step `kf status --all` prints, and `kf doctor` with its own re-run command (the re-land is the human's; travel never runs that `kf archive`). A merge is never a Needs you line; docs that never landed are never a Waiting to merge line.
- An empty bucket prints `  (none)`.

## 4. Stops

A phase skill stops for the human in a few ways. Travel does not retry or work around them:

| Stop | Ledger line | Action |
|---|---|---|
| REQUIREMENT_BUG, a plan change | `blocked` · `owner=travel` | the contract needs the human: Needs you with the next command the phase skill names (a `kf stage … planning` travel prints, never runs) |
| FAIL in testing or review | stays `driving` | run `kf stage <f> implementation` in the item worktree and continue the fix loop the phase skill names |
| fix-loop breaker, or a reopened task's `cap reached` stop, after any minimal fix past the cap the phase skill makes | `blocked` · `owner=travel` | reason + next command → Needs you |
| a usage limit on a seat | stays `driving`, note `usage limit — reset <text>` | dispatch nothing new; wait for the reset, then re-dispatch the seat that was running |
| any other stop the phase skill reports | `blocked` · `owner=travel` | its reason + next command → Needs you |
| review PASS, PR open | `waiting-to-merge` | note the PR URL, `! gh pr merge <n>`, `files=<n>`, `work=<n> review=<n>` |
| review PASS, nothing to land | `done` | measure at once (§6) |

Each tick's refresh (§3 step 2) catches a `waiting-to-merge` item at stage `done` (the human merged; `kf status --all` closed it): line → `done`, then measure (§6).

## 5. Ownership

Only one travel session runs per day, and the `session:` line under the day's heading (`references/ledger-format.md`) keeps a second one out: §0 stops and asks the human when it is under 60 minutes old. A ledger line `driving` or `blocked` means travel owns that item's phases while its note says `owner=travel`; it says `owner=human` once the human takes a `blocked` item into their own session (that session rewrites the token). A same-day re-entry of travel (§0, after a restart or compaction) is that same travel session: it resumes every `driving` `owner=travel` line and leaves `blocked` lines blocked. A session that is not travel never runs a task loop for an `owner=travel` line. An `owner=human` line belongs to the human's session until the human says the fix is done; travel then sets `owner=travel` and re-queues the line, and starts nothing for it before that.

## 6. Measure and end of day

**On `done`:** append the row ([references/estimation.md](references/estimation.md) says where each value comes from):

```bash
node ${CLAUDE_PLUGIN_ROOT}/assets/skills/travel/scripts/estimates measure --file .kf/travel/estimates.md --id <id> --feature <f> --kind <kind> --est <est0> --estmin <n> --work <minutes> --review <minutes> --files <n> --rounds <n> --path <stage→stage> --tier <tier>
```

`--est` is the line's `est0`, not today's re-size, so est and actual both cover the whole item.
For the implementation phase, `--work` and `--review` take that phase's minutes from `kf loop-stats <f> --json` when the item's ledger has timestamped seat lines — `--work` its `seatMinutes` (seat minutes, verify excluded), `--review` its `seats["code-reviewer"].sum` (code-reviewer minutes) — added to the line's `work=<n>` and `review=<n>`, and from seat notifications otherwise; the testing and review phases keep the notification source, summed on the line as §3 step 1 says.
A line cancelled or restarted from scratch gets the same call with `--cancelled` (`actual -`, excluded from stats).

**End of day:** print

```text
Day YYYY-MM-DD — done: X | blocked: Z | waiting-to-merge: W | carry-over: C | points: P
✓ Done          <id> <feature> <est>→<actual>
✗ Blocked       <id> <feature> — <reason> — next: <command>
✓ Waiting       <id> <PR URL> — ! gh pr merge <n>
→ Carry-over    <id> <feature> <size>
<estimates stats lines: hit rate, bias, throughput, calibration, kind (hit rate, bias, factor), warning>
```

Then rewrite every line that is not `done`, `blocked` or `owner=human` as `carry-over` with its note kept; `waiting-to-merge` keeps its reason in the note so tomorrow's plan shows it.

---

## References

- [references/daily-plan.md](references/daily-plan.md) — the morning plan printout.
- [references/ledger-format.md](references/ledger-format.md) — `progress.md` sections, lines and states.
- [references/estimation.md](references/estimation.md) — sizes, inputs, `estimates.md` rows, budget and calibration.
- `scripts/estimates` — `size`, `measure`, `stats`, `overlap`; bad input exits 1 with a message.

# Ledger — `.kf/travel/progress.md`

Gitignored. One section per day, newest last. The last section is the source of truth for the loop: on re-entry travel resumes from it, never from conversation memory.

```text
# Travel ledger

## 2026-10-30
slots: 3 · budget: 10 tasks (default — fewer than 3 days measured)
t1 · workflow-slim · feature · L · blocked · owner=travel · blocked: TASK-004 cap reached after a reopen — next: kf stage workflow-slim planning
t2 · cli-refactor · feature · M · done · merged https://github.com/<owner>/<repo>/pull/104
t3 · login-timeout · bug · S · carry-over · no item estimate · waiting-to-merge https://github.com/<owner>/<repo>/pull/105 — ! gh pr merge 105

## 2026-10-31
slots: 3 · budget: 8 points (median of 3 days)
session: 2026-10-31T14:02:11+07:00
t1 · workflow-slim · feature · L · driving · owner=travel · seat re-dispatched after the human's fix
t2 · login-timeout · bug · S · waiting-to-merge · no item estimate · https://github.com/<owner>/<repo>/pull/105 — ! gh pr merge 105
t3 · board-colours · feature · M · queued · sequential with t1
```

## Session

`session: <ISO time>`, written when travel starts the day and re-stamped from the clock at every progress block and every seat report.

## Line

`<id> · <feature> · <kind> · <size> · <state> · <note>`

- `id`: `t1`, `t2`, … unique within the day.
- `kind`: `feature` | `bug` | `pr`.
- `size`: `S` | `M` | `L` | `XL` — the item's recorded estimate (`kf estimate show <f> --json`), the same on every day it is carried; for an item with none, or a `pr` line, today's day-only size (budget and batching only), re-sized each morning from the remaining work.
- `note`: everything after the fifth ` · `; it carries `no item estimate` on a line sized for the day only, `owner=travel` or `owner=human` on a `driving` or `blocked` line, the PR URL and merge command, the blocked reason and next command, `sequential with <id>`, `usage limit — reset <text>`. The day section keeps only the day's plan: estimates and measurements are harness data (`kf estimate show`, `kf metrics`), never written here.

## States

| State | Meaning | Owner |
|---|---|---|
| `queued` | approved for today, not started | travel |
| `driving` | this travel session is running that item's phases in the item's worktree, seats working in the background; the item resumes from its `loop/progress.md` | `owner=travel` — no other session runs it |
| `waiting-to-merge` | review PASS with the PR open; the note has the URL and `! gh pr merge <n>` | the human merges |
| `blocked` | a phase skill stopped for the human (REQUIREMENT_BUG, a plan change, a fix-loop breaker, a reopened task's `cap reached` stop); the note has the reason and the next command | `owner=travel`, until the human opens it in their own session — then `owner=human` (that session), until the human says it is done and travel sets it back to `owner=travel` |
| `done` | kf reports stage `done` (merged and closed), or review passed with nothing to land (`landing: none`) | — |
| `carry-over` | end-of-day rewrite of any line not `done`, `blocked` or `owner=human`; the note keeps why | tomorrow's plan |

Edits are append-or-rewrite of today's section only. Earlier sections are history: travel rewrites the previous section's unfinished lines to `carry-over` once (`blocked` and `owner=human` lines stay, and are copied into each new day's section), at the start of the new day or at end of day, and never touches older ones.

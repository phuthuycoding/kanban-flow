# Ledger — `.kf/travel/progress.md`

Gitignored. One section per day, newest last. The last section is the source of truth for the loop: on re-entry travel resumes from it, never from conversation memory.

```text
# Travel ledger

## 2026-10-30
slots: 3 · budget: 10 tasks (default — fewer than 3 days measured)
t1 · workflow-slim · feature · L · blocked · owner=travel · est0=L · estmin=40 · blocked: TASK-004 cap reached after a reopen — next: kf stage workflow-slim planning
t2 · cli-refactor · feature · M · done · est0=M · estmin=12 · merged https://github.com/<owner>/<repo>/pull/104
t3 · login-timeout · bug · S · carry-over · est0=S · estmin=4 · waiting-to-merge https://github.com/<owner>/<repo>/pull/105 — ! gh pr merge 105 · files=3 · work=18 review=4

## 2026-10-31
slots: 3 · budget: 8 points (median of 3 days)
session: 2026-10-31T14:02:11+07:00
t1 · workflow-slim · feature · L · driving · owner=travel · est0=L · estmin=40 · seat re-dispatched after the human's fix
t2 · login-timeout · bug · S · waiting-to-merge · est0=S · estmin=4 · https://github.com/<owner>/<repo>/pull/105 — ! gh pr merge 105 · files=3 · work=18 review=4
t3 · board-colours · feature · M · queued · est0=M · estmin=15 · sequential with t1
```

## Session

`session: <ISO time>`, written when travel starts the day and re-stamped from the clock at every progress block and every seat report.

## Language

`language: <language>`, one line per day's section, in English (for example `Vietnamese`): the language travel replies to the human in, one per travel session, not per item. Travel writes it when the human first writes in a language other than English, and a new session resuming the ledger applies it until the human writes; a section without it falls back to the latest `Note reply language:` line of the `driving` items' `loop/progress.md`.

## Line

`<id> · <feature> · <kind> · <size> · <state> · <note>`

- `id`: `t1`, `t2`, … unique within the day.
- `kind`: `feature` | `bug` | `pr`.
- `size`: `S` | `M` | `L` | `XL` — today's estimate the human approved; a carried line is re-sized each morning from the remaining work (budget and batching only).
- `note`: everything after the fifth ` · `; it carries `est0=<size>` (the size approved when the line was first planned, passed to `measure` as `--est`) and `estmin=<n>` (the raw minutes passed to `estimates size`, kept for `measure`) — both kept by a carried line — `owner=travel` or `owner=human` on a `driving` or `blocked` line, the PR URL and merge command, the blocked reason and next command, `files=<n>`, `work=<n> review=<n>`, `sequential with <id>`, `usage limit — reset <text>`.

## States

| State | Meaning | Owner |
|---|---|---|
| `queued` | approved for today, not started | travel |
| `driving` | this travel session is running that item's phases in the item's worktree, seats working in the background; the item resumes from its `loop/progress.md` | `owner=travel` — no other session runs it |
| `waiting-to-merge` | review PASS with the PR open; the note has the URL, `! gh pr merge <n>`, `files=<n>` and `work=<n> review=<n>` | the human merges |
| `blocked` | a phase skill stopped for the human (REQUIREMENT_BUG, a plan change, a fix-loop breaker, a reopened task's `cap reached` stop); the note has the reason and the next command | `owner=travel`, until the human opens it in their own session — then `owner=human` (that session), until the human says it is done and travel sets it back to `owner=travel` |
| `done` | kf reports stage `done` (merged and closed), or review passed with nothing to land (`landing: none`) | — |
| `carry-over` | end-of-day rewrite of any line not `done`, `blocked` or `owner=human`; the note keeps why | tomorrow's plan |

Edits are append-or-rewrite of today's section only. Earlier sections are history: travel rewrites the previous section's unfinished lines to `carry-over` once (`blocked` and `owner=human` lines stay, and are copied into each new day's section), at the start of the new day or at end of day, and never touches older ones.

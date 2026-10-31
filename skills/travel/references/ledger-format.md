# Ledger — `.kf/travel/progress.md`

Gitignored. One section per day, newest last. The last section is the source of truth for the loop: on re-entry travel resumes from it, never from conversation memory.

```text
# Travel ledger

## 2026-10-30
slots: 3 · budget: 10 tasks (default — fewer than 3 days measured)
t1 · workflow-slim · feature · L · carry-over · blocked: verify_failed — npm test failed in harness.verify — next: kf drive workflow-slim
t2 · cli-refactor · feature · M · done · estmin=12 · merged https://github.com/<owner>/<repo>/pull/104
t3 · login-timeout · bug · S · carry-over · estmin=4 · waiting-to-merge https://github.com/<owner>/<repo>/pull/105 — ! gh pr merge 105 --squash · files=3 · work=18 review=4

## 2026-10-31
slots: 3 · budget: 8 points (median of 3 days)
t1 · workflow-slim · feature · L · driving · estmin=40 · retry 1/1 (crashed)
t2 · login-timeout · bug · S · waiting-to-merge · estmin=4 · https://github.com/<owner>/<repo>/pull/105 — ! gh pr merge 105 --squash · files=3 · work=18 review=4
t3 · board-colours · feature · M · queued · estmin=15 · sequential with t1
```

## Line

`<id> · <feature> · <kind> · <size> · <state> · <note>`

- `id`: `t1`, `t2`, … unique within the day.
- `kind`: `feature` | `bug` | `pr`.
- `size`: `S` | `M` | `L` | `XL` — the estimate the human approved.
- `note`: everything after the fifth ` · `; it carries `estmin=<n>` (the raw minutes passed to `estimates size`, kept for `measure`), the PR URL and merge command, the blocked reason and next command, `retry 1/1`, `files=<n>`, `work=<n> review=<n>`, `sequential with <id>`, `usage limit — reset <text>`, `re-adopted`, `adopted`, `driven elsewhere`.

## States

| State | Meaning | Owner |
|---|---|---|
| `queued` | approved for today, not started | travel |
| `driving` | `kf drive` started by travel (running, paused on a usage limit, or on its one retry); a drive still running at end of day stays `driving` and the morning re-adopts it | travel — no other session drives it |
| `waiting-to-merge` | drive `ready` with a PR: review PASS, PR open; the note has the URL, `! gh pr merge <n> --squash`, `files=<n>` and `work=<n> review=<n>` | the human merges |
| `blocked` | stopped for a reason travel cannot fix; the note has kf's reason and next command | travel, until the human opens it in a session — then that session, until the human says it is done |
| `done` | kf reports stage `done` (merged and closed), or the drive is `ready` with no PR (`landing: none`) | — |
| `carry-over` | end-of-day rewrite of any line not `done` (except a still-running `driving` line); the note keeps why | tomorrow's plan |

Edits are append-or-rewrite of today's section only. Earlier sections are history: travel rewrites the previous section's unfinished lines to `carry-over` once, at the start of the new day or at end of day, and never touches older ones.

# The task loop — why it is shaped this way

Read when choosing a model for a dispatch, running a fix round, resuming after compaction, or when a shortcut looks tempting.

## Model selection

Use the least powerful model that can do the role, and **name it on every dispatch** — a dispatch without a model lands on the runtime's default, which is a configuration, not a decision.

- **Mechanical implementation** (isolated functions, clear brief, one or two files): `sonnet`. Most tasks are mechanical when the plan is well-specified.
- **Integration and judgement** (multi-file coordination, pattern matching, debugging) and **design** (architecture, restructuring): `opus`.
- **Escalation:** the same test failing twice for one task → `opus` with the error brief on disk (the failing test, its output, the diff tried). A third time → stop dispatching implementers; investigate the root cause yourself or with the human.
- **Reviewers:** `sonnet` for a small mechanical diff, `opus` for a subtle one (concurrency, auth, data migration). Scoped re-reviews of a small fix diff take `sonnet`.
- Never below `sonnet` for an implementer or a reviewer: **turn count beats token price** — the cheapest tier takes two to three times the turns on multi-step work and costs more overall while doing worse.
- Under `kf drive`, the plan's `Role` column decides the runner and kf dispatches; this section applies to in-session subagents.

## The ledger

Conversation memory does not survive compaction. Controllers that lost their place have re-dispatched entire completed task sequences — the single most expensive failure observed. The ledger (`<item>/loop/progress.md`) is the recovery map: the commits it names exist in `git log` even when your context no longer remembers creating them. After compaction, trust the ledger and `git log` over your recollection.

Lines, in order of appearance:

```
# Task loop ledger — <feature> — plan: <abs path>
Scan: <TASK-A> vs <TASK-B> — <what one produces / the other consumes> — <ok | Ruling: ...>
Ruling: <decision> — <why> — <cost if wrong>
TASK-001: fix round 1/5 (2 addressed, 1 open — <one-liner>; commits a1b2c3d..d4e5f6a)
TASK-001: minor (deferred): <one-liner>
TASK-001: parked — <finding> — Ruling: <why>
TASK-001: complete (commits a1b2c3d..9f8e7d6, review clean)
```

When `.works/` is gitignored (the default `kf init` answer), the ledger travels with the item, not the branch; `kf archive` moves it with the item folder either way.

## The fix loop

- **Rounds 1–3 resume the original implementer.** Its context is intact: it knows the task, the code and its own choices. Send the open findings verbatim. If the runtime cannot message a live subagent, dispatch a fresh one carrying the brief path, the report path and the findings.
- **Rounds 4–5 dispatch a fresh implementer one tier up.** A loop that survives three resumes usually means the implementer cannot see its own problem — fresh eyes and a capability bump in one move.
- **Every round:** the implementer fixes, re-runs the tests covering the amended code, appends a fix report to the same report file and returns the short contract. Before re-dispatching the reviewer, confirm the fix report has the covering tests, the command and the output.
- **The re-review is scoped** to the findings and the fix diff. New findings on untouched code go to the ledger as deferred minors, not into the loop.
- **Adjudicate only at the cap.** Adjudicating earlier to end a loop is pre-judging under another name. At the cap, park the contestable with a ruling; rule on the smallest unblocking change for a load-bearing one. Parking a structural failure silently lets every dependent task build on it.
- **Never fix a finding yourself.** Controller fixes pollute your coordination context and skip review.
- The task reviewer's "minor" findings are deferred, not dropped: the review stage's pack carries them under `## Deferred`, where the whole-branch reviewer — with the entire diff in front of it — says must-fix or leave. A roll-up nobody reads is a silent discard; this is the reader.

## Rulings reach the human

Every `Ruling:` line is a decision you took on the human's behalf. Collect them into your final message under "Rulings I made", each with what it costs if wrong. A ruling that dies with the ledger was a decision made in secret. A wrong ruling costs rework the human can see and undo; a session parked on a question costs their whole day and buys nothing.

## Rationalizations to refuse

| Excuse | Reality |
| --- | --- |
| "Close enough on spec compliance" | Reviewer found spec gaps = not done. Fix or hit the cap and adjudicate — those are the only exits. |
| "I'll fix it myself, dispatching is overhead" | Controller fixes pollute your context and skip review. Resume the implementer. |
| "One more round will converge" | Past the cap the failure is structural. Adjudicate and route. |
| "The reviewer will just find something new anyway" | Scoped re-reviews verify fixes; they cannot wander. New findings on untouched code go to the ledger. |
| "This finding is obviously wrong, I'll drop it" | You adjudicate only at the cap, and every ruling is a ledger entry. Silent discards are forbidden. |
| "The fix was small, skip the re-review" | Unreviewed fixes are how regressions land. Every round ends with a scoped re-review. |
| "Ledger bookkeeping is overhead" | The ledger is what survives compaction. |
| "The implementer spawned its own reviewer — free extra assurance" | A duplicate seat reviewing the same diff; the task review is the gate. A worker-spawned reviewer is a defect to flag, not rigour. |
| "Two tasks touch different files, run them in parallel" | Same git history: task A's review package contains task B's commits and the reviewer grades the wrong diff, silently. Parallel only across worktrees — that is what `kf drive` is for. |

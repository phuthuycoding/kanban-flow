# The task loop — why it is shaped this way

Read when choosing a model for a dispatch, running a fix round, resuming after compaction, or when a shortcut looks tempting.

## Model selection

Use the least powerful model that can do the role, and **name it on every dispatch** — a dispatch without a model lands on the runtime's default, which is a configuration, not a decision.

- **Mechanical implementation** (isolated functions, clear brief, one or two files): `sonnet`. Most tasks are mechanical when the plan is well-specified.
- **Integration and judgement** (multi-file coordination, pattern matching, debugging) and **design** (architecture, restructuring): `opus`.
- **Seats:** `sonnet` by default for the test-writer, the developer and the automation-writer; `opus` for a developer on multi-file coordination or design judgement, or when the same test fails twice. Fix rounds 4–5 go one tier up.
- **Escalation:** the same test failing twice for one task → `opus` with the error brief on disk (the failing test, its output, the diff tried). A third time → stop dispatching developers; investigate the root cause yourself or with the human.
- **Reviewers:** `sonnet` for a small mechanical diff, `opus` for a subtle one (concurrency, auth, data migration). Scoped re-reviews of a small fix diff take `sonnet`.
- Never below `sonnet` for an implementer or a reviewer: **turn count beats token price** — the cheapest tier takes two to three times the turns on multi-step work and costs more overall while doing worse.

## The ledger

Conversation memory does not survive compaction. Controllers that lost their place have re-dispatched entire completed task sequences — the single most expensive failure observed. The ledger (`<item>/loop/progress.md`) is the recovery map: the commits it names exist in `git log` even when your context no longer remembers creating them. After compaction, trust the ledger and `git log` over your recollection.

Every line after the header ends with ` @ <ISO-8601 timestamp with offset>` — the moment the line was written, e.g. ` @ 2026-11-01T18:41:26+07:00` — and a line gets exactly one suffix, never a second suffix. The suffix comes last so the `TASK-NNN:` that travel and the resume rule read stays first.

The lines `kf loop-stats` reads follow one grammar:

```
TASK-NNN: <seat> dispatched model=<model>[ round=<R>][ cascade=<sha7>] @ <ts>
TASK-NNN: <seat> done status=<STATUS> @ <ts>
TASK-NNN: verify started @ <ts>
TASK-NNN: verify done exit=<n> @ <ts>
TASK-NNN: developer waits — <reason> @ <ts>
TASK-NNN: fix queued — developer TASK-MMM in flight @ <ts>
TASK-NNN: fix round <R>/5 (…) @ <ts>
TASK-NNN: cascade re-review owed — after <sha7> of TASK-MMM @ <ts>
TASK-NNN: complete (…) @ <ts>
```

`<seat>` is one of `test-writer`, `developer`, `automation-writer`, `code-reviewer`. `<STATUS>` is the seat's reported status; a code-reviewer's is `clean` or `findings`. `<model>` is the model the dispatch named. The commit field is the task's commit list in history order, `commits <a7>,<b7>,…`, never a range: the fix round line reads `TASK-NNN: fix round <R>/5 (<X> addressed, <Y> open — <one-liners>; commits <a7>,<b7>,…) @ <ts>` with the round's fix commits, and the complete line `TASK-NNN: complete (commits <a7>,<b7>,…, review clean) @ <ts>` or `… (<K> parked) @ <ts>` with all of the task's commits. Travel counts rounds by the lines containing `fix round`, so no other line shape contains that phrase.

`fix queued` is a legacy shape: the loop no longer writes it — a fix round held by the cap writes `developer waits — 4 developers in flight` instead — but older ledgers carry it, and `kf loop-stats` still reads it.

One example of each shape — in the grammar's order, from different points of one loop, with both wait lines and the `fix queued` line as a legacy line from an older ledger — then a ruling and a hashes line:

```ledger-example
TASK-001: developer dispatched model=sonnet @ 2026-11-01T18:41:26+07:00
TASK-001: developer done status=DONE @ 2026-11-01T19:02:10+07:00
TASK-001: verify started @ 2026-11-01T19:02:40+07:00
TASK-001: verify done exit=0 @ 2026-11-01T19:04:05+07:00
TASK-002: developer waits — Files overlap src/cli/args.ts / src/cli/args.ts (TASK-001) @ 2026-11-01T19:04:30+07:00
TASK-006: developer waits — 4 developers in flight @ 2026-11-01T19:05:10+07:00
TASK-003: fix queued — developer TASK-004 in flight @ 2026-11-01T20:15:12+07:00
TASK-003: fix round 1/5 (1 addressed, 0 open — empty list rejected; commits d4e5f6a) @ 2026-11-01T20:31:48+07:00
TASK-004: cascade re-review owed — after d4e5f6a of TASK-003 @ 2026-11-01T20:31:55+07:00
TASK-003: complete (commits a1b2c3d,d4e5f6a, review clean) @ 2026-11-01T20:40:02+07:00
Ruling: the empty commit list exits 3, not 1 — the requirement calls it bad input — cost if wrong: one re-run @ 2026-11-01T20:41:10+07:00
TASK-001: test hashes src/tests/verify.test.ts=72d245a130481dcd4de1129b37d039ebf1371023 @ 2026-11-01T20:42:30+07:00
```

The other lines carry the same suffix and are not parsed for figures — rulings, test hashes, test disputes, deferred minors, parked findings, briefs, review packages, wave lines and notes, including the stand-in note written right after a stand-in seat's dispatched line:

```
# Task loop ledger — <feature> — plan: <abs path>
Scan: <TASK-A> vs <TASK-B> — <what one produces / the other consumes> — <ok | Ruling: ...> @ <ts>
Ruling: <decision> — <why> — <cost if wrong> @ <ts>
TASK-002: no test-writer — <why> @ <ts>
TASK-001: test hashes <file>=<sha> … @ <ts>
TASK-001: test dispute <file:line> — <fixed | kept, Ruling | stopped> @ <ts>
TASK-001: minor (deferred): <one-liner> @ <ts>
TASK-001: parked — <finding> — Ruling: <why> @ <ts>
Note TASK-NNN: <seat> stand-in general-purpose @ <ts>
Note TASK-NNN: developer seat inline @ <ts>
```

In an inline wave (`Execution: wave <w> inline` in the plan) the controller fills the developer seat and keeps the `developer dispatched` … `developer done` pair, with the inline note right after the dispatched line.

A new `test hashes` line follows every test-writer change; the latest one is the baseline.

When `.works/` is gitignored (the default `kf init` answer), the ledger travels with the item, not the branch; `kf archive` moves it with the item folder either way.

## Parallel developers

A worktree runs up to the **cap of 4** developer seats at once — a task's developer, a fix-round developer and a resume-commit developer (the one resumed to commit specs or fixed tests) each count one. A task's developer is dispatched only under the three dispatch conditions: every dependency's developer has reported DONE, so its task commit exists; the task's test-writer is done and its test hashes are ledgered; and its Files overlap no open task. An **open task** is a task with a `test-writer dispatched` or a `developer dispatched` line and no `complete` line yet (a task whose test-writer is in flight counts as open, and so does one whose tests are written and whose developer waits for a seat), checked against the `overlaps` list of `kf tasks <f> --json`; a task with unknown Files overlaps everything. A task whose tests are written — a `test-writer done` line and no `developer dispatched` line — does not hold back the developer of a task earlier in plan order: the earlier task's developer goes first, and the later task's developer waits for the earlier task's `complete`. A task whose test-writer is still in flight holds back every task that overlaps it. The cap rests on a probe: 4 full suites in one worktree all passed, at about 1.8× the throughput of one. Gating on open tasks rather than running developers keeps a later fix round of one task out of files another developer is changing.

The two wait lines:

```
TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)
TASK-NNN: developer waits — 4 developers in flight
```

The first waits for `TASK-MMM: complete`; the second, a fix round's included, waits for the next `developer done`. When a seat frees up, a freed seat goes first to waiting fix-round and resume-commit developers, then to new task developers in plan order: finishing an open task closes it sooner than opening another.

## The fix loop

- **Rounds 1–3 resume the original developer.** Its context is intact: it knows the task, the code and its own choices. Send the open findings verbatim. If the runtime cannot message a live subagent, dispatch a fresh one carrying the brief path, the report path and the findings.
- **Rounds 4–5 dispatch a fresh developer one tier up.** A loop that survives three resumes usually means the developer cannot see its own problem — fresh eyes and a capability bump in one move.
- **Findings about a test go to the test-writer** (a spec's to the automation-writer), which owns the file; the controller re-hashes the changed test files into a new `test hashes` ledger line, and the developer then commits the fixed file unchanged. The round counts the same — one counter, five rounds per task.
- **Every round:** the fixing seat fixes, re-runs the tests covering the amended code, appends a fix report to the same report file and returns the short contract. Before re-dispatching the reviewer, confirm the fix report has the covering tests, the command and the output.
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
| "I'll fix it myself, dispatching is overhead" | Controller fixes pollute your context and skip review. Resume the developer. |
| "One more round will converge" | Past the cap the failure is structural. Adjudicate and route. |
| "The reviewer will just find something new anyway" | Scoped re-reviews verify fixes; they cannot wander. New findings on untouched code go to the ledger. |
| "This finding is obviously wrong, I'll drop it" | You adjudicate only at the cap, and every ruling is a ledger entry. Silent discards are forbidden. |
| "The fix was small, skip the re-review" | Unreviewed fixes are how regressions land. Every round ends with a scoped re-review. |
| "Ledger bookkeeping is overhead" | The ledger is what survives compaction. |
| "The developer spawned its own reviewer — free extra assurance" | A duplicate seat reviewing the same diff; the task review is the gate. A worker-spawned reviewer is a defect to flag, not rigour. |
| "Tasks touch different files, run them all in parallel" | Up to 4 developers, and only under the dispatch conditions: dependencies' developers done, test hashes ledgered, and Files that `overlaps` in `kf tasks <f> --json` says are disjoint from every open task. Each task's package and `kf verify` take its own commit list, never a range: a range would carry another task's commits and the reviewer would grade the wrong diff, silently. |

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

Every line after the header ends with ` @ <ISO-8601 timestamp with offset>` — the moment the line was written, read from the clock with `date +%Y-%m-%dT%H:%M:%S%z | sed 's/\(..\)$/:\1/'` and never estimated, a `T` between date and time and the offset as `±hh:mm`, e.g. ` @ 2026-11-01T18:41:26+07:00` — and nothing follows it; a line gets exactly one suffix, never a second suffix, and never starts with a markdown bullet. The suffix comes last so the `TASK-NNN:` that travel and the resume rule read stays first.

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

An inline developer seat has no dispatch and so no model to name: its `dispatched` line carries `model=inline` (`TASK-NNN: developer dispatched model=inline @ <ts>`), followed by `Note TASK-NNN: developer seat inline`.

`<seat>` is one of `test-writer`, `developer`, `automation-writer`, `code-reviewer`. `verify done exit=<n>` is the exit code `kf verify` returned, never one from another command. `<STATUS>` is the seat's reported status; a code-reviewer's is `clean` or `findings`. `<model>` is the model the dispatch named. The commit field is the task's commit list in history order, `commits <a7>,<b7>,…`, never a range: the fix round line reads `TASK-NNN: fix round <R>/5 (<X> addressed, <Y> open — <one-liners>; commits <a7>,<b7>,…) @ <ts>` with the round's fix commits, and the complete line `TASK-NNN: complete (commits <a7>,<b7>,…, review clean) @ <ts>` or `… (<K> parked) @ <ts>` with all of the task's commits. Travel counts rounds by the lines containing `fix round`, so no other line shape contains that phrase.

Fields are a closed set in a fixed order: a `dispatched` line carries `model=`, then `round=` when it has one, then `cascade=` when it has one, and nothing else; a `done` line carries `status=<STATUS>` and nothing else — never `round=`, `commits=`, `lane=` or any other field, and nothing after the status word. Detail goes on its own `Note TASK-NNN: <detail>` line. Parallel work on one task is not allowed: split it into tasks. `<R>` is the round number, counted from 1: on a round seat, the task's own round R of the fix loop (a review repair continues that count); on a cascade re-review, the round of TASK-MMM whose fix commit is `<sha7>`.

`fix queued` is a legacy shape: the loop no longer writes it — a fix round held by the cap writes `developer waits — <N> developers in flight` instead — but older ledgers carry it, and `kf loop-stats` still reads it.

One example of each shape, first seen in the grammar's order, from different points of one loop — both wait lines, the `fix queued` line as a legacy line from an older ledger, a round's developer pair (`round=1`) and the cascade re-review that answers the owed line — then a ruling and a hashes line:

```ledger-example
TASK-001: developer dispatched model=sonnet @ 2026-11-01T18:41:26+07:00
TASK-001: developer done status=DONE @ 2026-11-01T19:02:10+07:00
TASK-001: verify started @ 2026-11-01T19:02:40+07:00
TASK-001: verify done exit=0 @ 2026-11-01T19:04:05+07:00
TASK-002: developer waits — Files overlap src/cli/args.ts / src/cli/args.ts (TASK-001) @ 2026-11-01T19:04:30+07:00
TASK-006: developer waits — 2 developers in flight @ 2026-11-01T19:05:10+07:00
TASK-003: fix queued — developer TASK-004 in flight @ 2026-11-01T20:15:12+07:00
TASK-003: developer dispatched model=sonnet round=1 @ 2026-11-01T20:16:40+07:00
TASK-003: developer done status=DONE @ 2026-11-01T20:28:05+07:00
TASK-003: fix round 1/5 (1 addressed, 0 open — empty list rejected; commits d4e5f6a) @ 2026-11-01T20:31:48+07:00
TASK-004: cascade re-review owed — after d4e5f6a of TASK-003 @ 2026-11-01T20:31:55+07:00
TASK-004: code-reviewer dispatched model=sonnet round=1 cascade=d4e5f6a @ 2026-11-01T20:32:20+07:00
TASK-003: complete (commits a1b2c3d,d4e5f6a, review clean) @ 2026-11-01T20:40:02+07:00
Ruling: the empty commit list exits 3, not 1 — the requirement calls it bad input — cost if wrong: one re-run @ 2026-11-01T20:41:10+07:00
TASK-001: test hashes src/tests/verify.test.ts=72d245a130481dcd4de1129b37d039ebf1371023 @ 2026-11-01T20:42:30+07:00
```

The other lines carry the same suffix and are not parsed for figures — rulings, test hashes, test disputes, deferred minors, parked findings, briefs, review packages, wave lines and notes, including the developer cap rulings, the verify rerun note and the `Note wave <w>: no step-up` line of § Parallel developers, the stand-in note written right after a stand-in seat's dispatched line, the reopened note of a review repair and the no-subagent line:

```
# Task loop ledger — <feature> — plan: <abs path>
Scan: <TASK-A> vs <TASK-B> — <what one produces / the other consumes> — <ok | Ruling: ...> @ <ts>
Ruling: <decision> — <why> — <cost if wrong> @ <ts>
TASK-002: no test-writer — <why> @ <ts>
TASK-001: test hashes <file>=<sha> … @ <ts>
TASK-001: test dispute <file:line> — <fixed | kept, Ruling | stopped> @ <ts>
TASK-001: minor (deferred): <one-liner> @ <ts>
TASK-001: parked — <finding> — Ruling: <why> @ <ts>
TASK-001: unverified — <claim only a real run can answer> @ <ts>
Note TASK-NNN: <seat> stand-in general-purpose @ <ts>
Note TASK-NNN: developer seat inline @ <ts>
TASK-NNN: brief written @ <ts>
TASK-NNN: review package <sha7>,… @ <ts>
wave <w>: parallel test-writers TASK-A, TASK-B — disjoint Files @ <ts>
wave <w>: sequential TASK-A, TASK-B — Files overlap <entry> / <entry> @ <ts>
wave <w>: sequential TASK-A, TASK-B — Files unknown @ <ts>
Note TASK-NNN: verify rerun — contention <signature> @ <ts>
Note wave <w>: no step-up — <reason> @ <ts>
Note TASK-NNN: reopened — <testing|review|ci> <first 8 chars of the execution id> @ <ts>
Note TASK-NNN: verify waits — <file> (TASK-MMM) @ <ts>
TASK-NNN: implemented, test-writer seat: none, review seat: none @ <ts>
```

A `reopened` note cancels the task's earlier `complete` line: wherever the loop asks whether a task is complete, only a `complete` line after its latest `reopened` note counts (`kf:implement` § 3.4). The `implemented` line of a session with no subagent tool counts as the task's `complete` line, on resume too.

In an inline wave (`Execution: wave <w> inline` in the plan) the controller fills the developer seat and keeps the `developer dispatched` … `developer done` pair, with the inline note right after the dispatched line.

A new `test hashes` line follows every test-writer change; the latest one is the baseline.

When `.works/` is gitignored (the default `kf init` answer), the ledger travels with the item, not the branch; `kf archive` moves it with the item folder either way.

## Parallel developers

A worktree runs at most the **live cap** N developer seats at once — a task's developer (a chain subagent included; the controller's inline seat does not count, or at N = 1 an inline task and an earlier task's fix round would hold each other), a fix-round developer and a resume-commit developer (the one resumed to commit specs or fixed tests) each count one. A task's developer is dispatched only under the three dispatch conditions: every dependency's developer has reported DONE, so its task commit exists; the task's test-writer is done and its test hashes are ledgered; and its Files overlap no open task. An **open task** is a task with a `test-writer dispatched` or a `developer dispatched` line and no `complete` line after it (a task whose test-writer is in flight counts as open, and so does one whose tests are written and whose developer waits for a seat), checked against the `overlaps` list of `kf tasks <f> --json`; a task with unknown Files overlaps everything. Overlapping tasks open in wave order: a seat that would open its task — its test-writer, its developer when it has a `no test-writer` line, or a reopened task's first round seat — never starts while an earlier task that overlaps it is not complete (a lower wave of `kf tasks <f> --graph`, then plan order within a wave; a dependency always sits in a lower wave), so a developer never waits on a later task and two overlapping tasks never wait on each other. Gating on open tasks rather than running developers keeps a later fix round of one task out of files another developer is changing.

The cap is live because no fixed number fits every project: one probe here had 4 full suites in one worktree pass at about 1.8× the throughput of one, but a suite that shares a database or binds fixed ports breaks at 2, and a light one is held back at 4. The ceiling is `harness.developers.max` (an integer 1–16, default 6), read from `kf tasks <f> --json` field `developers.max`; the start value and the step rules are not configurable. `source: "invalid-config"` means `.kf/config.json` failed for another key: the ceiling is unknown, so it reads 1 and `developers.error` says why — ledger a `Ruling:` that quotes it and report it to the human. The loop starts at N = min(2, `harness.developers.max`) — 2 is the smallest value that still runs anything in parallel — and ledgers `Ruling: developer cap <N> — start — cost if wrong: <…>` before its first developer dispatch. A wave is a wave of `kf tasks <f> --graph`, complete when every task in it has a `complete` line, and clean when none of its tasks had a contention-shaped verify failure (a verify failure belongs to the wave of the task whose verify failed; a `Note TASK-NNN: verify rerun` line marks one). Step up additively: +1 per clean parallel wave (a parallel wave has more than one task), decided in wave order, never in the order waves finish: the decision is due at the `complete` line that leaves wave w and every earlier wave complete, so it rests on the ledger alone and two controllers reach the same N. An inline wave never changes N, nor does any other one-task wave, nor a wave that is not clean, even when its re-runs passed. Every step-up decision is written when it is due, the ones that change nothing included, so a resumed controller never re-decides one against a different N: a clean parallel wave ledgers `Ruling: developer cap <old> → <new> — wave <w> clean — cost if wrong: <…>`, unless N + 1 would exceed the ceiling, no wave is left incomplete at that due `complete` line (nothing remains for a higher N to run), or N + 1 would exceed the width of the widest incomplete wave — the most tasks in any wave not complete at that line, read from the ledger up to it, not when the decision is written; any other outcome writes `Note wave <w>: no step-up — <not clean | inline | ceiling | last wave | widest incomplete wave>`, naming the first that applies in that order (`inline` for every one-task wave) — a note, not a cap ruling, which `kf loop-stats` reads as an other-timed line. Fix-round and resume-commit seats count against N whatever the wave width.

Step down multiplicatively, and tell contention from a real failure by one re-run instead of a solo run of the whole suite. Only the controller's ledgered verify runs count — a `TASK-NNN: verify started` … `verify done exit=1` pair; `kf verify --stage` and developers' own runs never change N. The ledger does not keep verify output, so the controller saves each `kf verify` output to `<item>/loop/task-NNN-verify.log`, appending one block per run headed by the run's `verify started` timestamp, and classifies contention — live and on resume — from the block of the run being classified, never from the whole file: an earlier run's block says nothing about this one. A failure is contention-shaped when that block contains one of these strings: `EADDRINUSE`, `index.lock`, `database is locked`, `SQLITE_BUSY`, `Lock wait timeout exceeded`, `ETIMEDOUT`, `ECONNREFUSED`, `Test timed out`, `Hook timed out` — an assertion failure beside one included. Its `<signature>` is the first string of that list, in list order, that the output contains. A re-run is a verify whose `verify started` follows a `Note TASK-NNN: verify rerun` line of that task with no `verify done` of that task between them. On a contention-shaped failure of a verify that is not a re-run, the controller, in order: (1) halves N to max(1, ⌊N/2⌋) and ledgers `Ruling: developer cap <old> → <new> — <signature> in TASK-NNN verify — cost if wrong: <…>`, unless N already dropped since that verify started — a step-down ruling `Ruling: developer cap … in TASK-MMM verify` of any signature, of any task, written after this task's `verify started` line marks the same contention event, and a `ceiling lowered` ruling never does — or unless this task already has a `Ruling: developer cap … — <signature> in TASK-NNN verify` line with the same signature and no `verify done exit=0` of this task after it, in which case N stays; so N halves at most once per contention event, and at N = 1 it stays 1 with no ruling; (2) ledgers `Note TASK-NNN: verify rerun — contention <signature>`, a note line that `kf loop-stats` does not read as a `verify` shape; (3) dispatches no new developer, and holds the re-run, until fewer than N developer seats are in flight; (4) runs one re-run of that verify (`verify started` / `verify done`). A pass completes the check with no fix round. A re-run's failure never triggers steps 1–4 nor resume rule (c): N is unchanged and the failure goes straight to the fix loop, or to the other-task routing of `kf:implement` § A verify failure in another task's Files, which applies only after the re-run. Each failing verify of one event gets its own one re-run; a real hang that prints `Test timed out` costs one re-run before it reaches the fix loop. A task steps N down at most once per signature until one of its verifies passes: a later failure of that task with that signature skips only step 1 and still gets its rerun note and one re-run, with N unchanged — on resume too, since rule (c) owes steps 1–4 with step 1's exceptions.

On resume N is rebuilt before anything is re-dispatched or re-run (`kf:implement` § Resume the live cap): (a) the cap the latest `Ruling: developer cap` line sets, or min(2, `harness.developers.max`) with none — then ledger the start ruling — capped at the current max, a lowered max ledgered `Ruling: developer cap <old> → <new> — ceiling lowered to <max> — cost if wrong: <…>`; (b) a `Note TASK-NNN: verify rerun` line with no later `verify done` of that task is a pending re-run, an orphan one (its `verify started` with no `done`) included, held until fewer than N developer seats are in flight, never a fix round; (c) a latest `verify done exit=1` of a verify that is not a re-run, contention-shaped by its block in `task-NNN-verify.log`, with no later rerun note, is an owed step-down: it owes steps 1–4 above; a failed verify with no log block is re-run once as a plain verify and its output classified — it is not a re-run, so a contention-shaped failure of it owes steps 1–4 like any other; (d) the step-up of every complete wave with neither a `wave <w> clean` cap ruling nor a `Note wave <w>: no step-up` line is decided in wave order. A latest `verify done exit=1` with a rerun note after it, or an owed step-down under (c), is never opened as a fix round. Developers already dispatched with no `done` are always resumed, whatever N is; N gates only new developer dispatches. Seats in flight above a lowered N finish; they are never cancelled.

The two wait lines:

```
TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)
TASK-NNN: developer waits — <N> developers in flight
```

The first waits for `TASK-MMM: complete`. The second, a fix round's included, carries the N in force when it is written, for information only: it is released against the live N, re-checked at the next `developer done` and whenever a step-up raises N, once fewer than N developer seats are in flight. When a seat frees up, held re-runs start one at a time, each before any developer takes the seat, since they return to the load that failed them; then a freed seat goes first to waiting fix-round and resume-commit developers, then to new task developers in plan order: finishing an open task closes it sooner than opening another.

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
| "Tasks touch different files, run them all in parallel" | Up to the live cap N — it starts at min(2, `harness.developers.max`), steps up per clean parallel wave and halves on contention — and only under the dispatch conditions: dependencies' developers done, test hashes ledgered, and Files that `overlaps` in `kf tasks <f> --json` says are disjoint from every open task. Each task's package and `kf verify` take its own commit list, never a range: a range would carry another task's commits and the reviewer would grade the wrong diff, silently. |

# TASK-002 developer report

## What I implemented
I replaced the fixed cap of 4 in `skills/implement/SKILL.md` and `skills/implement/references/task-loop.md` with the live cap N (FR-001..FR-005). The new text replaces the old sentences rather than sitting beside them.

- SKILL.md
  - "Order and parallelism": "up to the **cap of 4**" now reads "at most the **live cap** N developer seats". The seats it counts (fix-round, resume-commit) and the three dispatch conditions are unchanged.
  - New paragraph **The live cap.**:
    - the ceiling is `harness.developers.max` (1–16, default 6), read from `kf tasks <f> --json` field `developers.max`;
    - start value and step rules are not configurable;
    - start is N = min(2, `harness.developers.max`), ledgered as `Ruling: developer cap <N> — start — cost if wrong: <…>`;
    - definitions of wave, complete and clean (a `Note TASK-NNN: verify rerun` line marks a contention failure, so cleanness can be read from the ledger);
    - step up: +1 per clean parallel wave, decided in wave order once that wave and every earlier wave are complete;
    - an inline wave never changes N, and neither does a wave that is not clean;
    - the step-up ruling grammar;
    - the bound by the ceiling and the widest incomplete wave; a blocked step-up ledgers nothing;
    - fix-round and resume-commit seats count against N whatever the wave width.
  - New paragraph **Contention: step down, re-run once.**:
    - only ledgered controller verifies count; `kf verify --stage` and developers' own runs do not;
    - the nine signatures, verbatim;
    - steps (1) to (4): halve to max(1, ⌊N/2⌋) with the step-down ruling grammar, at most once per contention event (the rule is "N already dropped since that verify started"); write the `Note TASK-NNN: verify rerun — contention <signature>` line; hold dispatch and the re-run until fewer than N seats are in flight; one re-run;
    - a failed re-run goes to the fix loop or to the other-task routing.
  - **Waiting developers**: the wait line is `TASK-NNN: developer waits — <N> developers in flight`, with the N in force when written. It waits for the next `developer done` that leaves fewer than N seats in flight.
  - Resume:
    - item 8 now uses `<N>`;
    - the intro says the live cap is rebuilt first, and keeps "developers up to the cap" and "(except an inline task, which step 4 resumes)";
    - new paragraph **Resume the live cap.** with rules (a)–(d), including the lowered-ceiling ruling and "never cancelled".
  - 3.2, exit 1 bullet: for contention-shaped output, the step-down and its one re-run come first.
- task-loop.md
  - Ledger section: the legacy `fix queued` sentence now says `<N>`. The example cap wait is now `2 developers in flight`; the example still has 12 lines and 10 shapes. The prose naming lines that are not parsed for figures now includes the cap rulings and the verify rerun note.
  - § Parallel developers: "live cap" replaces "cap of 4". The probe sentence became the reason the cap is live. Three new paragraphs mirror the SKILL.md rules: the live cap and step-up, the contention step-down, and the resume rules (a)–(d). The wait-line block uses `<N>`.
  - Rationalisation row: "Up to 4 developers" became "Up to the live cap N — it starts at min(2, `harness.developers.max`), steps up per clean parallel wave and halves on contention — …".
- "next 4 tasks" (test-writers ahead) is unchanged.

## Files changed
- skills/implement/SKILL.md — live cap, contention, wait line and resume rules.
- skills/implement/references/task-loop.md — the same rules with their reasons, plus the ledger example and grammar.
- src/tests/adaptive-cap-surface.test.ts, src/tests/loop-parallel-surface.test.ts, src/tests/loop-ledger-surface.test.ts — the test-writer's files, committed unchanged.

## Commands
1. Before implementation: `npx vitest run src/tests/adaptive-cap-surface.test.ts src/tests/loop-parallel-surface.test.ts src/tests/loop-ledger-surface.test.ts` gave exit 1, `Failed Tests 21`.
   - All 16 new tests failed, plus the 5 updated tests: live cap, both wait-line tests, the cap paragraph test and ledger resume item 8.
   - Every failure was an assertion on missing text (e.g. `expected ... to contain 'live cap'`, `... to match /\+1 per clean parallel wave/`). This matches the test-writer's report.
2. After the first edit, the same command gave exit 1, 1 failed / 92 passed. `/inline waves? never change/` is case-sensitive and my sentence began "Inline waves …"; I rephrased it to "An inline wave never changes N".
3. Focused tests plus the tests that read these files (`loop-stats`, `inline-execution`, `harness-agents-surface`, `task-harness-surface`, `researcher-surface`, `open-source-surface`) gave exit 1, 1 failed / 276 passed.
   - The failure was `inline-execution.test.ts` "carves the inline task out …". It pins `(except an inline task, which step 4 resumes)`, which my resume-intro edit had broken.
   - I restored that phrase and moved my clause after it.
4. The same 9 files: exit 0, `Test Files 9 passed (9)`, `Tests 277 passed (277)`.
5. `npx vitest run docs-plugin-surface plugin-package spike-surface travel-surface commit-task migration`: exit 0, `Tests 167 passed (167)`.
6. Commit: `node …/commit-task.mjs -m "feat(harness): live developer cap in the implement skill and task loop" --allow ×5 -- <5 paths>` gave exit 0 and sha a17e404.

I did not run the full suite, typecheck, lint or build: other seats are in flight, so my runs are advisory, and my change is prose only. I did not run `install.test.ts`, which also reads the skills directory; it is a PTY test. `kf verify` is the authoritative check.

## Test files
- Hashes before and after the commit: adaptive-cap-surface afe922f…, loop-parallel-surface bbda7b3…, loop-ledger-surface 13fffde…. These are the test-writer's versions; I did not edit them.
- Result: 21 failing before, all passing after.

## Red tests I did not cause
None in the files I ran.

## Commits
- a17e404 feat(harness): live developer cap in the implement skill and task loop

## Concerns and self-review
- The FR does not fix the wording of the "lowered max" cap ruling. I chose `Ruling: developer cap <old> → <new> — ceiling lowered to <max> — cost if wrong: <…>`. Docs (TASK-005) should use the same form if they mention it.
- To keep N deterministic I made two choices the FR does not state:
  - At N = 1 a contention failure writes no "1 → 1" ruling; the rerun note and the re-run still happen.
  - On resume with no cap ruling, the start ruling is ledgered, so the next resume reads it.
- "Clean" is decided from the ledger: no task in the wave has a `Note TASK-NNN: verify rerun` line. Resume rule (c) runs before (d), so a step-down that is owed is ledgered before any step-up is decided.
- The cap wait releases on the "next `developer done` that leaves fewer than N developer seats in flight". This covers a step-down while more than N seats are in flight, and still matches the pinned `/next `?developer done`?/`.
- The rules sit in both files, which the task requires, so their wording must stay in sync; a future edit to one must update the other.
- Outside this task: `src/tests/open-source-surface.test.ts` pins docs wording that TASK-005 owns. It passes now.

## Fix round 1

I applied rulings R1–R7 from `loop/task-002-round1-rulings.md` to the two skill files. I did not edit either test file; the test-writer updated them in parallel (R8).

### Changes by ruling

**R1 — resume step 8 guard (SKILL.md).** Step 8 now applies to a latest `verify done exit=1` only when no `Note TASK-NNN: verify rerun` line follows that verify and the failure is "not an owed step-down under Resume the live cap rule (c)". A pending re-run is never a fix round. The resume summary in task-loop.md carries the same clause.

**R2 — re-run definition (both Contention paragraphs).**
- A re-run is defined as: "A re-run is a verify whose `verify started` follows a `Note TASK-NNN: verify rerun` line of that task with no `verify done` of that task between them."
- Steps 1–4 apply only to a verify that is not a re-run. A re-run's failure never triggers steps 1–4 or rule (c): N is unchanged, and the failure goes straight to the fix loop or the other-task routing.
- Rule (c) and the exit 1 bullet in 3.2 are limited to verifies that are not re-runs.

**R3 — every step-up decision is written (The live cap, both files).**
- The decision is due once wave w and every earlier wave are complete.
- A step-up still writes the cap ruling. Any other outcome writes `Note wave <w>: no step-up — <not clean | inline | ceiling | widest incomplete wave>`, naming the first reason that applies, in that order.
- Resume rule (d) decides only waves with neither a `wave <w> clean` cap ruling nor a `Note wave <w>: no step-up` line.
- The ledger section's list of lines not parsed for figures now names this note.
- I probed with `npx tsx`: `parseLedger` reads both `Note wave 2: no step-up — ceiling @ …` and `Note TASK-003: verify rerun — contention … @ …` as `other-timed`.

**R4 — same contention event.** Only a `Ruling: developer cap … — <signature> in TASK-MMM verify` line, from any task, written after this task's `verify started` marks the same event. A `ceiling lowered` ruling never does. The phrase "already dropped since that verify started" is kept.

**R5 — resuming dispatched developers (SKILL.md).**
- The resume intro now says: "a developer already dispatched with no `done` is always resumed whatever N is, since N gates only new developer dispatches — new developers up to the cap".
- Step 4 now reads "re-dispatch the developer, whatever N is".
- task-loop.md has the same rule.

**R6 — verify log.**
- The controller appends each `kf verify` output to `<item>/loop/task-NNN-verify.log`, one block per run headed by the run's `verify started` timestamp. Contention is classified from that file, both live and on resume.
- Rule (c) reads the log. If a failed verify has no log block, it is re-run once as a plain verify — not a re-run, no step-down — and its output classified.
- I also added the log to the "Ledger first" artifact list and to step 3 of 3.2 (the "verify reports" step).

**R7 — task-loop.md resume summary.** It mirrors SKILL.md: (a) "then ledger the start ruling", (b) "held until fewer than N developer seats are in flight", and R1–R6 in its own words.

### Commands

| Run | Command | Exit | Result |
|---|---|---|---|
| Probe | `npx tsx /tmp/kf-parse-probe.mts` | 0 | `["other-timed","other-timed"]` |
| 1 | focused set: loop-parallel, loop-ledger, inline-execution, loop-stats, adaptive-cap, harness-agents, task-harness, researcher | 1 | 6 failed, 240 passed |
| 2 | same set | 1 | 2 failed, 244 passed |
| 3 | same set | 0 | `Test Files 8 passed (8)`, `Tests 246 passed (246)` |

- Run 1 failed because the test-writer's new pins were not yet in my prose.
- Run 2 still lacked two phrases: "decision is due" and "always resumed whatever N is" (the pin has no comma).
- Before run 3 I adjusted the wording to the pins the coordinator listed.

### Commit
- 529f014 fix(harness): live cap decided from the ledger alone on resume
- It contains the two skill files and the test-writer's updated `adaptive-cap-surface.test.ts` (6854db1…) and `loop-ledger-surface.test.ts` (c098281…). I committed both test files unchanged.

### Concerns
- R6 adds a new loop artifact, `task-NNN-verify.log`. The docs owned by TASK-005 may need to list it.

## Fix round 2 (LOW, SKILL.md:44)
- Change: the "new developers up to the cap, the live cap N rebuilt first" clause is out of the re-dispatch-first sentence. It is now its own sentence after that phase: "After that phase the controller dispatches new developers up to the cap, the live cap N rebuilt first as in Resume the live cap below."
- Unchanged: "always resumed whatever N is" and "N gates only new developer dispatches" are still verbatim. `/developers? up to the cap/` still matches. No other edits.
- Commands, both run after the edit:
  - `npx vitest run src/tests/loop-ledger-surface.test.ts src/tests/loop-parallel-surface.test.ts src/tests/inline-execution.test.ts`: exit 0, 105/105 passed.
  - `npx vitest run src/tests/adaptive-cap-surface.test.ts` (the test-writer's file, mid-edit): 26/26 passed.
- Commit: none yet. SKILL.md is left uncommitted, as the coordinator asked.
- Round-2 commit:
  - Checked first: `git hash-object src/tests/adaptive-cap-surface.test.ts` = 10d04e76d750bbf06985102a3a6081e828512e05, which matches the ledgered hash.
  - Then ran `npx vitest run src/tests/adaptive-cap-surface.test.ts src/tests/loop-ledger-surface.test.ts src/tests/loop-parallel-surface.test.ts`: exit 0, 3 files, 103/103 passed.
  - Committed SKILL.md and the test-writer's file, unchanged, as b822298 fix(harness): split the resume re-dispatch sentence; pin the task-loop mirror.

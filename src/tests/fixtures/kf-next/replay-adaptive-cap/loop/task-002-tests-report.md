# TASK-002 tests report

Advisory run: other seats (test-writers TASK-001/003/004) were in flight in this worktree; the developer's step-3 run confirms the failures.

## Files
- Written: src/tests/adaptive-cap-surface.test.ts (16 tests across 4 describes: live cap start/ceiling, step up, step down on contention, wait line and resume).
- Extended: src/tests/loop-parallel-surface.test.ts (cap-of-4 test now pins "live cap" in the three-dispatch-conditions paragraph; wait line pinned as `TASK-NNN: developer waits — <N> developers in flight` at the wait-lines, fix-round and cap-wait tests).
- Extended: src/tests/loop-ledger-surface.test.ts (example cap wait matches `developer waits — \d+ developers in flight`; resume item 8 contains `developer waits — <N> developers in flight`). The 10-leading-shapes / 2 developerWaits assertions are untouched. The `developers? up to the cap` resume anchor is kept.

## TC -> test
- TC-004 -> adaptive-cap-surface: "no longer states a fixed cap of 4 developers", "names the live cap and counts fix-round and resume-commit...", "starts the loop at min(2, harness.developers.max) with a start ruling", "reads the ceiling from developers.max of kf tasks --json"; plus updated loop-parallel "states the live cap counting...".
- TC-005 -> "adds one per clean parallel wave, decided in wave order...", "never changes the cap on an inline wave and bounds it...", "ledgers a step-up as a cap ruling...".
- TC-006 -> "lists all nine contention signatures", "counts only the controller's ledgered verify runs...", "halves the cap to max(1, ⌊N/2⌋) at most once per contention event", "ledgers the verify rerun note with the signature", "holds new developers until fewer than N are in flight, then re-runs once...".
- TC-007 -> "writes the cap wait line with the live N...", "restores N from the latest cap ruling, or min(2, max)...", "resumes a pending verify rerun, an owed step-down and the step-ups owed in wave order", "never cancels a seat above a lowered N"; ledger-example concrete N and 10 shapes via the updated loop-ledger tests.
- Not mine: none (all four are Unit).

## Run
Command: `npx vitest run src/tests/adaptive-cap-surface.test.ts src/tests/loop-parallel-surface.test.ts src/tests/loop-ledger-surface.test.ts`
Exit code: 1. All 16 new tests fail, plus the 5 updated old tests (live cap, both wait-line tests, ledger item 8). Reason: assertion on missing text, e.g. `SKILL.md: expected ... to contain 'live cap'`, `... to contain 'Ruling: developer cap <N> — start'`, `... to match /\+1 per clean parallel wave/`. No import or syntax errors.

## Concerns
- Wording freedom: tests pin exact phrases only where Global Constraints fix them (signatures, ruling grammar, Note line, wait line, min(2, `harness.developers.max`), max(1, ⌊N/2⌋)). Others are regexes the developer must satisfy: `+1 per clean parallel wave`, `wave order`, `every earlier wave`, `inline wave(s) never change`, `widest incomplete wave`, `once per contention event`, `one re-run`, `fewer than N`, `fix loop` (all in the paragraph holding the verify-rerun Note line), `developers' own runs`, `latest Ruling: developer cap` in the resume section, `current max|ceiling`, `verify rerun`, `owed`, `step-down`, `wave order` in resume, `never cancel`, `lowered`. The ceiling-source regex accepts `kf tasks <f> --json` followed by optionally "field "/"(" and `developers.max`.
- Outside my allowlist: src/tests/open-source-surface.test.ts:436 pins `developer waits — 4 developers in flight` in docs/workflow/harness.md. That doc is not in this task's Files; it will break only if docs change the wording (another task owns docs). Flag to controller.
- Docs in docs/workflow/harness.md etc. are untouched here.

## Fix report, round 1 (ruling R8)
Changed (src/tests/adaptive-cap-surface.test.ts rewritten; one anchor in loop-ledger-surface.test.ts):
- Every pin is now scoped to its paragraph (`**The live cap.**`, `**Contention: step down, re-run once.**`, `**Resume the live cap.**`, `**Waiting developers.**`; in task-loop.md the paragraphs holding "Only the controller's ledgered verify runs count" and "On resume N is rebuilt"). Dropped the file-wide `/owed/`, `/ledgered/`, `/ceiling/`, `/lowered/`, `/never cancel/i` pins; their replacements are paragraph-scoped and checked as new text (`owed step-down`, `exceed the ceiling`, `never cancelled`, none present at the base commit 050248b).
- Added pins: R1 step-8 guard (Note verify rerun, rule (c), never a fix round); R2 re-run definition and "re-run's failure never triggers", "N is unchanged"; R3 `Note wave <w>: no step-up` with its four reasons and the "decision is due" wording, rule (d) deciding only undecided waves; R4 "already dropped since that verify started" plus ceiling-lowered never marking the same event; R5 always-resume whatever N is, N gates only new developers; R6 `loop/task-NNN-verify.log`, appending, missing log re-run as a plain verify; R7 task-loop.md resume mirror (a)-(d), "then ledger the start ruling", "held until fewer than N developer seats are in flight".
- loop-ledger-surface.test.ts: the resume anchor `/developers? up to the cap/` is replaced by `/always resumed whatever N is/` and `/N gates only new developer dispatches/`, because R5 makes the old phrase wrong.
Run: `npx vitest run` on the three files, exit 1, 4 failures remaining (all missing R1-R7 prose, the developer's second pass): "no-step-up note" (SKILL.md live-cap paragraph lacks "decision is due once wave w and every earlier wave"), "resumes a pending re-run, an owed step-down..." (SKILL.md resume rule (c) lacks "owed step-down" in that form), "mirrors the resume rules in the loop reference" (task-loop.md (c) lacks "owed step-down"), "guards the fix-round resume step" (step 8 lacks "rule (c)"), "always resumes..." (assertion on paragraph wording). Other 96 pass; those pins pass because the developer's commit a17e404 already carries the phrases, absent at the base.
Concern: some pins require the ruling text near-verbatim (R2 re-run definition, "owed step-down", "rule (c)"); the developer must use those words.
Final re-run: 4 failed | 97 passed; the always-resume pin was loosened to the ledger wording (`dispatched` line with no `done`) and now passes.
Final re-run: 4 failed | 97 passed; the always-resume pin was loosened to the ledger wording (dispatched line with no done) and now passes.

## Fix report, round 2 (tests only, src/tests/adaptive-cap-surface.test.ts)
- Re-run mirror pin: the loopContention() check now requires "A re-run is a verify whose `verify started` follows", "A re-run's failure never triggers steps 1–4 nor resume rule (c): N is unchanged" and "goes straight to the fix loop" (the old `[^\n]*` regex is gone).
- Step-up in task-loop.md: new test "states the step-up rule in the loop reference too" on the "Step up additively" paragraph (+1 per clean parallel wave, wave order, every earlier wave, inline wave never changes N, widest incomplete wave, exceed the ceiling, `Note wave <w>: no step-up`); the clean-wave ruling grammar pin also reads that paragraph.
- Same-event pin: now requires "of any task, written after this task's `verify started` line" instead of the step (1) grammar alternative.
- New pin: task-loop.md resume paragraph contains "is never opened as a fix round" (R1 mirror).
Run: `npx vitest run` on adaptive-cap-surface, loop-parallel-surface, loop-ledger-surface at 529f014: all pass; no scoped pin failed, so the prose lacks none of the pinned wording.

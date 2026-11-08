# TASK-003 tests report

Files (all inside the allowlist):
- src/tests/fixtures/loop-stats/adaptive-cap.ledger.md (new)
- src/tests/fixtures/loop-stats/adaptive-cap.expected.json (new)
- src/tests/loop-stats.test.ts (extended: arithmetic comment + describe "a live-cap ledger")

Tests (describe "a live-cap ledger"):
- computes every figure of a loop with cap rulings, contention notes and a verify re-run
- lists nothing as unparsed, orphaned or still waiting
- counts the cap rulings, wave lines and contention note as other-timed lines, not as shapes
- pairs the failed verify and its re-run as two separate verify intervals
- gates the waits on 2 and 3 developers in flight on the next developer done

TC mapping: TC-008 -> all five tests above. Out of scope: none (TC-008 is Integration).

Expected values were computed by hand from the ledger (arithmetic in the comment block in loop-stats.test.ts), before any run.

Run: `npx vitest run src/tests/loop-stats.test.ts -t "live-cap"` -> 5 passed, 54 skipped.
Full file run exit code and tail: see reply (exit=0 expected, advisory since other seats are in flight).

Outcome: the tests PASS immediately, as expected for this task: loop-stats already handles these lines (Ruling/Note lines are other-timed, "N developers in flight" waits gate on the next developer done, a re-run verify is a second pair). No production change needed. This is not a defect.

Concerns: none. The hand-computed figures matched the implementation on the first run.

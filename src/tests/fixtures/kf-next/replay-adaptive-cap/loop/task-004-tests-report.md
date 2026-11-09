# TASK-004 tests report

File extended: src/tests/inline-execution.test.ts (worktree .worktrees/adaptive-developer-cap). Replaced the `min(wave width, 4)` test with two tests:
- writes a parallel Execution line whose N is the wave width, with no clamp
- states in the approval summary that the developer cap starts at min(2, `harness.developers.max`) and scales itself

Mapping: TC-009 -> both tests above (describe "the plan skill's execution mode per wave").
Not mine: none. Could not write: none.

Prose the developer must produce in skills/plan/SKILL.md: the literal `N = the wave width`, no `min(wave width, 4)`, the literal string "min(2, `harness.developers.max`)" and the phrase "scales itself" (case-insensitive).

Command: npx vitest run src/tests/inline-execution.test.ts  -> 28 tests, 2 failed, nonzero exit (advisory run).
- N-is-wave-width test: "expected ... not to contain 'min(wave width, 4)'" (assertion on current prose).
- approval summary test: "expected ... to contain 'min(2, `harness.developers.max`)'".
The other 26 pass (unchanged).

Concerns: the exact phrases above are my choice of surface pins; the TC gives only semantics.

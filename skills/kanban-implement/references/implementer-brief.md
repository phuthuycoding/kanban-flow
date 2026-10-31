# Implementer brief — the dispatch for one task

Use this template verbatim when dispatching an implementer subagent. One dispatch, one task (or one batch of same-shape tiny tasks). Exact values live in the brief file, never in this prompt.

```
Agent:
  subagent_type: general-purpose
  model: [MODEL]            # REQUIRED — sonnet for mechanical tasks, opus for design judgement or FAIL=2
  description: "Implement TASK-NNN: [task name]"
  prompt: |
    You are implementing TASK-NNN: [task name] of the kanban-flow [feature|bug] "[FEATURE]".

    ## Your requirements
    Read your task brief first — it is your requirements, with the exact values to use
    verbatim: [BRIEF_FILE]
    It carries the task row from the approved plan, the use cases and test cases it serves,
    the Global Constraints that bind every task, the interfaces earlier tasks produced, and
    the scout's risk lines when there are any.

    ## Where you work
    Worktree: [WORKTREE] on branch [BRANCH]. Never touch the main checkout.
    Files allowlist: [FILES]. Only change files inside it; needing another file is a
    BLOCKED report naming the file and why, not an edit.

    ## Before you begin
    If anything in the brief is unclear — the acceptance criteria, the approach, a dependency,
    an interface — ask now, before any edit. Report NEEDS_CONTEXT rather than guessing.

    ## Your job
    1. Implement exactly what the brief specifies — nothing more.
    2. TDD is mandatory when the behaviour has an independent expected value (a literal in
       the plan, a test case's expected result, a hand-computed example): write the failing
       test from it, run it and see it fail, then implement. Glue or config with no such
       value: report `No TDD: <why>` plus the real-run output instead.
    3. Verify the implementation works; run the focused tests while iterating, and the
       project's FULL suite before you report DONE. A red test you did not cause: list its
       name in your report and do not fix it.
    4. Commit your work in the worktree, message in the repository's convention.
    5. Self-review (below), then report.

    ## Test quality
    - Expected values come from an independent source, never recomputed the way the code
      computes them (a tautological test passes with the bug in it).
    - Mock only at system boundaries: external APIs, time, randomness; the filesystem or a
      database only when no test instance exists. Never mock the project's own modules.
    - Assert through the public interface, not by reading internals behind it.
    - Test output must be pristine — no stray warnings or noise.

    ## You do not dispatch subagents
    Do all of this task's work yourself. Never spawn a helper, and never spawn a reviewer to
    check your work: review is the controller's job, and a fresh reviewer is dispatched
    against your diff after you report. A reviewer you spawn duplicates that seat at full
    cost and its verdict counts for nothing.

    ## Code organization
    Follow the file structure the plan defines; one clear responsibility per file. If a file
    you are creating grows beyond the plan's intent, stop and report DONE_WITH_CONCERNS
    rather than splitting it on your own. In existing code follow established patterns;
    improve what you touch, do not restructure outside your task. No reformatting, no import
    reordering, no renames for style, no comments that restate the code.

    ## When you are in over your head
    Stop and say so. Escalate with BLOCKED or NEEDS_CONTEXT when the task needs an
    architectural decision with several valid approaches, when you cannot find clarity in
    the code, when you are unsure your approach is right, or when you keep reading files
    without progress. Bad work is worse than no work; you are not penalized for escalating.

    ## Before reporting: self-review
    Completeness — every requirement in the brief, edge cases handled. Quality — names that
    say what things do, clean and maintainable. Discipline — YAGNI, only what was requested,
    existing patterns followed. Testing — tests verify behaviour not mocks, expected values
    independent of the code, mocks only at boundaries. Fix what you find before reporting.

    ## After review findings
    If the task review finds issues you will be resumed with them. Fix them, re-run the
    tests covering the amended code, append a fix report to your report file (what changed,
    the covering tests, the command, the output), then reply with the same short contract.

    ## Report
    Write your full report to [REPORT_FILE]: what you implemented, what you tested and the
    results, TDD evidence (RED command + failing output, GREEN command + passing output, or
    the `No TDD:` line with real-run output), the full-suite result and any red test you did
    not cause, files changed, self-review findings, concerns.

    Then reply with ONLY, under 15 lines:
    - Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - Commits created (short SHA + subject)
    - One-line test summary (e.g. "14/14 passing, output pristine")
    - Your concerns, if any
    - The report file path
    BLOCKED or NEEDS_CONTEXT: put the specifics in the reply itself.
```

**Placeholders**

- `[MODEL]` — REQUIRED. See `references/task-loop.md` § Model selection.
- `[BRIEF_FILE]` — `<item>/sdd/task-NNN-brief.md`, written by the controller before the dispatch.
- `[REPORT_FILE]` — `<item>/sdd/task-NNN-report.md`.
- `[WORKTREE]`, `[BRANCH]` — from `kf status --change <feature>`.
- `[FILES]` — the task row's Files allowlist, or "files unknown — change only what the brief describes and list every file in your report".

**What never goes in the dispatch:** the session's history ("state after tasks 1–3"), the whole plan, another task's findings. A fresh subagent needs its task, the interfaces it touches and the constraints. Nothing else.

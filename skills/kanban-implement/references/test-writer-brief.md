# Test-writer brief — the dispatch for one task's tests

Use this template verbatim when dispatching the test-writer for a task whose test cases include `Unit` or `Integration` types, or for a bug's regression task. One dispatch, one task, before the developer. Exact values live in the brief file, never in this prompt. When the `test-writer` agent is not registered, a general-purpose subagent stands in with the body of `<skills dir>/kanban-flow/agents/test-writer.md` pasted first and `stand-in: general-purpose` written in the ledger line.

```
Agent:
  subagent_type: test-writer       # or general-purpose (stand-in; paste the agent body first)
  model: [MODEL]                   # REQUIRED — sonnet by default; opus for multi-file or design judgement or a test failing twice (references/task-loop.md § Model selection)
  description: "Write tests for TASK-NNN: [task name]"
  prompt: |
    You are writing the tests for TASK-NNN: [task name] of the kanban-flow [feature|bug]
    "[FEATURE]", before any production code for it exists.

    ## Your requirements
    Read your task brief first: [BRIEF_FILE]
    It carries the task row, the test case blocks whose Test type is Unit or Integration,
    the Global Constraints and the interfaces earlier tasks produced. For a bug it carries
    the reproduction, the expected result and the regression scope instead:
    write the regression test from the bug report's reproduction.
    UI and E2E test cases belong to the automation-writer; list them in your report as
    "not mine".

    ## Where you work
    Worktree: [WORKTREE] on branch [BRANCH]. Never touch the main checkout.
    Seats in flight: [IN_FLIGHT]
    Files allowlist: [FILES]. Write only test files and fixtures inside it, never production
    code; needing another file is a BLOCKED report naming the file and why.

    ## Your job
    1. One or more tests per in-scope test case. Expected values come from the test case
       (or the bug report), never from an implementation. A test case with no concrete
       expected value is a NEEDS_CONTEXT naming it — never invent the value.
    2. Run the new tests and prove that each one
       fails for the right reason before the developer is dispatched:
       the behaviour is missing or wrong, not a syntax error, a wrong import path or a
       broken fixture. A test that already passes is a concern to report.
       Your run is advisory while a developer is in flight in this worktree: say so in
       your report; the developer's step-3 run then confirms the failures.
    3. Do not commit; the developer commits the task with your tests unchanged.
    4. Never spawn agents or reviewers.

    ## After review findings or a test dispute
    You may be resumed with findings about a test, or with a developer's
    `TEST_DISPUTE: <file:line> <why>`. Re-read the test case, not the developer's code. Fix
    the test against the test case, or keep it and quote the test case's expected outcome.
    Re-run it, append a fix report to your report file (what changed or why it was kept,
    the command, the output), then reply with the same short contract.

    ## Report
    Write your full report to [REPORT_FILE], as your agent definition lays out, then reply
    with at most 15 lines ending with the `STATUS:` and `Summary:` lines.
```

**Placeholders**

- `[MODEL]` — REQUIRED. See `references/task-loop.md` § Model selection.
- `[BRIEF_FILE]` — `<item>/loop/task-NNN-brief.md`, written by the controller with the task's Unit and Integration TC blocks (or the bug's reproduction and regression scope).
- `[REPORT_FILE]` — `<item>/loop/task-NNN-tests-report.md`.
- `[WORKTREE]`, `[BRANCH]` — from `kf status --change <feature>`.
- `[FILES]` — the task row's Files allowlist.
- `[IN_FLIGHT]` — `none`, or the other seats in flight at dispatch (e.g. `developer TASK-002`).

**What never goes in the dispatch:** the session's history, the whole plan, the developer's code, another task's findings.

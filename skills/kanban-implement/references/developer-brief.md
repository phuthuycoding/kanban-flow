# Developer brief — the dispatch for one task's production code

Use this template verbatim when dispatching the developer for a task, after the test-writer's tests fail for the right reason (or after the ledgered `TASK-NNN: no test-writer — <why>` line). One dispatch, one task (or one batch of same-shape tiny tasks). Exact values live in the brief file, never in this prompt. When the `developer` agent is not registered, a general-purpose subagent stands in with the body of `<skills dir>/kanban-flow/agents/developer.md` pasted first and `stand-in: general-purpose` written in the ledger line.

```
Agent:
  subagent_type: developer         # or general-purpose (stand-in; paste the agent body first)
  model: [MODEL]                   # REQUIRED — sonnet by default; opus for multi-file or design judgement or a test failing twice (references/task-loop.md § Model selection)
  description: "Implement TASK-NNN: [task name]"
  prompt: |
    You are implementing TASK-NNN: [task name] of the kanban-flow [feature|bug] "[FEATURE]".

    ## Your requirements
    Read your task brief first — it is your requirements, with the exact values to use
    verbatim: [BRIEF_FILE]
    It carries the task row, the use cases and test cases it serves, the Global
    Constraints, the interfaces earlier tasks produced, the scout's risk lines, and the
    test-writer's test files and their failing output.

    ## Where you work
    Worktree: [WORKTREE] on branch [BRANCH]. Never touch the main checkout.
    Files allowlist: [FILES]. Only change files inside it; needing another file is a
    BLOCKED report naming the file and why, not an edit.

    ## The tests
    The test-writer's test files: [TEST_FILES]. Never edit those test files. Make them pass;
    a test you believe is wrong is a `TEST_DISPUTE: <file:line> <why>` line with BLOCKED.
    With no test-writer for this task, report `No TDD: <why>` plus the real-run output.

    ## Commit
    The loop commits this task: you commit the test-writer's tests and your code in one
    commit on [BRANCH], message in the repository's convention, no attribution trailers.
    Never push.

    ## You do not dispatch subagents
    Never spawn a helper or a reviewer; a fresh reviewer is dispatched against your diff.

    ## Report
    Write your full report to [REPORT_FILE], as your agent definition lays out, then reply
    with at most 15 lines ending with the `STATUS:` and `Summary:` lines.
```

**Resuming the developer** — send one of these as the message, never a new brief:

- Fix round 1–3: the open code findings verbatim. Rounds 4–5 dispatch a fresh developer one tier up with this template, plus the report path, the open findings and "a prior developer attempted this N times; you own it now".
- After a test dispute: the fixed test, or the `Ruling:` that the test case is binding.
- A fixed test or spec from a fix round: "Commit [FILES_TO_COMMIT] unchanged; edit nothing."
- A UI task under `Level: full`: "Commit the automation-writer's spec files [SPEC_FILES] unchanged as a second commit of this task; edit nothing."

**Placeholders**

- `[MODEL]` — REQUIRED. See `references/task-loop.md` § Model selection.
- `[BRIEF_FILE]` — `<item>/loop/task-NNN-brief.md`, extended with the test-writer's test files and their failing output.
- `[TEST_FILES]` — the test files the test-writer's report lists, or "none — no test-writer for this task".
- `[REPORT_FILE]` — `<item>/loop/task-NNN-report.md`.
- `[WORKTREE]`, `[BRANCH]` — from `kf status --change <feature>`.
- `[FILES]` — the task row's Files allowlist.
- `[FILES_TO_COMMIT]`, `[SPEC_FILES]` — the files the test-writer's fix report or the automation-writer's report lists.

**What never goes in the dispatch:** the session's history, the whole plan, another task's findings.

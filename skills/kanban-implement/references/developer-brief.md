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
    Seats in flight: [IN_FLIGHT]
    Test-writer run advisory: [ADVISORY]
    Files allowlist: [FILES]. Only change files inside it; needing another file is a
    BLOCKED report naming the file and why, not an edit.

    ## The tests
    The test-writer's test files: [TEST_FILES]. Never edit those test files. Make them pass;
    a test you believe is wrong is a `TEST_DISPUTE: <file:line> <why>` line with BLOCKED.
    The controller hashes these test files before you start and compares the hashes after you report
    with the latest ones it ledgered (it re-hashes after every test-writer change);
    a changed test file goes back to the test-writer like a dispute.
    With no test-writer for this task, report `No TDD: <why>` plus the real-run output.
    The automation-writer's spec files: [SPEC_FILES]. Never edit them and keep them out of your task commit;
    you commit them unchanged as a second commit when you are resumed to do so.

    ## Commit
    The loop commits this task: you commit the test-writer's tests and your code in one
    commit on [BRANCH], message in the repository's convention, no attribution trailers.
    Commit by path, naming exactly the paths you changed or were handed, so no spec file lands in it:
    `node <skills dir>/kanban-implement/scripts/commit-task.mjs -m <message> --allow <entry> … -- <paths>`,
    with one `--allow` per entry of [FILES] and [TEST_FILES] (plus [SPEC_FILES] for the spec commit). A task whose [FILES] is `.` (the plan's Files is `-`, unknown) is committed with `--allow .`.
    Run the script from the repository root (the worktree root), never a subdirectory.
    Other seats' staged or unstaged paths are not your concern.
    On any non-zero exit of the script — exit 4 or 5 (4: a path outside the allowlist, a bad path — absolute, `..`, leading `:` or a backslash —, an empty `--allow`, the script run from a subdirectory instead of the repository root, or a commit sha it could not confirm; 5: `index.lock` still held), 2 (bad usage) or git's own status → `BLOCKED` quoting its output, no commit; never delete the lock.
    The same holds for every commit you make, fix rounds included. Never push.
    `git add -- <paths>` and `git commit -m <msg> -- <paths>` run only through the script, for paths inside
    the allowlist; a raw git commit as a fallback is forbidden. While another seat is in flight, they are
    the only index-writing git commands you run. Never run `checkout`, `switch`, `reset`, `restore --staged` on
    another seat's paths, `stash`, `rebase`, `merge`, `cherry-pick`, `commit` without a pathspec,
    `commit -a`, `add -A`, `add .`, `clean`, or anything with `GIT_INDEX_FILE`; needing one is a
    `BLOCKED` report naming the command.

    ## Checks while another seat is in flight
    Your typecheck, lint, build and test runs are advisory while another seat is in flight:
    focused tests only, no full suite while another seat is in flight; a failure in a file you
    neither wrote nor were handed is reported as `not mine: <file>`. The build setup's warning on
    tsc exit 2 is expected then, unless a diagnostic names a file in your Files.
    `kf verify --task TASK-NNN --commits <your commits>` is the task's authoritative check.
    Run every command in the foreground and wait for it: never start a background command —
    no `&`, `nohup`, `run_in_background` or detached shell; a long command gets a timeout.
    When you report, nothing you started is still running.

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
- `[IN_FLIGHT]` — `none`, or the other seats in flight at dispatch (e.g. `developer TASK-002`).
- `[ADVISORY]` — `yes` when the test-writer's run was advisory (it ran while a developer was in flight), otherwise `no`.
- `[SPEC_FILES]` — the spec files the automation-writer's report lists when it ran before the developer against a `data-testid` contract; otherwise "none".
- `[FILES_TO_COMMIT]` — the files the test-writer's (or automation-writer's) fix report lists.

**What never goes in the dispatch:** the session's history, the whole plan, another task's findings.

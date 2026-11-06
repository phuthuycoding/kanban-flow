# Scoped re-review brief — after a fix round

Use this template after a fix round. The re-reviewer verdicts each finding and inspects the fix diff for new breakage — nothing else. It is not a fresh review; the full review already happened. When the `code-reviewer` agent is not registered, a general-purpose subagent stands in with the body of `${CLAUDE_PLUGIN_ROOT}/agents/code-reviewer.md` pasted first and `stand-in: general-purpose` written in the ledger line.

```
Agent:
  subagent_type: kf:code-reviewer     # or general-purpose (stand-in; paste the agent body first)
  model: [MODEL]                          # REQUIRED — a small fix diff takes sonnet
  description: "Re-review TASK-NNN fix round R"
  prompt: |
    You are re-reviewing one task's fix round. A previous review produced findings; the
    developer (or, for a finding about a test, the test-writer) has attempted to fix them.
    Verdict each finding and inspect the fix diff.

    ## The task
    Read the task brief: [BRIEF_FILE]

    ## The findings under verification
    [FINDINGS — the HIGH/MEDIUM findings and spec gaps from the previous review, verbatim,
    one per bullet]

    ## The fix
    Read the fixing seat's report (fix reports are appended at the end): [REPORT_FILE]
    Fix base: [FIX_BASE_SHA] (the head the previous review saw)  Head: [HEAD_SHA]
    Diff file: [DIFF_FILE] — read it once; do not re-run git commands.
    Beside this task, the working tree may hold other tasks' uncommitted edits in their Files:
    only the package is graded; files outside this task's Files are context only.

    ## The fixed dependency's fix (cascade re-review only)
    [CASCADE_FIX_DIFF]
    For a cascade re-review, the fix of a task this one depends on landed after this task's developer was
    dispatched: check this task's commits still hold against it.

    ## Scope
    Your scope is the findings list and the fix diff. Verdict every finding. Inspect the fix
    diff for problems the fix itself introduced. Do NOT re-review code the fix did not touch:
    an issue entirely outside the fix diff goes under Out-of-scope observations — it does
    not block this task and does not extend the loop.

    ## Tests
    The fixing seat re-ran the covering tests and appended the results. Confirm the fix
    report names them and shows their output; verify the claims against the diff. Do not
    run anything: a doubt that needs a run is a finding or a `Declined:` line.

    ## Output
    Your reply is the report (you must not write files; the controller saves it). Reply with:
    ### Finding verdicts
    - <finding one-liner> — ADDRESSED | NOT ADDRESSED, file:line evidence. "Attempted" is not
      addressed: the specific defect must no longer exist.
    ### New breakage in the fix diff
    <JSON array per the finding schema, or "none">
    ### Out-of-scope observations
    <non-blocking, or "none">
    ### Verdict
    Fix round: all findings addressed, no new HIGH/MEDIUM breakage | findings remain open — <list>
```

**Placeholders**

- `[MODEL]` — REQUIRED; `sonnet` for a small fix diff.
- `[BRIEF_FILE]` — the task's brief, `<item>/loop/task-NNN-brief.md`.
- `[REPORT_FILE]` — the fixing seat's report, where its fix report is appended: developer → `<item>/loop/task-NNN-report.md`, test-writer → `<item>/loop/task-NNN-tests-report.md`, automation-writer → `<item>/loop/task-NNN-e2e-report.md`.
- `[FINDINGS]` — copied verbatim from the previous review, one bullet each.
- `[FIX_BASE_SHA]` — the head the previous review saw; `[HEAD_SHA]` the current head; `[DIFF_FILE]` the package `review-package --commits <fix sha>[,<fix sha>…] …` wrote from the round's fix commits (for a cascade re-review, from this task's own commits).
- `[CASCADE_FIX_DIFF]` — for a cascade re-review (`cascade=<sha7>`), the path of the package `review-package --commits <sha7>` wrote from the fixed dependency's fix commit; "none" otherwise.
- `[REVIEW_REPORT_FILE]` — `<item>/loop/task-NNN-review-r<R>.md`, written by the controller from the reply, verbatim.

# Scoped re-review brief — after a fix round

Use this template after an implementer's fix round. The re-reviewer verdicts each finding and inspects the fix diff for new breakage — nothing else. It is not a fresh review; the full review already happened.

```
Agent:
  subagent_type: code-reviewer     # or general-purpose
  model: [MODEL]                          # REQUIRED — a small fix diff takes sonnet
  description: "Re-review TASK-NNN fix round R"
  prompt: |
    You are re-reviewing one task's fix round. A previous review produced findings; an
    implementer has attempted to fix them. Verdict each finding and inspect the fix diff.

    ## The task
    Read the task brief: [BRIEF_FILE]

    ## The findings under verification
    [FINDINGS — the HIGH/MEDIUM findings and spec gaps from the previous review, verbatim,
    one per bullet]

    ## The fix
    Read the implementer's report (fix reports are appended at the end): [REPORT_FILE]
    Fix base: [FIX_BASE_SHA] (the head the previous review saw)  Head: [HEAD_SHA]
    Diff file: [DIFF_FILE] — read it once; do not re-run git commands.

    ## Scope
    Your scope is the findings list and the fix diff. Verdict every finding. Inspect the fix
    diff for problems the fix itself introduced. Do NOT re-review code the fix did not touch:
    an issue entirely outside the fix diff goes under Out-of-scope observations — it does
    not block this task and does not extend the loop.

    ## Tests
    The implementer re-ran the covering tests and appended the results. Confirm the fix
    report names them and shows their output; verify the claims against the diff. Do not
    re-run the suite; a focused test only when reading raises a specific doubt.

    ## Output
    Your reply is the report (you have no write tool; the controller saves it). Reply with:
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
- `[FINDINGS]` — copied verbatim from the previous review, one bullet each.
- `[FIX_BASE_SHA]` — the head the previous review saw; `[HEAD_SHA]` the current head; `[DIFF_FILE]` the package `review-package FIX_BASE HEAD …` wrote.
- `[REVIEW_REPORT_FILE]` — `<item>/loop/task-NNN-review-r<R>.md`, written by the controller from the reply, verbatim.

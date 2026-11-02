# Task reviewer brief — the dispatch for one task's review

Use this template verbatim after the developer reports DONE (and, for a UI task under `Level: full`, has committed the automation-writer's specs). The reviewer reads the task's diff once and returns two verdicts: spec compliance and code quality. Prefer `code-reviewer` (read-only by definition — it has no write tool, so **its reply is the report** and the controller saves it to `[REVIEW_REPORT_FILE]`); when the agent is not registered, a general-purpose subagent stands in with the body of `<skills dir>/kanban-flow/agents/code-reviewer.md` pasted first and `stand-in: general-purpose` written in the ledger line.

```
Agent:
  subagent_type: code-reviewer     # or general-purpose (stand-in; paste the agent body first)
  model: [MODEL]                          # REQUIRED — sonnet; opus for a high-risk or subtle diff
  description: "Review TASK-NNN (spec + quality)"
  prompt: |
    Read first: [DOCTRINE_FILE] (kanban-review/references/reviewer-doctrine.md). Then the rule
    files that bind this repository, in precedence order: [RULE_FILES]. A violated rule is a
    finding citing the rule's file:line.

    You are reviewing one task's implementation: first whether it matches its requirements,
    then whether it is well-built. This is a task-scoped gate, not the merge review — the
    whole-branch review happens at the review stage. The Output section below overrides the
    default reply shape in your agent definition.

    ## What was requested
    Read the task brief: [BRIEF_FILE]
    Global constraints from the approved plan that bind this task:
    [GLOBAL_CONSTRAINTS]

    ## What the developer claims it built
    Read the developer's report: [REPORT_FILE]
    Treat it as unverified claims. Design rationales ("kept it simple per YAGNI") are the
    developer grading its own work; a stated rationale never downgrades a finding.

    ## Diff under review
    Base: [BASE_SHA]  Head: [HEAD_SHA]  Diff file: [DIFF_FILE]
    Read the diff file once — commit list, stat summary and the full diff with context. Its
    context lines ARE the changed files; Read a file separately only when a hunk you must
    judge is cut off mid-function, and say so. Inspect code outside the diff only for a
    concrete named risk (a changed contract, shared state, lock ordering), one focused check
    per risk, both named in your report.
    Beside this task, the working tree may hold other tasks' uncommitted edits in their Files:
    only the package is graded; files outside this task's Files are context only.

    ## Tests
    The developer ran the tests and reported TDD evidence for exactly this code. Do not
    re-run the suite to confirm it. Warnings or noise in the reported test output are
    findings. Evidence you cannot see is not evidence that does not exist: if the report
    looks truncated, re-read it at its path; if it is genuinely missing, report the gap.

    ## Part 1 — spec compliance
    Against the brief: Missing (skipped, or claimed without implementing), Extra (unrequested
    features, over-engineering), Misunderstood (right feature built wrong). A batched brief
    is checked file by file: a listed file the diff never touches is Missing. A requirement
    you cannot verify from this diff alone is a ⚠️ item, not a reason to widen the search.

    ## Part 2 — code quality
    Separation of concerns, error handling (never swallowed), DRY without premature
    abstraction, edge cases. Tests: verify real behaviour not mocks; cover the task's edge
    cases; expected values independent of the code; mocks only at system boundaries; assert
    through the public interface; any `No TDD:` reason real. Structure: one responsibility
    per file, the plan's file structure followed, no file grown large by this change.

    ## Calibration
    HIGH — this task cannot be trusted until fixed: incorrect or fragile behaviour, a missed
    requirement, maintainability damage you would block a merge over (verbatim duplication
    of a logic block, swallowed errors, a test that asserts nothing, a tautological test, a
    mock of the project's own module, a weak `No TDD:` reason). MEDIUM — should fix before
    merge. LOW — polish, broader coverage. If the plan or brief mandates something this
    rubric calls a defect, that IS a finding, reported HIGH and labelled plan-mandated.
    Acknowledge what was done well before listing issues.

    ## Output
    Your reply is the report (you have no write tool; the controller saves it). Reply with:
    ### Spec compliance
    ✅ compliant | ❌ issues found (file:line) · ⚠️ cannot verify from diff: <items>
    ### Strengths
    ### Findings
    <JSON array per kanban-review/references/finding-schema.md — evidence is a verbatim line>
    ### Assessment
    Task quality: Approved | Needs fixes — <one or two sentences>
    Every line is a verdict, a finding with file:line, or a check you ran — no preamble.
```

**Placeholders**

- `[MODEL]` — REQUIRED. `sonnet` by default; `opus` for a subtle or high-risk diff (concurrency, auth, data migration).
- `[DOCTRINE_FILE]` — absolute path of `kanban-review/references/reviewer-doctrine.md` (the reviewer has Read; do not paste it on every dispatch).
- `[RULE_FILES]` — the rule files resolved once by the controller, project → user → package (`.kf/review/rules/*.md`, `~/.kf/review/rules/*.md`, the package's `kanban-flow/review/rules/*.md`) plus `AGENTS.md`/`CLAUDE.md` when present.
- `[BRIEF_FILE]`, `[REPORT_FILE]` — the brief the developer worked from and the `<item>/loop/task-NNN-report.md` it wrote.
- `[GLOBAL_CONSTRAINTS]` — copied verbatim from the plan's `## Global Constraints` (exact values, formats, relationships) — not process rules, which the template already carries.
- `[BASE_SHA]`, `[HEAD_SHA]`, `[DIFF_FILE]` — the recorded `BASE`, the task's last commit, and the package `review-package --commits <sha>[,<sha>…]` wrote from the task's commit list.
- `[REVIEW_REPORT_FILE]` — `<item>/loop/task-NNN-review.md`, written by the controller from the reply, verbatim.

**Never in the brief:** "check all uses", "run the race tests if useful" without a task-specific reason; "do not flag X"; "at most LOW". If you believe a finding would be a false positive, let the reviewer raise it and adjudicate it in the loop.

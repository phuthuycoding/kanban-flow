# Automation-writer brief — the dispatch for a work item's UI/E2E specs

Use this template verbatim when dispatching the automation-writer, only under `Level: full`: from the task loop for a task whose test cases include `UI` or `E2E` types, after the developer's commit or before it against a `data-testid` contract the plan fixes; from kf:test section 2 when the UI/E2E suite is missing or a UI test case has no spec. Exact values live in the brief file, never in this prompt. When the `automation-writer` agent is not registered, a general-purpose subagent stands in with the body of `${CLAUDE_PLUGIN_ROOT}/agents/automation-writer.md` pasted first and `stand-in: general-purpose` written in the ledger line.

```
Agent:
  subagent_type: kf:automation-writer # or general-purpose (stand-in; paste the agent body first)
  model: [MODEL]                   # REQUIRED — sonnet by default; opus for multi-file or design judgement or a test failing twice (references/task-loop.md § Model selection)
  description: "Write UI specs for [TASK-NNN | FEATURE]"
  prompt: |
    You are writing the Playwright specs for [TASK-NNN: task name | the UI test cases] of
    the kanban-flow [feature|bug] "[FEATURE]".

    ## Your requirements
    Read your brief first: [BRIEF_FILE]
    It carries the Test Strategy (Level, UI Tests, Tools), the test case blocks whose Test
    type is UI or E2E, and — inside a task — the task row, its Files allowlist and the
    `data-testid` contract when the plan fixes one.

    ## Where you work
    Worktree: [WORKTREE] on branch [BRANCH]. Never touch the main checkout.
    Base URL: [DOMAIN_URL], or the fallback [FALLBACK_URL] when the domain does not resolve. When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>`.
    Files allowlist: [FILES]. Write only spec files inside it, never production code and
    never the test-writer's tests.
    Precondition: [PRECONDITION — the UI exists | the data-testid contract in the brief].

    ## Your job
    1. Expected values come from the test cases, never from what the screen shows today.
    2. The Playwright MCP is for selector discovery only, one agent at a time; what you see
       in its browser is not evidence. The evidence is the headless `npx playwright test`
       run (or the project's own Playwright command), with its real exit code.
    3. Do not commit; inside a task the developer commits your spec files unchanged.
    4. Never spawn agents or reviewers.

    ## Report
    Write your full report to [REPORT_FILE], as your agent definition lays out, then reply
    with at most 15 lines ending with the `STATUS:` and `Summary:` lines.
```

**Placeholders**

- `[MODEL]` — REQUIRED. See `references/task-loop.md` § Model selection.
- `[BRIEF_FILE]` — `<item>/loop/task-NNN-brief.md` in the task loop, carrying the task's UI/E2E TC blocks; `<item>/loop/testing-e2e-brief.md` at the testing stage (kf:test section 2).
- `[REPORT_FILE]` — `<item>/loop/task-NNN-e2e-report.md` in the task loop; `<item>/loop/testing-e2e-report.md` at the testing stage.
- `[WORKTREE]`, `[BRANCH]`, `[DOMAIN_URL]`, `[FALLBACK_URL]` — the `Worktree:` and `Domain:` lines and the `127.0.0.1:<port>` fallback from `kf status --change <feature>`. When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>` (the JSON outputs still carry `domain`; do not use it then).
- `[FILES]` — the task row's Files allowlist in the task loop; the Playwright `testDir` at the testing stage (the spec paths when the config sets none).
- `[PRECONDITION]` — which of the two holds; neither holding is a BLOCKED, not a dispatch.

**What never goes in the dispatch:** the session's history, the whole plan, another task's findings.

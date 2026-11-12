# Automation-writer brief — the dispatch for a work item's UI/E2E specs

Use this template verbatim when dispatching the automation-writer, only under `Level: full`: from the task loop for a task whose test cases include `UI` or `E2E` types, after the developer's commit or before it against a `data-testid` contract the plan fixes. Only kf:implement dispatches it; the testing stage never does. Exact values live in the brief file, never in this prompt. When the `automation-writer` agent is not registered, a general-purpose subagent stands in with the body of `${CLAUDE_PLUGIN_ROOT}/assets/agents/automation-writer.md` pasted first and a `Note TASK-NNN: automation-writer stand-in general-purpose` line in the ledger.

```
Agent:
  subagent_type: kf:automation-writer # or general-purpose (stand-in; paste the agent body first)
  model: [MODEL]                   # REQUIRED — sonnet by default; opus for multi-file or design judgement or a test failing twice (references/task-loop.md § Model selection)
  description: "Write UI specs for [TASK-NNN]"
  prompt: |
    You are writing the Playwright specs for [TASK-NNN: task name] of
    the kanban-flow [feature|bug] "[FEATURE]".

    ## Your requirements
    Read your brief first: [BRIEF_FILE]
    It carries the Test Strategy (Level, UI Tests, Tools), the test case blocks whose Test
    type is UI or E2E, the task row, its Files allowlist and the
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
    3. Do not commit; the developer commits your spec files unchanged.
       Resumed with review findings about your specs: fix the spec against the test case,
       re-run it headless, append a fix report to [REPORT_FILE] (task-NNN-e2e-report.md);
       never edit production code or commit.
    4. Never spawn agents or reviewers.

    ## Report
    Write your full report to [REPORT_FILE], as your agent definition lays out, then reply
    with at most 15 lines ending with the `STATUS:` and `Summary:` lines.
```

**Placeholders**

- `[MODEL]` — REQUIRED. See `references/task-loop.md` § Model selection.
- `[BRIEF_FILE]` — `<item>/loop/task-NNN-brief.md`, carrying the spec's Test Strategy (`Level`, `UI Tests`, `Tools`), the task's UI/E2E TC blocks and the `data-testid` contract when the plan fixes one.
- `[REPORT_FILE]` — `<item>/loop/task-NNN-e2e-report.md`.
- `[WORKTREE]`, `[BRANCH]`, `[DOMAIN_URL]`, `[FALLBACK_URL]` — the `Worktree:` and `Domain:` lines and the `127.0.0.1:<port>` fallback from `kf status --change <feature>`. When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>` (the JSON outputs still carry `domain`; do not use it then).
- `[FILES]` — the task row's Files allowlist.
- `[PRECONDITION]` — which of the two holds; neither holding is a BLOCKED, not a dispatch.

**What never goes in the dispatch:** the session's history, the whole plan, another task's findings.

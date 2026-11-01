# Harness

kanban-flow has one execution path: the **in-session loop**. The session you are working in is the controller. It dispatches the agents below, runs the mechanical checks through `kf verify`, and moves the stages with `kf`. kf itself spawns no worker, supervises no process and keeps no run state: everything it knows is in `.works/`, the artifacts and `.kfw.json`.

`kf drive`, `kf run`, `kf runs` and `kf harness` were removed, along with the runner, role and stage configuration behind them. A repository that still carries those config keys or run state in its item metadata is migrated by `kf doctor --fix` (see [Migrating](#migrating-from-the-removed-commands)).

## Config

The only `harness` keys are the two verify lists in `.kf/config.json`. Each entry is an argv array run without a shell; kf never runs a command read from an artifact, a report or agent output.

```json
"harness": {
  "verify": {
    "task":  [["npm", "run", "typecheck"]],
    "stage": [["npm", "run", "build"], ["npm", "test"]]
  }
}
```

- `harness.verify.task` runs after each task commit.
- `harness.verify.stage` runs once per stage, before the item leaves implementation for testing.

## `kf verify`

```
kf verify <feature> --task TASK-### --base <sha>
kf verify <feature> --stage
```

`--task` runs `harness.verify.task` and checks that the task changed only files inside its **Files** allowlist in the approved plan, comparing `HEAD` against `--base` (the commit before the task). `--stage` runs `harness.verify.stage`. Neither moves a stage, commits or edits anything.

| Exit | Meaning |
|---|---|
| 0 | the verify commands passed or none are configured (nothing is run), and, for `--task`, every changed file is inside the allowlist |
| 1 | a verify command failed |
| 2 | a file outside the task's allowlist changed: `kf stage <f> planning`, edit the plan's Files, the human approves, `kf approve <f>` (moves the item back to implementation), then re-run `kf verify`; or revert the file |
| 3 | bad input (missing feature, `--task` without `--base`, both or neither of `--task` and `--stage`), or `kf verify could not run: …` (an unexpected error while preparing; the stack is on stderr); nothing was run |

The task loop in `kanban-implement` runs `kf verify --task` after each task commit and `kf verify --stage` before it moves on; the exit code, not the developer's report, decides whether the task is done.

## Migrating from the removed commands

Run `kf doctor` to see what is left behind: it warns `harness_legacy_key` for each removed config key (`harness.main`, `harness.roles`, `harness.stages`, `harness.runners`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget`) and `meta_legacy_run_state` for each item whose `.kfw.json` still holds `drive`, `runs`, `sessions` or `tasks`. When such state names a pid, the warning says so: stop that process yourself, kf never kills it.

`kf doctor --fix` removes the legacy config keys, keeps `harness.verify`, and strips the leftover item metadata under the item lock. A rewrite that fails is reported as an error and the command exits 1. Nothing else removes those keys.

## In-session agents

The phase skills hand off work *inside* the session you are working in to six subagents with a fresh context, each returning a short report:

| Agent | Dispatched by | Job | Returns |
|---|---|---|---|
| `scout` | `kanban-plan` (impact survey), `kanban-implement` (before a task touches a shared surface) | What depends on the thing about to change: consumers in three passes, covering tests and uncovered paths, dual writes, why the code exists | A `file:line` map under 40 lines with a confidence line; "none found" always names the patterns searched |
| `spec-reviewer` | `kanban-brainstorm` before confirmation, `kanban-plan` before approval | Requirement gaps, untestable FR/AC/TC, traceability breaks, scope drift, contradictions, ungrounded names | At most 40 lines; HIGH findings go into the human's confirmation or approval ask; advisory, never a gate on its own |
| `test-writer` | `kanban-implement` per task, first | The failing unit and integration tests for the task's test cases, each failing for the right reason; rules on a developer's `TEST_DISPUTE` | A report at `<item>/loop/task-NNN-tests-report.md` |
| `developer` | `kanban-implement` per task, after the test-writer | The code that makes those tests pass, without editing them; the loop commits the task | A report at `<item>/loop/task-NNN-report.md` |
| `automation-writer` | `kanban-implement` for UI tasks under the full level, `kanban-test` when the UI suite is missing | Playwright specs for the UI test cases; the Playwright MCP for selector discovery only | The spec files, committed unchanged by the developer in the task loop and by the in-session controller at the testing stage |
| `code-reviewer` | `kanban-implement` per task, `kanban-review` for the whole branch | Findings against one review pack (intent, diff, verified facts, rules, deferred, baseline) across correctness, security, contracts, performance, intent, over-engineering and the AI-risk lens | A JSON findings array with a verbatim `evidence` line each, then `Declined` / `Deferred` / `Shippable`; it has no write tool and dispatches nothing |

The agent bodies live in the `kanban-flow` skill (`skills/kanban-flow/agents/<name>.md`), so every runtime that has the skill can read them; `kf install` additionally links (global scope) or copies (project scope, npx cache, denied symlink) them into `.claude/agents/` or `~/.claude/agents/` for Claude Code's registry, never replacing a file of yours under one of those names (`kf doctor` reports such a file, and reports agents that went missing after an upgrade; `--fix` reinstalls them). Runtimes without a registry paste the body into a plain subagent. The review stage sizes the reviewer set from the diff (`skills/kanban-review/scripts/select-tier`: one reviewer at ≤200 changed code lines, plus one contracts reviewer when a shared surface changed; five dimensions — bugs, security, perf, contracts, intent — in parallel at 201–600; all five on `opus` above 600 or on a critical area) and drops any finding whose evidence quote is missing, too short, or not within 20 lines of the cited line (`scripts/verify-findings.mjs`) before it reaches `phase-5-review-report.md`. The reviewer has no write tool: its reply is the report and the orchestrator saves it.

The session is the controller: it dispatches these agents, runs `kf verify` after each task commit and moves the stages. kf spawns no worker and supervises no process. The whole-branch review at the review stage then covers everything the per-task reviews saw.

## Limits

- The session is the controller, so a stage only advances while a session is running it. The ledger at `<item>/loop/progress.md` lets a new session resume where the last one stopped.
- Every read-modify-write of `.kfw.json` holds a per-item lock in `.works/.locks/<feature>.lock`; a lock whose pid is dead is taken over, a live one is waited on for 30 seconds. `kf doctor` reports dead locks.
- kf commits nothing for the loop: the developer commits the task, so the repository's own git hooks and signing apply to those commits.
- A verify command that leaves untracked files behind does not block merges; one that modifies tracked files does, until they are committed or reverted.
- `kf verify --task` takes only a planned `TASK-###`, not ad-hoc work.

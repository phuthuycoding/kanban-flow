# Harness

kanban-flow has one execution path: the **in-session loop**. The session you are working in is the controller. It dispatches the agents below, runs the mechanical checks through `kf verify`, and moves the stages with `kf`. In the task loop it asks `kf next` what is due and writes the ledger with `kf record`. kf itself spawns no worker, supervises no process and keeps no run state: everything it knows is in `.works/`, the artifacts and `.kfw.json`.

`kf drive`, `kf run`, `kf runs` and `kf harness` were removed, along with the runner, role and stage configuration behind them. A repository that still carries those config keys or run state in its item metadata is migrated by `kf doctor --fix` (see [Migrating](#migrating-from-the-removed-commands)).

## Config

The only `harness` keys are the two verify lists and the developer ceiling in `.kf/config.json`. Each entry is an argv array run without a shell; kf never runs a command read from an artifact, a report or agent output.

```json
"harness": {
  "verify": {
    "task":  [["npm", "run", "typecheck"]],
    "stage": [["npm", "run", "build"], ["npm", "test"]]
  },
  "developers": { "max": 6 }
}
```

- `harness.verify.task` runs after each task commit.
- `harness.verify.stage` runs once per stage, before the item leaves implementation for testing.
- `harness.developers.max` is the ceiling of the live developer cap (integer 1..16, default 6); `kf tasks --json` reports it as `developers: {max, source}`. The start value and the step rules are not configurable.

## `kf verify`

```
kf verify <feature> --task TASK-### --base <sha>
kf verify <feature> --task TASK-### --commits <sha>[,<sha>…] [--at-head]
kf verify <feature> --stage
```

`--at-head` keeps the allowlist check on the listed commits and runs the commands at HEAD, for a commit that cannot build without a parallel task's commit.

`--task` runs `harness.verify.task` and checks that the task changed only files inside its **Files** allowlist in the approved plan, comparing `HEAD` against `--base` (the commit before the task). `--commits` takes the exact commit list instead: those commits are checked against the allowlist and the commands run in a temporary detached worktree at the newest of them, which is how the pipelined loop verifies a task while the next one is being written (`--base` stays the single-task form). For a bug, `--task` takes a `TASK-###` checkbox line of its `tasks.md`; a bug has no Files, so no allowlist check runs. `--stage` runs `harness.verify.stage`. Neither moves a stage, commits or edits anything.

| Exit | Meaning |
|---|---|
| 0 | the verify commands passed or none are configured (nothing is run), and, for `--task`, every changed file is inside the allowlist |
| 1 | a verify command failed |
| 2 | a file outside the task's allowlist changed: `kf stage <f> planning`, edit the plan's Files, the human approves, `kf approve <f>` (moves the item back to implementation), then re-run `kf verify`; or revert the file |
| 3 | bad input (missing feature, `--task` without `--base` or `--commits`, `--at-head` without `--commits`, both `--base` and `--commits`, `--commits` with `--stage`, an empty `--commits` element, both or neither of `--task` and `--stage`, `--base` with `--stage`, and for `--commits` a sha that is not a commit, a merge commit, a root commit, not an ancestor of HEAD, repeated, or out of history order, an unknown task, a missing worktree), or `kf verify could not run: …` (an unexpected error while preparing; the stack is on stderr); nothing was run |

The task loop in `/kf:implement` runs `kf verify --task` after each task commit and `kf verify --stage` before it moves on; the exit code, not the developer's report, decides whether the task is done.

## kf next and kf record

`kf next <feature> [--resume] [--json]` decides what the task loop does next. It reads the ledger `<item>/loop/progress.md`, the plan (a bug's `tasks.md`), the task reports, the verify logs and the item branch's `git log`, and prints every action due now: `dispatch` a seat, `verify` a task, `write` a ledger line (with the `kf record` call that writes it), `complete` a task, `wait`, `decide`, `stop`, or `finished`. It owns the scheduling rules below — the order, the overlaps, the live developer cap, contention, fix rounds, cascades and completion — and dates every commit by the first ledger line that names it, never by `git log` time, and changes no file, starts no process and spawns no seat: the session still dispatches every seat with `Agent()`. A `decide` names a judgement the skill keeps under `## Decisions` (a conflict scan, a seat's non-DONE status, a missing commit, a verify exit 3, the breaker, an invalid ceiling, drift, a task the plan lost) and the ledger line that closes it. `--resume` lists the seats and verifies the ledger shows open for a re-run, before any new developer. A ledger line it cannot read refuses the run (exit 1) with the lines to repair.

`kf record <feature> <event> …` appends one stamped line to the ledger under the item lock: `dispatched`, `done`, `verify-started`, `verify-done`, `commits`, `waits`, `fix-round`, `cascade-owed`, `complete`, or `line -- <text>` for a ruling, a note or test hashes. It refuses an unknown event, or one the ledger contradicts, and then writes nothing.

The plan records an **execution mode per wave** from `kf tasks <feature> --graph`: `Execution: wave <w> inline` for a one-task wave, `Execution: wave <w> parallel, <N> developers` (N = the largest set of the wave's tasks whose Files do not overlap one another, from `overlaps` in `kf tasks <feature> --json`, no clamp; the live developer cap decides how many run) otherwise. An inline wave spawns no developer: the session fills the seat itself and ledgers `Note TASK-NNN: developer seat inline`, test-writers still run ahead for the next 4 tasks, the code-reviewer stays an independent agent, and task N+1 is not committed until N's review is back and N's HIGH and MEDIUM findings are fixed. On signature drift from the plan the session ledgers a `Ruling:` and re-dispatches the dependent test-writers, never editing their tests. A chain of more than 5 inline tasks, or a shorter one with large diffs on a `Ruling:`, uses one developer subagent resumed for the whole chain.

The loop is **pipelined**: developers share one worktree under a live developer cap (the cap counts fix-round and resume-commit developers). The live developer cap starts at min(2, ceiling), steps up by one after each clean parallel wave and halves (never below 1) on a contention-shaped verify failure; its ceiling is `harness.developers.max` (integer 1..16, default 6). `kf next` has the controller ledger `Ruling: developer cap <N> — start — cost if wrong: <…>` at the start, a `Ruling: developer cap <old> → <new> — …` line for each step up, step down or lowered ceiling, and `Note wave <w>: no step-up — <not clean | inline | ceiling | last wave | widest incomplete wave>` when a wave does not raise it; a contention failure is followed by `Note TASK-NNN: verify rerun — contention <signature>` and one re-run. Only the controller's ledgered verify runs count. `kf verify --task` appends each run with its exit code to `<item>/loop/task-NNN-verify.log`, from which contention is classified, a resume rebuilds the cap and `kf loop-stats` checks the ledger's verify lines. Developers run on ready tasks whose Files are disjoint (`kf tasks --json` `overlaps`; `kf tasks <feature> --graph` shows the critical path and the max width). Each developer commits through `skills/implement/scripts/commit-task.mjs`, a path-limited commit that retries a held `index.lock` and reports it, never deleting it (standalone, no dist import; 0 committed, exit 2 usage, 4 `BLOCKED` for a path outside the allowlist (the line goes to stderr) or a bad path — absolute, containing a `..` segment or a backslash, starting with `:` — or an `--allow` that is empty once normalised, or the script run from a subdirectory (`BLOCKED: run from the repository root`), or a path that is `.` or a directory (`BLOCKED: <path> is a directory; name each file`), or a git failure after the commit (`BLOCKED: commit made …`: the commit exists, never commit again); the printed sha is the latest commit on the task's paths, 5 `BLOCKED: index.lock held` after the retries, anything else git's own status). A task is dispatched only when its Files overlap no open task; an open task has a `test-writer dispatched` or `developer dispatched` line and no `complete` line. Overlapping tasks open in wave order: an earlier task (a lower wave, then plan order) that overlaps a task and is not complete holds it back. A developer held back by an overlap is ledgered `developer waits — Files overlap <mine> / <theirs> (TASK-MMM)`; one held back by the cap is ledgered `TASK-NNN: developer waits — <N> developers in flight`. `kf next` prints the controller's work list of ready seats and the controller dispatches them all, so tasks may complete out of order. `kf verify --commits` checks a task's commits in a detached worktree so another task's uncommitted files cannot leak in. The suite's build setup continues only when `tsc` exits 2 (type errors, JS emitted); any other non-zero exit fails it, and no environment variable changes that. The ledger stays the resume truth and the only source of in-flight state: each line ends in ` @ <ISO>` (grammar in `skills/implement/references/task-loop.md` § The ledger), and `kf loop-stats <feature> [--record]` measures it into `.works/loop-metrics.md`; its `developers peak` and `developer overlap` count finished developer seats (dispatched…done intervals), never one still in flight.

## Migrating from the removed commands

Run `kf doctor` to see what is left behind: it warns `harness_legacy_key` for each removed config key (`harness.main`, `harness.roles`, `harness.stages`, `harness.runners`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget`) and `meta_legacy_run_state` for each item whose `.kfw.json` still holds `drive`, `runs`, `sessions` or `tasks`. When such state names a pid, the warning reports it only while that process still looks like a kf drive or worker (its command line names `kanban-flow`, or a `kf` or `dist/index.js` word followed by `drive` or `run` (read with `ps`, 1 s timeout)); any other live process holding the pid was recycled and counts as dead; when kf cannot check (no `ps`, or `ps` fails or times out), it reports the pid and says it could not confirm. Stop that process yourself, kf never kills it, and `--fix` leaves such an item untouched until the process stops.

`kf doctor --fix` removes the legacy config keys, keeps `harness.verify`, and strips the leftover item metadata under the item lock. A rewrite that fails is reported as an error and the command exits 1. Nothing else removes those keys.

## In-session agents

The phase skills hand off work *inside* the session you are working in to seven subagents with a fresh context, each returning a short report:

| Agent | Dispatched by | Job | Returns |
|---|---|---|---|
| `researcher` | `/kf:brainstorm`, `/kf:plan`, `/kf:implement` and `/kf:spike` | One outside-knowledge question in mode `web`, `code` or `prior-art`, answered from primary sources with citations; the full findings go to a report file | At most 40 lines: conclusion, confidence, sources, verified / inferred / unverified; ends with a `STATUS:` line |
| `scout` | `/kf:plan` (impact survey), `/kf:implement` (before a task touches a shared surface) | What depends on the thing about to change: consumers in three passes, covering tests and uncovered paths, dual writes, why the code exists | A `file:line` map under 40 lines with a confidence line; "none found" always names the patterns searched |
| `spec-reviewer` | `/kf:brainstorm` before confirmation, `/kf:plan` before approval | Requirement gaps, untestable FR/AC/TC, traceability breaks, scope drift, contradictions, ungrounded names | At most 40 lines; HIGH findings go into the human's confirmation or approval ask; advisory, never a gate on its own |
| `test-writer` | `/kf:implement` per task, first | The failing unit and integration tests for the task's test cases, each failing for the right reason; rules on a developer's `TEST_DISPUTE` | A report at `<item>/loop/task-NNN-tests-report.md` |
| `developer` | `/kf:implement` per task, after the test-writer | The code that makes those tests pass, without editing them; the loop commits the task | A report at `<item>/loop/task-NNN-report.md` |
| `automation-writer` | `/kf:implement` for UI tasks under the full level, `/kf:test` when the UI suite is missing | Playwright specs for the UI test cases; the Playwright MCP for selector discovery only | The spec files, committed unchanged by the developer in the task loop and by the in-session controller at the testing stage |
| `code-reviewer` | `/kf:implement` per task, `/kf:review` for the whole branch | Findings against one review pack (intent, diff, verified facts, rules, deferred, baseline) across correctness, security, contracts, performance, intent, over-engineering and the AI-risk lens | A JSON findings array with a verbatim `evidence` line each, then `Declined` / `Deferred` / `Shippable`; it has no write tool and dispatches nothing |

The agent bodies live in the package's `agents/` directory, which the `kf` plugin registers for Claude Code (dispatched as `kf:<agent>`); for other runtimes `kf install` links (global scope) or copies (project scope, npx cache, denied symlink) them into the runtime's agents dir when it has one, never replacing a file of yours under one of those names (`kf doctor` reports such a file, and reports agents that went missing after an upgrade; `--fix` reinstalls them). Runtimes without a registry paste the body into a plain subagent. The review stage sizes the reviewer set from the diff (`skills/review/scripts/select-tier`: one reviewer at ≤200 changed code lines, plus one contracts reviewer when a shared surface changed; five dimensions — bugs, security, perf, contracts, intent — in parallel at 201–600; all five on `opus` above 600 or on a critical area) and drops any finding whose evidence quote is missing, too short, or not within 20 lines of the cited line (`scripts/verify-findings.mjs`) before it reaches `phase-5-review-report.md`. The reviewer has no write tool: its reply is the report and the orchestrator saves it.

The session is the controller: it dispatches these agents, runs `kf verify` after each task commit and moves the stages. kf spawns no worker and supervises no process. The whole-branch review at the review stage then covers everything the per-task reviews saw.

## Limits

- The session is the controller, so a stage only advances while a session is running it. The ledger at `<item>/loop/progress.md` lets a new session resume where the last one stopped, through `kf next <feature> --resume`.
- Every read-modify-write of `.kfw.json` holds a per-item lock in `.works/.locks/<feature>.lock`; a lock whose pid is dead is taken over, a live one is waited on for 30 seconds. `kf doctor` reports dead locks.
- kf commits nothing for the loop: the developer commits the task, so the repository's own git hooks and signing apply to those commits.
- A verify command that leaves untracked files behind does not block merges; one that modifies tracked files does, until they are committed or reverted.
- `kf verify --task` (with `--base` or `--commits`) takes only a planned `TASK-###` (for a bug, a `tasks.md` line), not ad-hoc work.

# Multi-agent harness

A **role** does one job in the pipeline, and each role points at a **runner**: a CLI, a model and its permission flags. Stages are assigned to roles, never to vendors. Assign no stages and nothing changes: the main agent does everything itself.

## Why three layers

```
stage  →  role       →  runner
testing   tester        gemini (CLI + model + permission flags)
```

- **Stage to role almost never changes.** Testing always wants a tester, review always wants a reviewer. Write it once.
- **Role to runner is where you change your mind about a model.** Find one that writes better and `writer` becomes a one-line edit, with no stage touched.
- **Runner to CLI and flags** is what breaks when a vendor changes its interface. One broken runner does not take the rest down with it.

Every model is strong at something different: breadth of research, prose, code, review. A role is how you say "this job needs that strength" without hard-wiring a vendor's name into the pipeline.

## Why "resume the latest session" is never needed

kanban-flow keeps its state in files: `.works/`, the artifacts and `.kfw.json`. It never relies on what a conversation remembers. A worker for a stage is a fresh headless session whose context is that stage's skill plus the artifacts on disk. A session is kept **per work item and per role**, so the repair loop from FAIL back to implement continues in the session that did the work, and that id is either minted by kf or fetched deterministically, never guessed as "the latest". Two roles sharing one runner still get two separate sessions, so `coder` and `reviewer` on the same CLI never see each other's context.

## Config

The `harness` block in `.kf/config.json`, which `kf harness` displays. This example is a **hand-tuned** one, spreading roles across several runners. What `kf init` seeds is deliberately plainer: all six roles on the single agent you chose, and `"stages": {}` — so nothing is routed to a worker until you assign it:

```json
"harness": {
  "main": "architect",
  "roles": {
    "architect":  "claude-opus",
    "researcher": { "runner": "codex",  "brief": "Explores breadth: prior art, libraries, comparable features.", "output": "research.md" },
    "writer":     { "runner": "gemini", "brief": "Turns agreed decisions into precise prose." },
    "coder":      "claude-opus",
    "tester":     { "runner": "devin",  "brief": "Runs the real suite and records exact commands and exit codes." },
    "reviewer":   "codex"
  },
  "stages": {
    "brainstorm":     ["researcher", "writer"],
    "implementation": "coder",
    "testing":        "tester",
    "review":         "reviewer"
  },
  "runners": {
    "claude-opus": {
      "start":  ["claude", "-p", "{prompt}", "--session-id", "{session}", "--add-dir", "{itemDir}", "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose"],
      "resume": ["claude", "-p", "{prompt}", "-r", "{session}", "--add-dir", "{itemDir}", "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose"],
      "session": "provided",
      "usage": "json"
    },
    "codex": {
      "start":  ["codex", "exec", "--json", "{prompt}"],
      "resume": ["codex", "exec", "resume", "{session}", "{prompt}"],
      "session": { "stdout": "\"thread_id\":\"([^\"]+)\"" },
      "usage": "json"
    },
    "devin": {
      "start":  ["devin", "-p", "{prompt}", "--permission-mode", "accept-edits"],
      "resume": ["devin", "-p", "{prompt}", "-r", "{session}", "--permission-mode", "accept-edits"],
      "session": { "command": ["devin", "list", "--format", "json"], "idField": "id", "matchField": "title" }
    },
    "gemini":   { "start": ["gemini", "-p", "{prompt}", "--approval-mode", "auto_edit"] },
    "opencode": { "start": ["opencode", "run", "{prompt}"] }
  }
}
```

- `main`: the role the orchestrating agent plays. It must be a role, not a runner.
- `roles.<role>`: a runner name in short form, or `{ runner, brief?, output? }`.
  - `brief`: a sentence or two describing the role, injected into the prompt so the worker knows what it was called for.
  - `output`: an extra file the role must write inside the work item folder, such as `research.md`, for the next role to read. The path has to stay inside the work item folder.
- `stages.<stage>`: one role, or **an array of roles run in order**. The `backlog` stage cannot be assigned. Any stage left undeclared is handled by the main agent.
- `runners.<runner>`: see the table below. Permissions (`--permission-mode`, `--approval-mode`, `--sandbox`) live in the template; kf injects no flags of its own.

Adding a model means adding a runner and pointing a role at it. Two models on one CLI, such as `claude-opus` and `claude-haiku`, are two runners, assigned to the expensive role and the cheap one.

### Runner fields

| Field | What it means |
|---|---|
| `start` | The argv for a fresh session. `{prompt}` is mandatory. `{session}` is allowed only under `session: "provided"`, where kf mints a UUID before running |
| `resume` | The argv to continue a stored session; it must contain `{session}`. Without it the role always starts fresh |
| `session` | `"provided"`, `{ "stdout": "<regex, group 1>" }`, or `{ "command", "idField", "matchField" }`, which runs a command returning a JSON array and picks the entry whose `matchField` contains the `kf-run:<id>` marker kf puts at the head of the prompt |
| `usage` | `"json"` parses `usage.input_tokens` and `usage.output_tokens`, plus `total_cost_usd` when present, from JSON on stdout |
| `skillsDir` | The runner's skills directory. Defaults follow `kf install`: `.claude/skills`, `.agents/skills` (codex), `.gemini/skills`, `.kiro/skills`, `.cursor/skills`, `.opencode/skills`, and any unfamiliar name falls back to `.agents/skills` |
| `resumeFailure` | A regex that recognises a failed resume; the default is `session\|not found\|no such\|unknown\|does not exist` |

### Presets, as verified on 2026-09-19

| Runner | Session | What was verified |
|---|---|---|
| claude | kf mints the UUID via `--session-id`, resumes with `-r`; usage and cost come from the JSON | Run for real: start and resume both work |
| codex | `thread_id` from the JSONL of `exec --json`, resumes with `exec resume <id>`; usage from `turn.completed` | Run for real: start and resume both work |
| devin | `devin list --format json` matched on `title` against the marker; resumes with `-r <id>` | Run for real: start, list and resume all work. Devin refuses an untrusted directory, so open `devin` interactively once inside the repo |
| gemini | no resume | Could not log in on the verification machine. `-r` accepts `latest` or an index; whether it accepts a UUID is unknown |
| opencode | no resume | How to obtain the id is unverified; `run -s <id>` does exist |

## Flow

1. Before each stage, the main agent, running the `kanban-flow` skill, reads `kf status --change <f> --json`. When `assignedRoles` is present it runs `kf run <f>`, adding `--detach` for a long stage such as implementation and then polling `kf runs <f>`.
2. `kf run` resolves the stage's role chain and runs it **in order**. Each role's prompt carries: the role and its `brief`, the work item, the stage, the folder, the path to that runner's phase `SKILL.md`, pointers to `kf status` and `kf instruct`, the requirement to write `output` when the role has one, a "Previous step" section naming the previous role, its output file and its log from the second step onward, and the contract: do only this stage's work, never run `kf stage`, `kf approve`, `kf archive` or `kf run`, never edit an approved contract, never commit, and finish with `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` followed by `Summary:`.
3. Each role is its own run: its own process group, its own `runs/<id>.log`, and one entry in `.kfw.json.runs[]` carrying both `role` and `runner`.
4. A role that does not end in `DONE` or `DONE_WITH_CONCERNS` **stops the chain**. The roles after it do not run, `kf run` exits 1, and it names which role stopped and which were skipped.
5. The main agent reads `STATUS` and `Summary` from the tail of the log, without swallowing the transcript, runs `kf validate` and decides on the transition. The gate does not take the worker's word for anything.
6. On the repair loop, the next `kf run` resumes that role's session for that work item, and the prompt gains the path to the current FAIL report. `--fresh` forces a new session.

`kf run --role <name>` runs exactly one role from the chain. `--dry-run` prints the plan for the whole chain, one argv and prompt block per role. The timeout is 30 minutes by default (`--timeout <minutes>`, `0` for none); on expiry the whole process group is killed and the run is marked `timeout`. There is no automatic retry: a failed resume resets the session exactly once and starts fresh. A stage-level `kf run` is refused while any other run of the item, or its drive, is live.

With `--detach`, kf writes the chain plan, spawns a detached `kf run --supervise <id>` as the supervisor and returns immediately. The supervisor runs the whole chain and finds the folder again by work item name before writing results; when the folder is gone it writes `.works/harness/orphan-<id>.json`. `kf runs` reports `failed (supervisor lost)` when a record is still `running` but its pid is dead, and it never repairs the metadata on its own.

## Task harness: `kf drive`

The stage-level flow above still needs a main agent to call `kf run`, read STATUS and move stages. `kf drive` takes that over after the human's `kf approve`: it runs the item from implementation to a review PASS on its own and stops only at a human gate or a named stop. The start decision is `kf approve`, which moves the item into implementation.

### What it needs

- `"worktree": { "enabled": true }` — every task runs in its own worktree, so parallel workers never share a checkout. `kf validate` warns on items in planning or backlog when a drive is configured but worktrees are off.
- `harness.verify` — the commands kf itself runs to check work, pinned by a human. Each is an argv array run without a shell; kf never runs a command read from an artifact, a report or worker output.
- A plan whose Task Breakdown has `Role` and `Files` columns (see [the implementation plan](artifacts.md#the-implementation-plans-task-breakdown)). The plan is fingerprinted by `kf approve`, so the graph and the role of each task are part of the approved contract.

```json
"harness": {
  "verify": {
    "task":  [["npm", "run", "typecheck"]],
    "stage": [["npm", "run", "build"], ["npm", "test"]]
  },
  "parallel": 3,
  "retries": 1,
  "maxLoops": 2,
  "budget": { "maxRuns": 30 }
}
```

`parallel`, `retries`, `maxLoops` and `budget.maxRuns` default to 3, 1, 2 and 30 when unset; `kf harness` shows the effective values.

### Task graph

`kf tasks <f> [--json]` lists the planned tasks with their wave, state (`pending`, `ready`, `running`, `verifying`, `merging`, `done`, `failed`, `blocked`), resolved role, dependencies and files. A task's role is the plan's `Role` when it names a declared role; `-` means the first role of `harness.stages.implementation`, else `harness.main`.

`kf run <f> --task TASK-###` runs one task by hand: it refuses an unknown task, an unfinished dependency, an item outside implementation, a stale approval or worktrees off, and it never retries on its own.

For every task kf:

1. cuts a task worktree and branch beside the item's — `<item-branch>--task-001` at `<baseDir>/<feature>.tasks/task-001`, no port or route;
2. runs the role's runner there with a prompt naming only that task, its references, expected output and `Files` allowlist;
3. checks the worker's changes against the allowlist — a change outside it **blocks the task and stops the drive** with `plan_change_needed`, because the approved plan must change;
4. commits the result itself (`task(TASK-###): …`) and merges it into the item branch, one merge at a time; a modified tracked file in the item worktree or a conflict blocks the task;
5. runs `harness.verify.task` in the item worktree and resets the item branch to the pre-merge commit when it fails.

A worker that reports `BLOCKED` or `NEEDS_CONTEXT` blocks its task at once. Other failures are retried up to `harness.retries` times in the same session with the failure in the prompt, then block. The scheduler runs up to `parallel` ready tasks at once, never two whose `Files` overlap, and runs a task without `Files` (or with `**`, `*`, `.`) alone.

### The drive

`kf drive <f>` refuses, naming the human step, unless the item is in implementation with a current approval, worktrees are on, `harness.verify.stage` is set and no drive is live. Then a detached supervisor:

1. runs the task graph (a bug, which has no task table, gets one run of the implementation role instead);
2. runs `harness.verify.stage` in the item worktree;
3. moves to testing through the normal gates and hooks, runs the testing role(s), reads the report;
4. on PASS moves to review, runs the review role(s) and on PASS stops with **ready — review PASS: merge the PR, kf status --change <feature> closes the item** — it never merges or archives;
5. on FAIL or REJECT moves back to implementation, runs one repair run pointed at the report, verifies and tests again, at most `maxLoops` times.

Before every run it checks the budget, the approval fingerprint and a hash of the whole `harness` block — `main`, `roles`, `stages`, `runners`, `verify`, `parallel`, `retries`, `maxLoops` and `budget`, each key hashed on its own — plus `worktree.enabled` and which file the config came from. A stop takes effect at the next step boundary: runs already in progress finish, no new one starts.

| Stop code | Meaning | Next |
|---|---|---|
| `plan_change_needed` | a task touched files outside its allowlist | edit the plan's Files, `kf approve`, `kf drive` |
| `tasks_blocked` | no task can progress | `kf tasks <f>`, fix, `kf drive` (blocked tasks go back to pending) |
| `worker_blocked` | a worker reported BLOCKED/NEEDS_CONTEXT or a role did not finish | answer it, `kf drive` |
| `verify_failed` | `harness.verify.stage` failed | fix, `kf drive` |
| `loop_limit` | `maxLoops` repair loops used | fix by hand or raise `maxLoops` |
| `requirement_bug` | review says REQUIREMENT_BUG | back to planning with the human |
| `transition_refused` | a gate or stage hook refused a move | fix the cause, `kf drive` |
| `approval_changed` | the approved contract changed mid-drive | re-approve, `kf drive` |
| `config_changed` | a `harness` key, `worktree.enabled` or the config source changed mid-drive, or the config no longer parses; the reason names the keys (runner and verify argv as `old → new`) and the resolved file | check those commands, then `kf drive <f> --accept-config` |
| `budget` | `budget.maxRuns` worker runs used | raise it, `kf drive` |
| `usage_limit` | a worker hit the API usage limit (HTTP 429); no run or attempt is spent, the task is pending again and the worker session is kept | after the reset quoted in the reason, `kf drive <f>` resumes the same session |
| `git_error` | a merge abort or reset failed; the item branch needs a human | `kf tasks <f>` |
| `stopped_by_user` | `kf drive --stop` | `kf drive` |
| `internal_error` | the supervisor itself failed; the stack is in the drive log | `kf drive` |

**Config resolution.** A drive and `kf run --task` read `.kf/config.json` from the item worktree when it has one, else from `origin/<default branch>`, else from the primary checkout — a stale local `main` never decides what a drive does. The chosen place is `config_source` (`worktree`, `origin` or `primary`): it is logged on the drive's start and resume events and shown by `kf drive <f> --status` as `Config: <source>`. `worktree.baseDir` is still read from the primary, where the worktrees were created. Every step boundary re-resolves the file, so a change to it (including a fetch that moves `origin/<default>`) raises `config_changed`, and the refusal and stop messages name the resolved file and its source. Moves the drive makes validate against the resolved harness.

**Accepting a changed config.** The worktree copy is a file workers can write, so kf records every pin that differs instead of trusting it:

- A resume compares the config with the drive's pin. When runner or verify argv changed, or the drive stopped on `config_changed`, it refuses until you run `kf drive <f> --accept-config`; other changes (roles, stages, `main`, limits, the config source) are re-pinned without the flag. Either way the changes are printed before the supervisor starts (`old → new` argv, other keys by name) and recorded; with `--json` (without `--watch`) they are in the result object instead.
- A new drive that reads the worktree copy compares its runner and verify argv with the copy the drive would read without it — `origin/<default branch>` when it has a `.kf/config.json`, else the primary checkout — and prints the differing argv as a warning that names that copy (`origin → worktree` or `primary → worktree`) before the supervisor starts, and records it. A change merged from origin into the item branch therefore does not warn just because the local `main` is stale. `refs/remotes/origin/HEAD` lives in the git directory every worktree shares, so a worker could point it at a branch it pushed: when it names a branch checked out in a linked worktree (the item branch, for example), the primary checkout is the base instead and the warning says so. A worker can still retarget it at a branch no worktree has checked out, move `refs/remotes/origin/<default branch>` itself with `git update-ref` (or push its config to another branch name and point `origin/HEAD` there), or edit the primary file, so the warning is a signal and PR review stays the boundary. When the base copy cannot be read the drive still starts: the warning says the copies could not be compared and why — the origin or the primary copy does not parse, `git show` (or `git symbolic-ref`) failed reading origin, or `git worktree list` failed while checking which branches linked worktrees hold (one line of git's error) — and the record names that copy in `against`.
- Each record is appended to `drive.configAcceptances` in the item's `.kfw.json`: the UTC time (`at`), the command that pinned it (`command`, rebuilt from the options passed that reach the claim — `--watch`, `--follow`, `--tail`, `--accept-config`, `--json`, in that order — for example `kf drive <f> --follow --accept-config`), whether the claiming process had a terminal on stdin (`tty`, a hint at a person rather than a script or agent; records written before it was kept have none), what it was compared with (`against`: `pin`, `origin` or `primary`) and the changed keys with their `old → new` argv (`changes`). Later resumes and drives keep the list; `kf drive <f> --status` shows how many there are and the last one, and `--status --json` carries the list. `--json` returns the lines as `acceptedConfig`, the warning as `configWarning` and the 0.13 note below as `configNote`; with `--watch --json` they come first, as one `{"event":"accepted_config",…}` line.
- A drive pinned by 0.13 pinned only `roles`, `runners`, `verify` and `worktree.enabled`. Keys that pin does not have are pinned as they are on resume and named once as not pinned by the older release; they are not reported as changed, do not need the flag, and are not recorded or counted as an acceptance.
- `kf run <f>` and `kf run <f> --task` print the same worktree-copy warning before any worker or verify command runs (a dry run prints it above the plan). They do not refuse.

`--accept-config` is a plain flag: kf does not ask a human before honouring it, and any agent can pass it. The record makes the acceptance visible afterwards; it does not prevent it. The real boundary for config a worker could edit is the PR review of the branch: a `.kf/config.json` change in the diff is a change to what kf runs, and is reviewed as such before it merges.

`kf drive <f> --status [--json]` shows the step, loops, runs, running tasks, the config source, each live run (`Live:` — role, runner, task, elapsed time, log path, then the worker's last action and its age, such as `— Edit src/a.ts (12s ago)`), the last event and its time, and — once stopped — the code, reason and next command; a running drive whose supervisor died shows as `crashed`. `kf drive <f> --watch` (alias `--follow`) attaches to that stream: every new `runs/drive-<id>.jsonl` line, a heartbeat at least every 15 seconds naming the live runs and each worker's last action (`TASK-006 coder claude-dev 2m14s — Edit src/a.ts (12s ago)`, or `tester @ testing 1m03s`), and on exit the stop code, reason and next command (exit 0 when the drive is `ready`, exit 1 when it stopped). Passing `--watch` with no live drive starts one and attaches. Ctrl+C detaches the watcher only. `--json` prints one JSON object per line, and `--tail` adds the last readable lines of each live log under the heartbeat (tool calls and assistant text, not raw JSON). `kf drive <f> --stop` ends the supervisor and its workers and keeps every worktree and branch. Running `kf drive` again resumes: done tasks are skipped, failed and blocked ones go back to pending, a half-finished merge is aborted and retried. Every event is appended to `runs/drive-<id>.jsonl`, including a `run_start` (run id, role, runner, task, log path) when a worker starts, and `.kf/hooks/drive-stop.sh`, when present, runs on every stop with `KFW_DRIVE_RESULT` (`ready` or `stopped`) and `KFW_DRIVE_REASON` — see [phase hooks](autoconfig.md#phase-hooks).

**What a worker is doing.** The default `claude` runner is started with `--output-format stream-json --verbose`, so `runs/<id>.log` fills while the worker runs; a runner that prints one JSON object at exit is still accepted. The last action shown in `--status` and the heartbeat is read from the tail of that log: the latest tool call (its name and the file or the start of the command) or the latest assistant text, with its age. When a worker exits non-zero, the task reason and the stop reason carry the worker's own error text instead of only `worker exited 1`.

**Usage limit.** A worker that fails on the API usage limit (HTTP 429, `usage_limit_reached`) cannot succeed on a retry, so the drive does not retry it: the run and the attempt are not counted, the task goes back to `pending`, the worker session is kept with its uncommitted work, and the drive stops with `usage_limit` and a reason quoting the reset text. After the reset, `kf drive <f>` resumes the same session. `kf run <f> --task TASK-###` ends the same way and exits 1.

## In-session agents

Runner roles are whole headless sessions kf spawns and supervises. The phase skills also hand off work *inside* a session — whether that session is the main agent or a runner worker — to three subagents with a fresh context, each returning a short report:

| Agent | Dispatched by | Job | Returns |
|---|---|---|---|
| `scout` | `kanban-plan` (impact survey), `kanban-implement` (before a task touches a shared surface) | What depends on the thing about to change: consumers in three passes, covering tests and uncovered paths, dual writes, why the code exists | A `file:line` map under 40 lines with a confidence line; "none found" always names the patterns searched |
| `spec-reviewer` | `kanban-brainstorm` before confirmation, `kanban-plan` before approval | Requirement gaps, untestable FR/AC/TC, traceability breaks, scope drift, contradictions, ungrounded names | At most 40 lines; HIGH findings go into the human's confirmation or approval ask; advisory, never a gate on its own |
| `code-reviewer` | `kanban-implement` per task, `kanban-review` for the whole branch | Findings against one review pack (intent, diff, verified facts, rules, deferred, baseline) across correctness, security, contracts, performance, intent, over-engineering and the AI-risk lens | A JSON findings array with a verbatim `evidence` line each, then `Declined` / `Deferred` / `Shippable`; it has no write tool and dispatches nothing |

The agent bodies live in the `kanban-flow` skill (`skills/kanban-flow/agents/<name>.md`), so every runtime that has the skill can read them; `kf install` additionally links (global scope) or copies (project scope, npx cache, denied symlink) them into `.claude/agents/` or `~/.claude/agents/` for Claude Code's registry, never replacing a file of yours under one of those names (`kf doctor` reports such a file, and reports agents that went missing after an upgrade; `--fix` reinstalls them). Runtimes without a registry paste the body into a plain subagent. The review stage sizes the reviewer set from the diff (`skills/kanban-review/scripts/select-tier`: one reviewer at ≤200 changed code lines, plus one contracts reviewer when a shared surface changed; five dimensions — bugs, security, perf, contracts, intent — in parallel at 201–600; all five on `opus` above 600 or on a critical area) and drops any finding whose evidence quote is missing, too short, or not within 20 lines of the cited line (`scripts/verify-findings.mjs`) before it reaches `phase-5-review-report.md`. The reviewer has no write tool: its reply is the report and the orchestrator saves it.

The division of labour between the two layers: the harness decides *who runs the stage*; the skill decides *who reviews*. `kf drive` verifies each task mechanically with `harness.verify.task` and runs no per-task reviewer; the in-session task loop in `kanban-implement` does, when the item is implemented without a drive. Both paths meet the same whole-branch review at the review stage.

## Observability

- `kf harness [--json]`: the main role, stage to role chain, role to runner with brief and output, and runner to CLI, PATH, resume and session.
- `kf status --change <f>`: `Assigned: researcher (codex) → writer (gemini) (kf run)` and `Runs: N (role×n, …)`; the JSON carries `assignedRoles` and `runs[]`.
- `kf runs [<f>] [--json]`: every run with its role, its runner and its place in the chain, such as `2/2`, newest first. A run that ends a chain before the last role while nothing else is running shows `chain stopped 1/2` with a warning underneath, and the JSON carries `chainBroken`. This is how you spot a broken chain, from a dead supervisor or a Ctrl+C, instead of assuming the stage finished.

Typing a runner name into `stages` gets a message that says so, rather than "unknown role":

```
Invalid project config: .kf/config.json — harness.stages.testing "gemini" is a runner,
not a role; declare a role in harness.roles that points at it
```
- `kf view [--json]`: `metrics.runs.byRole` as `{ runs, done, failed }`, and `metrics.runs.usage` broken down by role.

## Token cost

- The real work of reading code, changing it and running tests does not grow. It simply moves onto the assigned runner's quota.
- What does grow: every handover makes a worker re-read the skill, the artifacts and the relevant code, roughly 10 to 30 thousand tokens. **A role chain multiplies that by its length**: a two-role brainstorm pays for two handovers. Chain roles only when the two jobs are genuinely different.
- The repair loop costs another handover when the runner cannot resume.
- The main agent gets cheaper: it spends nothing while a worker runs, and only reads the tail of the log.
- Waste is held down: prompts carry paths rather than content, the chain stops the moment a role fails, a worker that prints no `STATUS` counts as unfinished, and nothing retries.
- Measurement: a runner with `usage: "json"` records tokens and cost into `runs[]`, and `kf view` totals them **by role**, so you can see which role is the expensive one.

## Limits

- The "do not move the stage" rule is a contract in the prompt, not something kf can enforce, because the worker has `kf` on its PATH. `runs[]` and `bypasses[]` are there to check against.
- Role chains within a stage are sequential. Parallelism exists only between planned tasks under `kf drive`. Stopping a chain midway leaves a half-done state: the first role wrote its file, the next never ran. `kf run` says so, `kf runs` marks it `chain stopped i/n`, and the stage's artifact gate is still what decides.
- Killing a process group uses `process.kill(-pid)`, which is POSIX. On Windows, kf cannot clean up a worker's children.
- Every read-modify-write of `.kfw.json` holds a per-item lock in `.works/.locks/<feature>.lock`; a lock whose pid is dead is taken over, a live one is waited on for 30 seconds. `kf doctor` reports dead locks.
- kf commits task results, so the repository's own git hooks and signing apply to those commits. A hook that waits for input, such as a GPG passphrase prompt, hangs until the run timeout and fails the task.
- A verify command that leaves untracked files behind does not block merges; one that modifies tracked files does, until they are committed or reverted.
- A worker log can contain whatever sensitive content the CLI printed. `.works/` is usually gitignored; keep it that way.
- There is no async bridge between agents, and `kf run --task` takes only a planned `TASK-###`, not ad-hoc work.

## Terms of use

kf only spawns each vendor's official CLI using the headless flags that vendor documents (`claude -p`, `codex exec`, `gemini -p`, `devin -p`, `opencode run`), under the account already logged in on the machine running it. kf **never** reads, stores or forwards any CLI's credentials or tokens, never calls a vendor API directly and never retries in bursts. Each user remains responsible for the terms of the plan they are on, covering commercial use, account sharing and rate limits. This document is not legal advice.

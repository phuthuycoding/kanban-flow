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

The `harness` block in `.kf/config.json`, which `kf init` seeds and `kf harness` displays:

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
      "start":  ["claude", "-p", "{prompt}", "--session-id", "{session}", "--permission-mode", "acceptEdits", "--output-format", "json"],
      "resume": ["claude", "-p", "{prompt}", "-r", "{session}", "--permission-mode", "acceptEdits", "--output-format", "json"],
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
| `skillsDir` | The runner's skills directory. Defaults follow `kf install`: `.claude/skills`, `.agents/skills`, `.gemini/skills`, `.opencode/skills`, and any unfamiliar name falls back to `.agents/skills` |
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

`kf run --role <name>` runs exactly one role from the chain. `--dry-run` prints the plan for the whole chain, one argv and prompt block per role. The timeout is 30 minutes by default (`--timeout <minutes>`, `0` for none); on expiry the whole process group is killed and the run is marked `timeout`. There is no automatic retry: a failed resume resets the session exactly once and starts fresh. A work item has at most one `running` run at a time.

With `--detach`, kf writes the chain plan, spawns a detached `kf run --supervise <id>` as the supervisor and returns immediately. The supervisor runs the whole chain and finds the folder again by work item name before writing results; when the folder is gone it writes `.works/harness/orphan-<id>.json`. `kf runs` reports `failed (supervisor lost)` when a record is still `running` but its pid is dead, and it never repairs the metadata on its own.

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
- Chains are always sequential, never parallel. Stopping midway leaves a half-done state: the first role wrote its file, the next never ran. `kf run` says so, `kf runs` marks it `chain stopped i/n`, and the stage's artifact gate is still what decides.
- Killing a process group uses `process.kill(-pid)`, which is POSIX. On Windows, kf cannot clean up a worker's children.
- `.kfw.json` is written both by the supervisor and by the main agent's `kf stage`. kf re-reads before writing and writes atomically, but there is no lock.
- A worker log can contain whatever sensitive content the CLI printed. `.works/` is usually gitignored; keep it that way.
- There is no async bridge yet, meaning nothing wakes the main agent once it is gone, and no `kf run --task` for ad-hoc work outside a stage.

## Terms of use

kf only spawns each vendor's official CLI using the headless flags that vendor documents (`claude -p`, `codex exec`, `gemini -p`, `devin -p`, `opencode run`), under the account already logged in on the machine running it. kf **never** reads, stores or forwards any CLI's credentials or tokens, never calls a vendor API directly and never retries in bursts. Each user remains responsible for the terms of the plan they are on, covering commercial use, account sharing and rate limits. This document is not legal advice.

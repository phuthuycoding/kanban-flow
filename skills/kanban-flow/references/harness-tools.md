# Harness tools — action → tool

The kanban skills describe work at the **action** level ("dispatch the reviewer", "append to the ledger") and this table binds each action to a concrete tool per runtime. When a runtime renames a tool, this file changes and the skills do not.

Two rules for skill authors:

- **Name the action in prose; name the tool only where a line must be checkable.** `Agent(code-reviewer)` in a transcript is auditable; "I reviewed the diff" is not. Keep those named lines exactly as the skill spells them.
- **Never invent a tool name.** If an action is missing here, add the row, then use it.

| Action | Claude Code | Codex | Gemini CLI / others |
| --- | --- | --- | --- |
| Dispatch a subagent (fresh context, returns a report) | `Agent` (`subagent_type`, `model`, `prompt`) | `spawn_agent` with the same-named agent, or a plain subagent with the brief pasted | a subagent tool when the CLI has one; otherwise do the step yourself in the same order and say so — **except the review seat**: a session never grades its own work (`kanban-review` step 5, `kanban-implement` § 3.5) |
| Dispatch a kanban agent by name (`code-reviewer`, `scout`, `spec-reviewer`, `developer`, `test-writer`, `automation-writer`) | `Agent` with `subagent_type: <name>` — definitions registered by `kf install` into `.claude/agents/` (project) or `~/.claude/agents/` (global); the bodies live at `<skills dir>/kanban-flow/agents/<name>.md` | the body at `<skills dir>/kanban-flow/agents/<name>.md` pasted as the subagent prompt | same |
| Invoke a kanban phase skill | `Skill` (`kanban-<phase>`) | `$kanban-<phase>` | read `<skills dir>/kanban-<phase>/SKILL.md` |
| Ledger of dispatched work | the file the skill names (`<item>/loop/progress.md`, `<item>/reviews/<id>/pack.md`) — not a todo tool: each todo call is an extra turn and does not survive the session | same file | same file |
| Ask the human to choose between options | `AskUserQuestion` | ask in plain text | ask in plain text |
| Read a file / search text / find files | `Read` / `Grep` / `Glob` | `cat` / `rg` / `find` | same |
| Edit or create a file | `Edit` / `Write` | `apply_patch` | the CLI's edit tool |
| Run a shell command | `Bash` | shell | shell |
| Run a bundled skill script | `Bash: bash <skill dir>/scripts/<name>` or `node …` — installs do not set the exec bit | same | same |
| Wait on a background process (a `kf drive`) | `Bash` with `run_in_background`, or poll `kf drive <f> --status` | poll in the foreground | poll in the foreground |
| Drive the pipeline's state | `Bash: kf …` — the CLI is the only writer of `.works/` state | same | same |

## Boundary

`kf` never calls any of these: it is harness-agnostic and spawns each vendor's official CLI headless (`claude -p`, `codex exec`, `gemini -p`, …) through `harness.runners`. The adapter layer is the skill text plus the agent definitions; `kf install` only puts them where each runtime looks.

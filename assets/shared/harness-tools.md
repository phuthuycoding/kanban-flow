# Harness tools — action → tool

The kanban skills describe work at the **action** level ("dispatch the reviewer", "append to the ledger") and this table binds each action to a concrete tool per runtime. When a runtime renames a tool, this file changes and the skills do not.

Two rules for skill authors:

- **Name the action in prose; name the tool only where a line must be checkable.** `Agent(kf:code-reviewer)` in a transcript is auditable; "I reviewed the diff" is not. Keep those named lines exactly as the skill spells them.
- **Never invent a tool name.** If an action is missing here, add the row, then use it.

| Action | Claude Code | Codex | Gemini CLI / others |
| --- | --- | --- | --- |
| Dispatch a subagent (fresh context, returns a report) | `Agent` (`subagent_type`, `model`, `prompt`) | `spawn_agent` with the same-named agent, or a plain subagent with the brief pasted | a subagent tool when the CLI has one; otherwise do the step yourself in the same order and say so — **except the review seat**: a session never grades its own work (`kf:review` step 5, `kf:implement` § 3.3) |
| Dispatch a kanban agent by name (`code-reviewer`, `scout`, `spec-reviewer`, `developer`, `test-writer`, `automation-writer`, `researcher`) | `Agent` with `subagent_type: kf:<name>` — definitions registered by the kf plugin (`kf install` runs the plugin install); the bodies live at `${CLAUDE_PLUGIN_ROOT}/assets/agents/<name>.md` | the body at `${CLAUDE_PLUGIN_ROOT}/assets/agents/<name>.md` pasted as the subagent prompt; copies for runtimes without the plugin live at `<skills dir>/kf-flow/agents/<name>.md` | same |
| Invoke a kanban phase skill | `Skill` (`kf:<phase>`) | `$kf-<phase>` | read `<skills dir>/kf-<phase>/SKILL.md` |
| Ledger of dispatched work | the file the skill names (`<item>/loop/progress.md`, `<item>/reviews/<id>/pack.md`) — not a todo tool: each todo call is an extra turn and does not survive the session | same file | same file |
| Ask the human to choose between options | `AskUserQuestion` | ask in plain text | ask in plain text |
| Read a file / search text / find files | `Read` / `Grep` / `Glob` | `cat` / `rg` / `find` | same |
| Edit or create a file | `Edit` / `Write` | `apply_patch` | the CLI's edit tool |
| Run a shell command | `Bash` | shell | shell |
| Run a bundled skill script | `Bash: bash ${CLAUDE_PLUGIN_ROOT}/assets/skills/<skill>/scripts/<name>` or `node …` — installs do not set the exec bit | `bash <skill dir>/scripts/<name>` or `node …` | same |
| Resume a dispatched subagent with new input (a fix round, supplied context) | `SendMessage` to that agent | a fresh subagent carrying the brief path, the report path and the findings | same |
| Run a long command in the background (`kf verify`, a full suite, the CI watcher) | `Bash` with `run_in_background` | poll in the foreground | poll in the foreground |
| Drive the pipeline's state | `Bash: kf …` — the CLI is the only writer of `.works/` state | same | same |

## Model tiers

The skills name Claude Code's model aliases. Each alias stands for a tier; on another runtime, pick that runtime's model for the tier and write its real name wherever the skill records a model (`model=<name>` in the ledger, the `## Reviewer` section of the review report).

| Tier | Claude Code | Seats | Codex, Gemini CLI and others |
| --- | --- | --- | --- |
| standard | `sonnet` | `test-writer`, `developer`, `automation-writer`, `scout`, `researcher` | the runtime's everyday coding model |
| strong | `opus` | `code-reviewer` (per-task review, re-review, every whole-branch tier); a writer seat stepped up one tier | the strongest model the runtime offers, at its default reasoning effort |
| top | `fable` | `spec-reviewer`; `code-reviewer` in the whole-branch review of a `CRITICAL=1` item | the same strongest model at its highest reasoning effort |

- **A review seat never runs on a weaker tier than the seat whose work it grades.** When a runtime offers one model only, say so in the report: the review is then not independent in capability, only in context.
- **No `fable` on this account or runtime:** `top` falls back to `opus`; record `model=opus` and say `top tier unavailable` in the report. Never drop a review seat below `opus` to save cost.
- The dispatch's `model` wins over an agent's frontmatter `model:`, which is only the floor a dispatch that names none lands on. A runtime that does not read the frontmatter key ignores it.

## Boundary

`kf` never calls any of these: it is harness-agnostic and spawns no agent session. The adapter layer is the skill text plus the agent definitions; `kf install` only puts them where each runtime looks.

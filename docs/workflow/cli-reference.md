# CLI reference

The binary is `kf`. Every command *except* `kf init` looks for `.works/` from the current directory upwards to the project root, so you can run it from the root or from any subdirectory.

`kf init` is the exception: it resolves its path argument against the current directory and does not search upwards. Running it inside a subdirectory of a project that is already initialised creates a second `.works/`, `.kf/` and skills set there rather than finding the existing one.

## Setting up and creating work

| Command | What it does |
| --- | --- |
| `kf init [path]` | Onboarding. On a TTY it asks for the context, the stack, the reviewer, the agents, the gitignore entry and whether to seed a demo feature; without a TTY it takes the defaults. Creates `.works/`, `docs/{requirement,use-cases,testplan}` and `.kf`, installs the project-scope skills, and seeds `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists. |
| `kf init --defaults` | Non-interactive onboarding on default values, for agents and scripts. |
| `kf init --minimal` | Skips the questions, not the scaffolding. Creates `.works/`, the docs roots, the skills, `.kf/config.json` with the schema and the runner presets, the empty `.kf/{templates,hooks,review/rules}` directories, and `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists. What it does *not* do is copy template, hook or review-rule files into those directories — the full path does that. With `--context` on a genuinely new project it declares that context, exactly as the full path does. |
| `kf new <feature> [--context <ctx>] [--goal <text>] [--type feature\|bug]` | Creates a feature or bug in `brainstorm`; a bug routes through `kanban-bug`. Feature and context names must match `[a-z0-9][a-z0-9_-]*` **case-insensitively**, so `LoginFlow` is accepted. Context names are then compared case-insensitively against the declared list, which refuses `Auth` beside `auth`. When the project declares contexts, an undeclared one is refused with the nearest declared name. |
| `kf list [--json]` | Lists every work item with its kind and state. |
| `kf doctor [--json]` | Diagnoses the project rather than a work item: stage directories, a config that parses, work item metadata that can be read, skills still installed, and config fields that no longer mean what they say. Read-only, keeps going after the first problem, and exits 1 when anything is at ERROR. Work items that are not valid are counted but never change the verdict — that is the normal state of a pipeline in motion. |
| `kf contexts [--json]` | Lists the declared contexts with a work-item count each, marks any context in use but not declared, and prints a survey brief when none are declared. Read-only. See [contexts](#contexts). |
| `kf show <feature> [--json]` | Shows a work item's requirement or bug report. |
| `kf view [--json]` | Workflow statistics in the terminal; the JSON carries metrics, charts and the per-stage detail. |
| `kf dashboard [--port <1-65535>]` | KPI and chart dashboard with context and kind filters, on port `8787` by default. See [how each number is computed](dashboard.md). |

## Driving the workflow

| Command | What it does |
| --- | --- |
| `kf status --change <feature> [--json]` | One work item's state, including how many gate or hook bypasses have been recorded, and any blocking findings the validator raises. The artifact checklist only says which files exist and are filled; the blocking list is what `kf approve` or `kf stage` would refuse on, so the two cannot disagree. The human approval gate is reported by the `Approval:` field rather than counted as a blocker. |
| `kf status --all [--json]` | Every work item, `backlog` and `dones` included. |
| `kf instruct <artifact\|use-case> [--change <feature>] [--id UC-###] [--json]` | Renders an artifact template; `use-case` produces the instruction for exactly one `use-cases/UC-###.md`. |
| `kf templates [--json]` | Lists the templates currently resolved and where each came from. |
| `kf validate --change <feature> [--strict] [--json]` | Checks artifacts, placeholders, secret-like content, traceability and the gates. Exits `1` on failure. |
| `kf validate --all [--strict] [--json]` | Validates every work item. |
| `kf approve <feature> [--by <name>]` | The human gate on the execution contract in planning; records the approver, the moment and the contract hash. |
| `kf stage <feature> <next-stage> [--force] [--skip-hooks]` | Performs a legal transition and runs the destination state's hook. Planning may go to `backlog` or to `implementation`; `dones` is reached through archive. |
| `kf cancel <feature> --reason "<why>" [--by <name>] [--purge-docs] [--force] [--skip-hooks]` | Stops a work item for good and moves it to `.works/cancelled/`, recording `cancellation { at, by, reason, fromStage }`. Refuses while a run is live unless `--force`. An item in `dones` has its canonical docs listed, and only `--purge-docs` deletes them, asking first on a TTY; `--force` answers that question in advance, and without a TTY it is the only way through. Reopen with `kf stage <feature> <fromStage>`. |
| `kf archive <feature> [--force] [--skip-specs] [--skip-hooks]` | Archives from review into dones and updates the metadata; a feature receives the canonical copies, a bug keeps its existing docs. |
| `kf rules [--stack <id> ...] [--list] [--force]` | Copies the stack best-practice review rules into `.kf/review/rules/`. Detects the stacks automatically, installing several packs in a monorepo; `--list` shows the packs and `--force` overwrites files you have edited. |
| `kf autoconfig` | Prints a briefing for an agent on stdout: the project context, a config checklist of what is done and what is missing with the command to fix it, the effective review rules and the workflow guide, so the agent can configure the project itself. |
| `kf run <feature> [--stage <s>] [--role <r>] [--fresh] [--detach] [--timeout <minutes>] [--dry-run]` | Runs, in order, the role chain that `harness.stages` assigns to the current stage. Records a `runs[]` entry per role and resumes the session per work item and role. A role that does not finish `DONE` stops the chain. `--detach` returns immediately and leaves a supervisor to finish. Exits 1 when the chain does not complete. See [harness](harness.md). |
| `kf runs [<feature>] [--json]` | Worker run history with role, runner, stage, mode, status and STATUS line, newest first. |
| `kf harness [--json]` | The harness in effect: the main role, stage to role chain, role to runner with its brief and output, and which runner CLIs are on PATH. |

`--force` deliberately skips a gate; when re-archiving a work item in `dones` it also allows the archive snapshot to overwrite canonical docs that were edited. `--skip-hooks` skips the destination phase's hook. `--skip-specs` touches no canonical doc during archive. Whenever `--force` or `--skip-hooks` actually skips something, the CLI writes a record into `.kfw.json` under `bypasses[]` and says so in its output. See [gates](gates.md#force-and-recovery).

## Skill installation

Skills always live at **project scope** (`{root}/.claude/skills`, `{root}/.agents/skills` and so on). The `kf` CLI is the only thing installed globally, through `npm link`. `kf init` installs the skills during setup; `kf install` and `kf uninstall` work on the project root resolved from the nearest `.works/` above the working directory. Neither writes anything into `~/`.

| Command | What it does |
| --- | --- |
| `kf install [--agent <id> ...]` | Installs the 8 skills into each agent's own directory, defaulting to `claude`. Must run inside a kanban project, which means a `.works/` exists; run `kf init` first if it does not. The directory is `.claude/skills`, `.gemini/skills`, `.kiro/skills`, `.cursor/skills`, `.opencode/skills` — and `.agents/skills` for `codex`, which follows the open standard rather than its own name. An unknown agent also falls back to `.agents/skills`. |
| `kf uninstall [--agent <id> ...] [--purge] [--force]` | Removes exactly the 8 skills that kanban-flow manages, leaving every other skill alone. `--purge` also deletes `.works/`, `.kf/` and `docs/{requirement,use-cases,testplan}/`, asking first on a TTY and requiring `--force` without one. |

Uninstall only removes skills. To take the CLI off PATH: `npm rm -g kanban-flow`.

## Error conventions

- Success exits `0`. Bad input, a failed gate, a failed hook, a missing work item or an exception exits `1`. The readable report goes to **stdout**; stderr carries only a short reason line. A CI step that keeps stderr and discards stdout captures the reason but none of the detail.
- The CLI never runs a migration, updates a database, deploys or publishes on its own.
- Hooks resolve in order: the project `.kf/hooks`, then the user's `~/.kf/hooks`, then the package hooks. The environment handed to a hook carries `KFW_FEATURE`, `KFW_CONTEXT`, `KFW_FROM_STAGE`, `KFW_TO_STAGE`, `KFW_FEATURE_DIR`, `KFW_WORK_ROOT` and `KFW_APPROVAL`.

## Contexts

A context groups work items and their canonical docs by business domain: `docs/requirement/{context}/`, and the same under `use-cases` and `testplan`.

A project may declare which contexts exist, in `.kf/config.json`:

```json
"contexts": ["auth", "billing", "catalog"]
```

Two things follow from that list, and nothing follows without it:

- **The first entry is the default context** for `kf new` without `--context`. There is no separate default field to keep in step with the list. `defaultContext` is still read for projects created before `contexts` existed, and is ignored once a list is declared.
- **`kf new` refuses a context that is not on the list**, naming the nearest declared spelling. A name differing only in case is refused too, because accepting `Auth` beside `auth` is how a second docs tree appears on a case-sensitive filesystem.

A project with no `contexts` key is unrestricted. Re-running `kf init` there does not add the key, and neither does a project that has work items but no config file yet: a project counts as existing if it has either. `kf init` writes the list only for a genuinely new project, or when you answer its question on a terminal. The one behaviour that did change for an unrestricted project: `kf new` now reads the config on every path, so a malformed config fails loudly instead of only when `--context` was omitted.

`kf contexts` reports each in-use context with the spelling found on disk, not a lowercased one. Where an undeclared spelling differs from a declared one only by case, it says so instead of telling you to add it, because the config reader refuses that repeat: rename the work items, or change the declared entry. It never writes anything. When no list is declared it prints a brief for an agent to survey the repo and propose one, which a human then confirms and writes.

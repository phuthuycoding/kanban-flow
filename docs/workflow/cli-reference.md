# CLI reference

The binary is `kf`. Every command *except* `kf init` looks for `.works/` from the current directory upwards to the project root, so you can run it from the root or from any subdirectory.

`kf init` is the exception: it resolves its path argument against the current directory and does not search upwards. Running it inside a subdirectory of a project that is already initialised creates a second `.works/`, `.kf/` and skills set there rather than finding the existing one.

## Setting up and creating work

| Command | What it does |
| --- | --- |
| `kf init [path]` | Onboarding. On a TTY it offers Quick setup (the detected defaults) or Customize — which asks for the contexts (comma separated, first is the default, empty stays unrestricted), the stacks, the reviewer, the GitHub repository (detected from `origin`, `none` leaves the project unlinked), the agents, whether to install the GitHub sync hook pack (only when a repository is linked), the `.gitignore` entry and whether to seed a demo feature; without a TTY it takes the defaults. Creates `.works/`, `docs/{requirement,use-cases,testplan}` and `.kf`, installs the project-scope skills, and seeds `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists. See [agent onboarding](autoconfig.md) for the human walkthrough. |
| `kf init --defaults` | Non-interactive onboarding on default values, for agents and scripts. |
| `kf init --minimal` | Skips the questions, not the scaffolding. Creates `.works/`, the docs roots, the skills, `.kf/config.json` with the schema and the runner presets, the empty `.kf/{templates,hooks,review/rules}` directories, and `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists. What it does *not* do is copy template, hook or review-rule files into those directories — the full path does that. With `--context` on a genuinely new project it declares that context, exactly as the full path does. |
| `kf new <feature> [--context <ctx>] [--goal <text>] [--type feature\|bug]` | Creates a feature or bug in `brainstorm`; a bug routes through `kanban-bug`. Feature and context names must match `[a-z0-9][a-z0-9_-]*` **case-insensitively**, so `LoginFlow` is accepted. Context names are then compared case-insensitively against the declared list, which refuses `Auth` beside `auth`. When the project declares contexts, an undeclared one is refused with the nearest declared name. |
| `kf list [--json]` | Lists every work item with its kind and state. |
| `kf doctor [--json]` | Diagnoses the project rather than a work item: stage directories, a config that parses, work item metadata that can be read, skills still installed, config fields that no longer mean what they say, and a `repository` link missing while the origin remote is a GitHub repo. When `worktree.enabled` it also probes the domain infra: `*.<domainZone>` resolving to the proxy listen address, the proxy listening, and the routes file being readable — all WARNING-level, with `sudo kf worktree setup` as the fix. Read-only, keeps going after the first problem, and exits 1 when anything is at ERROR. Work items that are not valid are counted but never change the verdict — that is the normal state of a pipeline in motion. |
| `kf doctor --fix` | Applies the repairs that need no human decision, then reports the after-state: recreates missing `.works/` stage dirs, writes config defaults when the file is absent, removes legacy fields that are already ignored (`stack` beside `stacks`, `defaultContext` beside `contexts`), fills `repository` from the GitHub origin remote, and reinstalls missing skills. Broken JSON and unreadable `.kfw.json` stay broken — fixing them is a judgment call. `--json` adds a `fixed` list to the report. |
| `kf contexts [--json]` | Lists the declared contexts with a work-item count each, marks any context in use but not declared, and prints a survey brief when none are declared. Read-only. See [contexts](#contexts). |
| `kf show <feature> [--json]` | Shows a work item's requirement or bug report. |
| `kf view [--json]` | Workflow statistics in the terminal; the JSON carries metrics, charts and the per-stage detail. |
| `kf dashboard [--port <1-65535>]` | KPI and chart dashboard with context and kind filters, on port `8787` by default. See [how each number is computed](dashboard.md). |

## Driving the workflow

| Command | What it does |
| --- | --- |
| `kf status --change <feature> [--json]` | One work item's state, including how many gate or hook bypasses have been recorded, and any blocking findings the validator raises. The artifact checklist only says which files exist and are filled; the blocking list is what `kf approve` or `kf stage` would refuse on, so the two cannot disagree. The human approval gate is reported by the `Approval:` field rather than counted as a blocker. When the item has a worktree, its path, branch, domain and port are shown as a `Worktree:`/`Domain:` block and in JSON under `worktree`. |
| `kf status --all [--json]` | Every work item, `backlog` and `dones` included. |
| `kf instruct <artifact\|use-case> [--change <feature>] [--id UC-###] [--json]` | Renders an artifact template; `use-case` produces the instruction for exactly one file under `use-cases/`, named after the id — `--id UC-001-create-task` writes `use-cases/UC-001-create-task.md`. |
| `kf templates [--json]` | Lists the templates currently resolved and where each came from. |
| `kf validate --change <feature> [--strict] [--json]` | Checks artifacts, placeholders, secret-like content, traceability and the gates. When `worktree.enabled` and the domain infra is not set up it appends a `worktree_infra_missing` WARNING (only a blocker under `--strict`). Exits `1` on failure. |
| `kf validate --all [--strict] [--json]` | Validates every work item. |
| `kf approve <feature> [--by <name>]` | The human gate on the execution contract in planning; records the approver, the moment and the contract hash. |
| `kf stage <feature> <next-stage> [--force] [--skip-hooks]` | Performs a legal transition and runs the destination state's hook. Planning may go to `backlog` or to `implementation`; `dones` is reached through archive. Entering `implementation` with `worktree.enabled` (the default) provisions the item's git worktree and route first — the transition fails closed when that cannot happen, so an item never implements on the main checkout by accident. |
| `kf cancel <feature> --reason "<why>" [--by <name>] [--purge-docs] [--force] [--skip-hooks]` | Stops a work item for good and moves it to `.works/cancelled/`, recording `cancellation { at, by, reason, fromStage }`. Refuses while a run is live unless `--force`. An item in `dones` has its canonical docs listed, and only `--purge-docs` deletes them, asking first on a TTY; `--force` answers that question in advance, and without a TTY it is the only way through. When the item has a worktree it is torn down first — the `kf/<feature>` branch is kept, and a dirty worktree refuses the cancel. Reopen with `kf stage <feature> <fromStage>`. |
| `kf archive <feature> [--force] [--skip-specs] [--skip-hooks]` | Archives from review into dones and updates the metadata; a feature receives the canonical copies, a bug keeps its existing docs. Run on an item already in `dones` it refreshes the canonical copies — refusing to overwrite docs changed since the snapshot unless `--force` (recorded as a bypass) — and runs no hook. A worktree is torn down before the move: the branch is kept, a dirty worktree refuses the archive (`kf worktree remove --force` discards it deliberately), and commits not merged into the main checkout's HEAD are called out so the human can merge or open the PR — kf never merges or deletes branches itself. |
| `kf rules [--stack <id> ...] [--list] [--force]` | Copies the stack best-practice review rules into `.kf/review/rules/`. Detects the stacks automatically, installing several packs in a monorepo; `--list` shows the packs and `--force` overwrites files you have edited. |
| `kf autoconfig` | Prints a briefing for an agent on stdout: the project context, a config checklist of what is done and what is missing with the command to fix it, the effective review rules and the workflow guide, so the agent can configure the project itself. See [agent onboarding](autoconfig.md). |
| `kf run <feature> [--stage <s>] [--role <r>] [--fresh] [--detach] [--timeout <minutes>] [--dry-run]` | Runs, in order, the role chain that `harness.stages` assigns to the current stage. Records a `runs[]` entry per role and resumes the session per work item and role. A role that does not finish `DONE` stops the chain. `--detach` returns immediately and leaves a supervisor to finish. Exits 1 when the chain does not complete. See [harness](harness.md). |
| `kf runs [<feature>] [--json]` | Worker run history with role, runner, stage, mode, status and STATUS line, newest first. |
| `kf harness [--json]` | The harness in effect: the main role, stage to role chain, role to runner with its brief and output, and which runner CLIs are on PATH. |

`--force` deliberately skips a gate; when re-archiving a work item in `dones` it also allows the archive snapshot to overwrite canonical docs that were edited. `--skip-hooks` skips the destination phase's hook. `--skip-specs` touches no canonical doc during archive. Whenever `--force` or `--skip-hooks` actually skips something, the CLI writes a record into `.kfw.json` under `bypasses[]` and says so in its output. See [gates](gates.md#force-and-recovery).

## Worktrees and local domains

Each work item in `implementation` gets its own git worktree on branch `kf/<feature>` and a domain `<feature>.<baseDomain>` (default `<feature>.<repo-slug>.test`) routed to a per-item port. `kf` works from inside a worktree — `.works/` is gitignored, so the project root is resolved through `git rev-parse --git-common-dir`. Routing is machine-global: one `kf proxy serve` process reads a shared routes file and forwards `Host` to `127.0.0.1:<port>`, tunnelling websocket upgrades for dev-server HMR. Hosts with no route go to `fallbackUpstream` when configured, else a `502` listing known routes. Setup is a one-time, sudo-required onboarding.

| Command | What it does |
| --- | --- |
| `kf worktree create <feature>` | Creates `<baseDir>/<feature>` on branch `kf/<feature>` from the current HEAD, allocates the first free port from `portBase` (registry ∪ routes file) and registers the route + `.kfw.json` entry. Idempotent — re-running returns the existing registration; a deleted worktree is rebuilt from its branch; a branch that exists but is not managed by the item refuses to be adopted silently. |
| `kf worktree remove <feature> [--force]` | Removes the worktree and its route; the branch is kept. Refuses while dirty — uncommitted or untracked content — unless `--force` deliberately discards it. Warns when the branch carries commits not merged into HEAD. |
| `kf worktree list [--json]` | Every registered worktree (item, stage, path, dirty state, domain, port) plus orphans: registry entries whose worktree is missing, `kf/*` git worktrees with no `.works` item, and stale routes. |
| `kf worktree setup [--print]` | One-time machine onboarding: a dnsmasq `address=/.<zone>/<listen>` rule, `/etc/resolver/<zone>` when absent, and a LaunchDaemon running `kf proxy serve`. `--print` shows every file and command without touching the machine; a foreign rule routing the same zone elsewhere (e.g. a leftover Valet one) is a hard conflict — it refuses rather than overwriting. |
| `kf proxy serve [--listen <h:p>] [--routes <file>] [--fallback <h:p>\|off]` | Runs the proxy in the foreground — launchd's `KeepAlive` is the supervisor. Flags override `~/.config/kanban-flow/config.json` (`proxyListen`, `domainZone`, `fallbackUpstream`, `routesFile`). |

Project-side defaults live in `.kf/config.json` under `worktree` — `enabled` (default `true`; set `false` on non-git projects), `baseDir` (sibling `<repo>-worktrees/`), `branchPrefix`, `baseDomain`, `portBase`, `routesFile`. Everything still works without the domain infra: the direct `http://127.0.0.1:<port>` URL is printed wherever the domain is, and `validate`/`doctor` point at `kf worktree setup` until it is done.

Two project hooks finish the job the domain starts: `.kf/hooks/worktree-create.sh` runs inside a freshly created worktree (`install dependencies`, `cp .env.example .env`, boot a dev server on `$KFW_WORKTREE_PORT`) and a failure rolls the worktree back and fails the transition; `.kf/hooks/worktree-remove.sh` runs inside the worktree right before teardown (stop dev servers, compose down) and only warns on failure. Both receive `KFW_WORKTREE_{PATH,PORT,DOMAIN,BRANCH}` on top of the standard hook environment — see [phase hooks](autoconfig.md#phase-hooks).

## Skill installation

Skills always live at **project scope** (`{root}/.claude/skills`, `{root}/.agents/skills` and so on). The `kf` CLI is the only thing installed globally, through `npm link`. `kf init` installs the skills during setup; `kf install` and `kf uninstall` work on the project root resolved from the nearest `.works/` above the working directory. Neither writes anything into `~/`.

| Command | What it does |
| --- | --- |
| `kf install [--agent <id> ...]` | Installs the 8 skills into each agent's own directory, defaulting to `claude`. Must run inside a kanban project, which means a `.works/` exists; run `kf init` first if it does not. The directory is `.claude/skills`, `.gemini/skills`, `.kiro/skills`, `.cursor/skills`, `.opencode/skills` — and `.agents/skills` for `codex`, which follows the open standard rather than its own name. An unknown agent also falls back to `.agents/skills`. |
| `kf uninstall [--agent <id> ...] [--purge] [--force]` | Removes exactly the 8 skills that kanban-flow manages, leaving every other skill alone. `--purge` also deletes `.works/`, `.kf/` and `docs/{requirement,use-cases,testplan}/`, asking first on a TTY and requiring `--force` without one. |

Uninstall only removes skills. To take the CLI off PATH: `npm rm -g @phuthuycoding/kanban-flow`.

## Error conventions

- Success exits `0`. Bad input, a failed gate, a failed hook, a missing work item or an exception exits `1`. The readable report goes to **stdout**; stderr carries only a short reason line. A CI step that keeps stderr and discards stdout captures the reason but none of the detail.
- The CLI never runs a migration, updates a database, deploys or publishes on its own.
- Hooks resolve in order: the project `.kf/hooks`, then the user's `~/.kf/hooks`, then the package hooks. The environment handed to a hook carries `KFW_FEATURE`, `KFW_CONTEXT`, `KFW_FROM_STAGE`, `KFW_TO_STAGE`, `KFW_FEATURE_DIR`, `KFW_WORK_ROOT`, `KFW_APPROVAL` and `KFW_REPOSITORY`. See [phase hooks](autoconfig.md#phase-hooks).

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

## GitHub issues

A project may link itself to a GitHub repository in `.kf/config.json`:

```json
"repository": "owner/name"
```

Any repo reference normalizes to `owner/name` — `https://github.com/owner/repo`, `git@github.com:owner/repo.git` and the short form all write the same value. `kf init` detects it from the `origin` remote and asks once on a TTY. The value is handed to every stage hook as `KFW_REPOSITORY`, so a hook that syncs work items to GitHub never hardcodes the repo.

| Command | What it does |
| --- | --- |
| `kf issues [--state open\|closed\|all] [--limit <n>] [--json]` | Lists issues on the configured repository, via `gh`. |
| `kf issues view <n>` (or `kf issues <n>`) | Shows one issue. |
| `kf issues create <feature> [--title <t>] [--label <l> ...]` | Creates an issue titled by `--title`, else the work item's `--goal`, else the slug — the filled requirement file becomes the body, a stub otherwise; `bug` items get the `bug` label, everything else `enhancement`. The issue URL is recorded as `issue` in the item's `.kfw.json`, so `kf status` shows it and a hook can read it. Refuses when the item already links to an issue. |
| `kf issues link <feature> <n\|url>` | Records an existing issue on the work item without creating anything. |
| `kf issues sync <feature>` | Replaces the linked issue's body with the item's filled requirement (frontmatter stripped, kf footer appended). Refuses when there is no link or no filled spec — this is the primitive the `planning` sync hook calls. |

`gh` must be installed and authenticated for all of these. Nothing talks to GitHub without the field: a project with no `repository` keeps its issues local, and hooks read an empty `KFW_REPOSITORY`.

### The hook pack and the project board

`kf init` offers to install a generic sync pack into `.kf/hooks/` when a repository is linked — the same flow monitoring hand-built: an issue on `kf new`, the requirement synced at planning, assignment and reopen at implementation, close-not-planned at cancel, and a gate at archive that refuses while the issue has unchecked acceptance criteria. The pack no-ops without `KFW_REPOSITORY`, fails open on GitHub outages, and fails closed on unreadable `.kfw.json`.

A `project` block in `.kf/config.json` additionally mirrors stage moves to a GitHub Projects board:

```json
"project": {
  "owner": "phuthuycoding",
  "number": 3,
  "statusMap": { "brainstorm": "Plan/Brainstorming", "dones": "Done" },
  "acGate": true
}
```

`statusMap` names the board's Status options per kf stage — names, never IDs; the pack resolves them per run so a recreated board keeps working. `acGate: false` skips the archive gate. Hooks see these as `KFW_PROJECT_OWNER`, `KFW_PROJECT_NUMBER`, `KFW_PROJECT_AC_GATE` and `KFW_PROJECT_STATUS_<STAGE>`. Board sync needs `gh` with the `project` scope (`gh auth refresh -s project`); `kf doctor` warns when it is missing, and `kf doctor --fix` restores deleted pack files without ever overwriting a hook the project edited.

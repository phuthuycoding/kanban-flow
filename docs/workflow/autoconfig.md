# Agent onboarding and `kf autoconfig`

kanban-flow is driven by an agent, so setting a project up means teaching the agent, not only creating directories. Three pieces do that:

- `kf init` installs the eight kanban skills into the agent's project-level skills dir (`--agent` picks which, `claude` is the default; several agents also read each other's directories, which `kf install` reports) and seeds `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists.
- The seeded `AGENTS.md` tells the agent the build, test and lint commands and the kanban conventions: the two human gates, `.works/` discipline, the `--force` policy. It is a starting point — edit it, because the agent reads it on every session.
- `kf autoconfig` prints the briefing described below. Run it and hand the output to the agent — or tell the agent to run it, because it can work through the checklist itself.

## What the briefing contains

Four sections, in order:

1. **Project context** — the resolved root, the stacks (configured in `.kf/config.json`, or detected), a one-line config summary (default context, reviewer, agents) and which agents already have the skills at project scope.
2. **Setup checklist** — every setup item, marked done or missing. Each missing item carries the command that fixes it.
3. **Review rules to enforce** — the full text of the effective review rules, each labelled with its source. The agent adopts them as coding conventions *now*, not only when the review phase reads them.
4. **Workflow guide** — the pipeline, the two human gates, the commands the agent drives, the loop semantics and the `--force` policy. This section is generated from the registered CLI help strings, so it cannot drift from the parser.

## The checklist, item by item

| Check | Done means | Fix when missing |
| --- | --- | --- |
| Project config | `.kf/config.json` exists | `kf init --defaults` |
| Skills per configured agent | All 8 `SKILL.md` files in the agent's skills dir, for each id in `config.agents` (or `claude` when unset) | `kf install --agent <id>` |
| Base review rules | `general.md`, `security.md`, `performance.md` in `.kf/review/rules/` | `kf init --defaults` (seeds templates, hooks dir and rules) |
| Stack rule packs | A `<stack>.md` in `.kf/review/rules/` for every stack — `config.stacks` when set, else detected | `kf rules --stack <id>` (`kf rules --list` shows packs) |
| `.works/` ignored | `.gitignore` lists `.works/` — only checked when `.git` exists | `echo '.works/' >> .gitignore` |
| Agent file | `AGENTS.md` or `CLAUDE.md` at the root | write one: commands plus conventions |
| Declared contexts | `contexts` in `.kf/config.json` | optional — `kf contexts` prints a survey brief for an agent to propose a list, a human confirms it. Without a list, `kf new` accepts any context |
| Harness | a `harness` block in `.kf/config.json` | optional — `kf init --defaults` seeds the runner presets; with no stages assigned the harness stays out of the way |
| Phase hooks | at least one file other than `.gitkeep` in `.kf/hooks/` | optional — see below |

The checklist reports the current state; it changes nothing itself. Read it as a diff between the project as it is and the project the pipeline expects.

## Phase hooks

A file named `<stage>.sh` under a hooks directory runs whenever a transition is about to enter that stage: `kf stage` runs the destination's hook, `kf archive` runs `dones.sh`, `kf cancel` runs `cancelled.sh`, and `kf new` runs `brainstorm.sh` — deleting the work item it just created when the hook fails. A hook that exits non-zero refuses the transition and prints its output. On `kf stage`, `kf archive` and `kf cancel` a `--skip-hooks` bypass is available and is recorded in `.kfw.json` like any other; `kf new` has no bypass — a failing brainstorm hook simply refuses to create the item.

Resolution order is project `.kf/hooks/`, then the user's `~/.kf/hooks/`, then the package's hooks — the first `<stage>.sh` found wins, so a project hook overrides a user-wide one. The hook runs under `bash` with the work item's directory as its working directory and a 120-second timeout, and receives the transition as environment variables:

| Variable | Value |
| --- | --- |
| `KFW_FEATURE` | Work item name |
| `KFW_CONTEXT` | Its context, empty when none |
| `KFW_FEATURE_DIR` | The work item's folder |
| `KFW_WORK_ROOT` | The project root |
| `KFW_FROM_STAGE` | The stage being left, empty on `kf new` |
| `KFW_TO_STAGE` | The stage being entered |
| `KFW_APPROVAL` | `pending` or `approved` |

```bash
#!/usr/bin/env bash
# .kf/hooks/testing.sh — refuse to enter testing while the build is red
npm run build || { echo "build fails; fix before testing"; exit 1; }
```

Hooks are the project's own gates: anything the built-in gates do not check — a lint run, a migration check, a required label — belongs here rather than in a prompt.

## `kf autoconfig` against `kf doctor`

Both diagnose the project rather than a work item, and both are read-only. The split is the question asked: `autoconfig` asks *what setup step is missing* and answers with a checklist plus fix commands, written for an agent to consume; `doctor` asks *what is broken* and answers with a health report that exits `1` on an ERROR. Run `autoconfig` once at setup and again after changing `.kf/config.json`, `kf rules` or the hooks; run `doctor` when something stops working.

# Agent onboarding and `kf autoconfig`

kanban-flow is driven by an agent, so setting a project up means teaching the agent, not only creating directories. Three pieces do that:

- `kf init` installs the eight kanban skills into the agent's project-level skills dir (`--agent` picks which, `claude` is the default; several agents also read each other's directories, which `kf install` reports) and seeds `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists.
- The seeded `AGENTS.md` tells the agent the build, test and lint commands and the kanban conventions: the two human gates, `.works/` discipline, the `--force` policy. It is a starting point — edit it, because the agent reads it on every session.
- `kf autoconfig` prints the briefing described below. Run it and hand the output to the agent — or tell the agent to run it, because it can work through the checklist itself.

## Onboarding for a human: `kf init`

`kf init` is the human's way through the same setup. On a terminal it opens with a
two-option menu — **Quick setup** takes the detected defaults, **Customize** asks
each question in turn:

- **Contexts** — comma separated; the first entry is the default, an empty answer keeps the project unrestricted.
- **Stacks** — confirms the detected list, or asks for one when nothing was detected.
- **Default reviewer** — the name `kf approve` records; defaults to the git user.
- **GitHub repository** — `owner/name` or a URL for `kf issues` and the `KFW_REPOSITORY` hook variable; defaults to the detected `origin` remote, and `none` leaves the project unlinked.
- **Agents** — which agent CLIs get the eight skills installed.
- **`.gitignore`** — whether to add `.works/`; asked only when `.git` exists and the entry is missing.
- **Demo feature** — whether to seed one to show the structure.

Every question has a default, so Enter accepts it. With no TTY the prompts are
skipped and the output says the defaults were used. `kf init --defaults` takes
the defaults even on a terminal — that is the agent's path — and `kf init
--minimal` scaffolds `.works/` and `.kf/` without copying the template, hook and
review-rule seeds, for a project that wants only the state machine.

## What the briefing contains

Four sections, in order:

1. **Project context** — the resolved root, the stacks (configured in `.kf/config.json`, or detected), a one-line config summary (default context, reviewer, agents) and which agents already have the skills at project scope.
2. **Setup checklist** — every setup item, marked done or missing. Each missing item carries the command that fixes it.
3. **Review rules to enforce** — the full text of the effective review rules, each labelled with its source. The agent adopts them as coding conventions *now*, not only when the review phase reads them.
4. **Workflow guide** — the pipeline, the two human gates and a reminder that every transition is additionally gated on artifacts and report status (`kf validate` lists what blocks the next move; the full contract lives in [gates](gates.md)). It ends with the loop semantics, the `--force` policy and the commands the agent drives — the command list is generated from the registered CLI help strings, so it cannot drift from the parser.

## The checklist, item by item

| Check | Done means | Fix when missing |
| --- | --- | --- |
| Project config | `.kf/config.json` exists | `kf init --defaults` (or `kf init` on a terminal, to answer the onboarding questions) |
| Skills per configured agent | All 8 `SKILL.md` files in the agent's skills dir, for each id in `config.agents` (or `claude` when unset) | `kf install --agent <id>` |
| Base review rules | `general.md`, `security.md`, `performance.md` in `.kf/review/rules/` | `kf init --defaults` (seeds templates, hooks dir and rules) |
| Stack rule packs | A `<stack>.md` in `.kf/review/rules/` for every stack — `config.stacks` when set, else detected | `kf rules --stack <id>` (`kf rules --list` shows packs) |
| `.works/` ignored | `.gitignore` lists `.works/` — only checked when `.git` exists | `echo '.works/' >> .gitignore` |
| Agent file | `AGENTS.md` or `CLAUDE.md` at the root | write one: commands plus conventions |
| Declared contexts | `contexts` in `.kf/config.json` | optional — `kf contexts` prints a survey brief for an agent to propose a list, a human confirms it. Without a list, `kf new` accepts any context |
| Harness | a `harness` block in `.kf/config.json` | optional — `kf init --defaults` seeds the runner presets; with no stages assigned the harness stays out of the way |
| Worktree domain infra | `*.<domainZone>` (default `.test`) resolves to the kf proxy listen address and `kf proxy serve` is running there | one-time, needs sudo — `sudo kf worktree setup` (`--print` shows the plan first). When missing, worktrees still work through the direct `127.0.0.1:<port>` URL and `kf validate`/`kf doctor` surface a `worktree_infra_missing` warning. Set `worktree.enabled: false` to opt a project out |
| Phase hooks | at least one file other than `.gitkeep` in `.kf/hooks/` | optional — see below |

The checklist reports the current state; it changes nothing itself. Read it as a diff between the project as it is and the project the pipeline expects.

## Phase hooks

A file named `<stage>.sh` under a hooks directory runs whenever a transition is about to enter that stage: `kf stage` runs the destination's hook, `kf archive` runs `dones.sh`, `kf cancel` runs `cancelled.sh`, and `kf new` runs `brainstorm.sh` — deleting the work item it just created when the hook fails. A hook belongs to a transition, so re-running `kf archive` on an item already in `dones` (a canonical-docs refresh, not a transition) runs no hook. A hook that exits non-zero refuses the transition and prints its output. On `kf stage`, `kf archive` and `kf cancel` a `--skip-hooks` bypass is available and is recorded in `.kfw.json` like any other; `kf new` has no bypass — a failing brainstorm hook simply refuses to create the item.

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
| `KFW_REPOSITORY` | The `repository` from `.kf/config.json` (`owner/name`), empty when none — so hooks never hardcode the repo |

Two **event hooks** sit outside stage transitions and only exist under worktrees:

| Hook | When it runs | Failing means |
| --- | --- | --- |
| `worktree-create.sh` | Right after a worktree is provisioned (cwd = the worktree, so `npm install`, `cp .env.example .env`, or booting a dev server on `$KFW_WORKTREE_PORT` happen in the right place). Not on reuse — the environment already exists | the worktree (and a freshly created branch) is rolled back and the transition fails, so a retry provisions clean |
| `worktree-remove.sh` | Right before `git worktree remove`, still inside the worktree — kill dev servers, `docker compose down`, release ports | a WARNING in the command output; teardown still proceeds |

They get the full `KFW_*` set above plus `KFW_EVENT` (`worktree-create`/`worktree-remove`), `KFW_WORKTREE_PATH`, `KFW_WORKTREE_PORT`, `KFW_WORKTREE_DOMAIN` and `KFW_WORKTREE_BRANCH`. `KFW_FEATURE_DIR` still points at the `.works/` item folder — only `cwd` moves into the worktree.

```bash
#!/usr/bin/env bash
# .kf/hooks/testing.sh — refuse to enter testing while the build is red
npm run build || { echo "build fails; fix before testing"; exit 1; }
```

Hooks are the project's own gates: anything the built-in gates do not check — a lint run, a migration check, a required label — belongs here rather than in a prompt.

## `kf autoconfig` against `kf doctor`

Both diagnose the project rather than a work item, and both are read-only. The split is the question asked: `autoconfig` asks *what setup step is missing* and answers with a checklist plus fix commands, written for an agent to consume; `doctor` asks *what is broken* and answers with a health report that exits `1` on an ERROR. Run `autoconfig` once at setup and again after changing `.kf/config.json`, `kf rules` or the hooks; run `doctor` when something stops working.

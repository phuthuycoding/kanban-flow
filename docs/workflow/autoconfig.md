# Agent onboarding and `kf autoconfig`

kanban-flow is driven by an agent, so setting a project up means teaching the agent, not only creating directories. Three pieces do that:

- `kf init` installs the 11 skills and the 7 agents (`code-reviewer`, `scout`, `spec-reviewer`, `developer`, `test-writer`, `automation-writer`, `researcher`): for Claude Code through the `kf` plugin (`/plugin marketplace add`, `/plugin install kf@kanban-flow`; commands `/kf:flow`, `/kf:plan`, ...), for the other runtimes as `kf-<name>` copies in the agent's skills dir (`--agent` picks which, `claude` is the default; `.agents/skills` for `codex`), and seeds `AGENTS.md` when neither `AGENTS.md` nor `CLAUDE.md` exists.
- The seeded `AGENTS.md` tells the agent the build, test and lint commands and the kanban conventions: the three human gates, `.works/` discipline, the `--force` policy. It is a starting point — edit it, because the agent reads it on every session.
- `kf autoconfig` prints the briefing described below. Run it and hand the output to the agent — or tell the agent to run it, because it can work through the checklist itself.

## Onboarding for a human: `kf init`

`kf init` is the human's way through the same setup. On a terminal it opens with a
two-option menu — **Quick setup** takes the detected defaults, **Customize** asks
each question in turn:

- **Contexts** — comma separated; the first entry is the default, an empty answer keeps the project unrestricted.
- **Stacks** — confirms the detected list, or asks for one when nothing was detected.
- **Default reviewer** — the name `kf approve` records; defaults to the git user.
- **GitHub repository** — `owner/name` or a URL for `kf issues` and the `KFW_REPOSITORY` hook variable; defaults to the detected `origin` remote, and `none` leaves the project unlinked.
- **Agents** — which agent CLIs get the 11 skills installed (and the 7 agent definitions: through the `kf` plugin for Claude Code).
- **GitHub sync hooks** — offered only when a repository is linked; yes copies the generic pack into `.kf/hooks/` (see [cli-reference](./cli-reference.md#the-hook-pack-and-the-project-board)); the catalog of issue types the pack can assign is GitHub's, see [GitHub sync: issue types](#github-sync-issue-types).
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
4. **Workflow guide** — the pipeline, the three human gates (requirement, plan approval, merging the PR), the in-session task loop and `kf verify`, and a reminder that every transition is additionally gated on artifacts and report status (`kf validate` lists what blocks the next move; the full contract lives in [gates](gates.md)). It ends with the loop semantics, the `--force` policy and the commands the agent drives — the command list is generated from the registered CLI help strings, so it cannot drift from the parser.

## The checklist, item by item

| Check | Done means | Fix when missing |
| --- | --- | --- |
| Project config | `.kf/config.json` exists | `kf init --defaults` (or `kf init` on a terminal, to answer the onboarding questions) |
| kf plugin (Claude Code) | `claude plugin list --json` shows `kf@kanban-flow` installed, enabled and reading this package, at the effective scope; the line reads `- [x] kf plugin (kf@kanban-flow, Claude Code) — installed, enabled (scope: user)`, or `not installed`, `installed but disabled`, `installed … but reading <folder>, not this package`. A probe that fails prints `⚠ cannot check kf plugin: <reason>` and leaves the item open. Claude Code has no skills or agents row | `kf install --agent claude --scope <scope>` |
| Skills, one row per other configured agent | The `kf-<name>` skill copies are linked or copied in that agent's skills dir at the effective scope (`skills.scope`, default global); the label shows the state (`missing`, `partial`, `stale`, `broken-link`, `linked`, `copied`, `mixed`) | `kf install --agent <id> --scope <scope>` |
| Agents, one row per other configured agent that has an agents dir | The 7 agents (`code-reviewer`, `scout`, `spec-reviewer`, `developer`, `test-writer`, `automation-writer`, `researcher`) are installed in that dir; a file of yours at a managed name shows as `foreign` | `kf install --agent <id> --scope <scope>`; for `foreign`, rename your file or keep the substitution |
| No duplicate project-scope copies | Only checked at global scope: no project copy of the skills shadows the global ones | `kf install` (cleans project copies), or `kf uninstall --scope project` |
| Base review rules | `general.md`, `security.md`, `performance.md` in `.kf/review/rules/` | `kf init --defaults` (seeds templates + rules) |
| Stack rule packs | A `<stack>.md` in `.kf/review/rules/` for every stack — `config.stacks` when set, else detected | `kf rules --stack <id>` (`kf rules --list` shows packs) |
| `.works/` ignored | `.gitignore` lists `.works/` — only checked when `.git` exists | `echo '.works/' >> .gitignore` |
| Agent file | `AGENTS.md` or `CLAUDE.md` at the root | create `AGENTS.md` documenting the commands and conventions |
| Declared contexts | `contexts` in `.kf/config.json` | optional — `kf contexts` prints a survey brief for an agent to propose a list, a human confirms it. Without a list, `kf new` accepts any context |
| Phase hooks | at least one file other than `.gitkeep` in `.kf/hooks/` | optional — add shell hooks named after stages (see below) |
| GitHub link | `repository` in `.kf/config.json` | optional — `kf doctor --fix` fills it from the GitHub origin remote, or set `repository` by hand |

The checklist reports the current state; it changes nothing itself. Read it as a diff between the project as it is and the project the pipeline expects. `kf init` also seeds `.kf/travel/` into `.gitignore` (the day files of the `travel` skill); the checklist does not check it.

Not on the checklist, reported by `kf doctor` (or `kf validate`) instead:

- `statusmap_legacy` — `project.statusMap` still uses the `dones` or `shipping` keys; `kf doctor --fix` renames `dones` to `done` and drops `shipping`.
- A warning that the `ship` block in `.kf/config.json` is ignored (`kf ship` is deprecated); delete the block.
- `unknown_config_key` — a top-level key in `.kf/config.json` that kf does not read (a typo such as `worktrees` for `worktree` turns the setting off silently); the action names the likely key. Rename or remove it by hand; `kf doctor --fix` leaves it.
- `harness_legacy_key` — a removed `harness` key (`main`, `roles`, `stages`, `runners`, `parallel`, `retries`, `maxLoops`, `budget`) is still in `.kf/config.json`; `kf doctor --fix` removes it and keeps `harness.verify`. `meta_legacy_run_state` — an item's `.kfw.json` still holds `drive`, `runs`, `sessions` or `tasks`; `--fix` strips them.
- A `.kf/hooks/dones.sh` or an orphaned `shipping.sh`. `kf doctor --fix` renames `dones.sh` to `done.sh` when `done.sh` is missing, keeping its content; delete `shipping.sh` by hand. When `done.sh` already exists, port any local edits from `dones.sh` into it and delete `dones.sh`.
- Missing hook-pack files, only in a project that uses the pack (`.kf/hooks/lib-github.sh` is present or a stage hook sources it): `kf doctor --fix` restores them from the package and never overwrites a hook the project edited.
- Leftover legacy folders `.works/dones/` or `.works/shipping/`; the next `kf status` (or `kf sync`) migrates them.
- A `.gitignore` without `.kf/travel/`; `kf doctor --fix` adds the entry.
- `docs_branch_unpushed` — canonical docs for a closed item sit on an unpushed `docs/<context>-<feature>` branch.
- `worktree_infra_missing` (from `kf validate`) — `*.<domainZone>` (default `.test`) does not resolve to the kf proxy or `kf proxy serve` is not running. Worktrees still work through the direct `127.0.0.1:<port>` URL; the one-time fix needs sudo: `sudo kf worktree setup` (`--print` shows the plan first). Set `worktree.enabled: false` to opt a project out. `worktree.domains` (boolean, default `true`) switches the domain infrastructure; the check is skipped when it is `false`: with it `false`, there are no `.test` DNS or proxy probes, `kf status` prints only `http://127.0.0.1:<port>`, hooks get no `KFW_WORKTREE_DOMAIN`, and ports and routes are still allocated and JSON outputs still carry `domain`.

## Phase hooks

A file named `<stage>.sh` under a hooks directory runs whenever a transition is about to enter that stage: `kf stage` runs the destination's hook, `kf archive` (and the automatic close after a merge) runs `done.sh`, `kf cancel` runs `cancelled.sh`, and `kf new` runs `brainstorm.sh` — deleting the work item it just created when the hook fails. A hook belongs to a transition, so re-running `kf archive` on an item already in `done` (a canonical-docs refresh, not a transition) runs no hook. A hook that exits non-zero refuses the transition and prints its output. On `kf stage`, `kf archive` and `kf cancel` a `--skip-hooks` bypass is available and is recorded in `.kfw.json` like any other; `kf new` has no bypass — a failing brainstorm hook simply refuses to create the item.

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

They get the full `KFW_*` set above plus `KFW_EVENT` (`worktree-create`/`worktree-remove`), `KFW_WORKTREE_PATH`, `KFW_WORKTREE_PORT`, `KFW_WORKTREE_DOMAIN` and `KFW_WORKTREE_BRANCH`. `KFW_WORKTREE_DOMAIN` is set only when `worktree.domains` is on. `KFW_FEATURE_DIR` still points at the `.works/` item folder — only `cwd` moves into the worktree.

The `drive-stop.sh` hook was removed together with `kf drive`; delete it if your project has one.

```bash
#!/usr/bin/env bash
# .kf/hooks/testing.sh — refuse to enter testing while the build is red
npm run build || { echo "build fails; fix before testing"; exit 1; }
```

Hooks are the project's own gates: anything the built-in gates do not check — a lint run, a migration check, a required label — belongs here rather than in a prompt.

## GitHub sync: issue types

The sync hooks create issues; they never create issue types. An issue type (`Task`, `Bug`, `Feature`, or an `Epic` for an umbrella item) is part of the repository's GitHub catalog, which GitHub manages at the **organization** level — there is no kf command for it and the runbook below is run once by a human, with `gh` authenticated as a repository admin. Every command and its output go into the work item's testing report, because the catalog is live state that no CI fixture reproduces.

| Step | Command | Expected |
| --- | --- | --- |
| 1. Read the catalog | `gh api repos/<owner>/<repo>/issue-types` | The enabled types; a user-owned repository starts with GitHub's defaults (`Task`, `Bug`, `Feature`) |
| 2. Create the type | `gh api --method POST orgs/<org>/issue-types -f name=Epic -f description='Umbrella item' -F is_enabled=true` | `201` and the type in the catalog on the next step-1 read. Skip when step 1 already lists it |
| 3. Type the issue | `gh issue edit <n> --type Epic`; when the installed `gh` has no `--type` flag, the GraphQL mutation `updateIssueIssueType(input: {issueId, issueTypeId})` with the ids from steps 1 and `gh issue view <n> --json id` | `gh api repos/<owner>/<repo>/issues/<n> --jq .type.name` prints `Epic` |
| 4. Probe the CLI | `gh issue create --type Epic --title "probe: Epic type" --body "probe"`, then `gh issue close <probe>` | The probe is created with the type and closed in the same session |

**When the API refuses.** Step 2 has no repository-level form: the only create endpoint is the organization one, so on a repository owned by a user account it answers `404` (or `403` without admin rights). That is a blocker, not a detour — stop, record the exact error, and point the human at the organization settings page where types are managed (`https://github.com/organizations/<org>/settings/issue-types`; a user account has no such page, so the remaining options are a GitHub-side change or moving the repository under an organization). Leave the tracking issue open and never stand in a label for the type: a label is not read by `gh issue create --type`, by the board's type field or by anything that filters on `type`, so it would pass a glance and fail the acceptance check.

## `kf autoconfig` against `kf doctor`

Both diagnose the project rather than a work item, and both are read-only. The split is the question asked: `autoconfig` asks *what setup step is missing* and answers with a checklist plus fix commands, written for an agent to consume; `doctor` asks *what is broken* and answers with a health report that exits `1` on an ERROR. Run `autoconfig` once at setup and again after changing `.kf/config.json`, `kf rules` or the hooks; run `doctor` when something stops working.

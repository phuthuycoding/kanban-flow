---
feature: researcher-agent
context: harness
created: 20261102_0823
kind: feature
status: archived
---
# Spec Requirement

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

## Feature
researcher-agent

## Objective
This feature makes three changes.

1. **A `researcher` agent**, the seventh agent. Skills dispatch it automatically, by explicit rule, whenever an answer has to be found out rather than read from the contract. It has three modes:
   - `web`: external docs, versions, best practice.
   - `code`: how an existing flow in this repository works.
   - `prior-art`: how other tools solved the same problem.

   It returns a short, sourced conclusion and writes the full findings to a report file, so the session that dispatched it keeps a small context.
2. **A `spike` skill.** It takes over the Spike path that the flow skill now describes inline, and it dispatches the researcher for the parts that are research.
3. **A Claude Code plugin named `kf`.** All skills and agents ship as this plugin, and the `kanban-` prefix comes off every skill. In Claude Code the user types `/kf:plan`, `/kf:review` and so on, and skills dispatch agents as `kf:researcher`, `kf:scout` and so on. The other six runtimes keep copied skill directories with a `kf-` prefix:

   | Old skill | Name inside the plugin | Claude Code | Other six runtimes (copied dir) |
   |---|---|---|---|
   | `kanban-flow` | `flow` | `/kf:flow` | `kf-flow` |
   | `kanban-brainstorm` | `brainstorm` | `/kf:brainstorm` | `kf-brainstorm` |
   | `kanban-plan` | `plan` | `/kf:plan` | `kf-plan` |
   | `kanban-implement` | `implement` | `/kf:implement` | `kf-implement` |
   | `kanban-test` | `test` | `/kf:test` | `kf-test` |
   | `kanban-review` | `review` | `/kf:review` | `kf-review` |
   | `kanban-archive` | `archive` | `/kf:archive` | `kf-archive` |
   | `kanban-bug` | `bug` | `/kf:bug` | `kf-bug` |
   | (new) | `spike` | `/kf:spike` | `kf-spike` |
   | `travel` | `travel` | `/kf:travel` | `kf-travel` |

   Plugin components are namespaced, which the docs state and a probe confirmed. So `/kf:review` does not collide with the built-in `/review` or with another tool's `review` skill. Existing installs are migrated.

## Problem Statement
Research has no seat of its own. Every research step runs inline in the controller session today:
- brainstorm grounding;
- the Spike path inside the flow skill;
- choosing a library or approach at planning;
- a developer that stops on `NEEDS_CONTEXT` for lack of outside knowledge.

Each one leaves file dumps and fetched pages in the main context. None leaves a named line, and its claims carry no sources. `scout` only answers "what depends on the thing about to change", and it has no web tools.

Packaging is flat. Skills install as loose `kanban-*` directories and loose agent files. The user wants short namespaced commands (`kf:plan`) without the collision risk that bare names carry.

User journey (agreed 2026-11-02 over four revisions, see `request.md`):
- **Install.** The user runs `kf install` or `kf init`. Claude Code gets the `kf` plugin, and old `kanban-*` entries and loose agent files are removed. The other runtimes get `kf-<name>` directories.
- **Feature work.** The user types `/kf:flow <ctx> <feature>` or describes the idea. When a phase meets a trigger condition, the transcript shows `Agent(kf:researcher)` with a mode and a question. The user is not asked first. The agent returns a conclusion, a confidence, its sources and what remains unverified, and the phase summary shows that conclusion.
- **Spike.** The user asks a question rather than requesting a change. The flow skill loads `Skill(kf:spike)`. It probes, dispatches the researcher where the answer is research, and reports a recommendation, the sources and the exact commands it ran. Only an irreversible step waits for an explicit "go".

## Scope
### In Scope
- **Plugin root.** A plugin root inside the npm package, at a path fixed in planning. It holds:
  - `.claude-plugin/plugin.json` with `name: "kf"` and the package version;
  - `.claude-plugin/marketplace.json` with a relative `./` source, so the directory also serves as a local marketplace;
  - the ten skills as `skills/<name>/SKILL.md`;
  - the seven agents as `agents/<name>.md`, including the new `agents/researcher.md`;
  - the references, templates and review rules that skills and agents read.
- **Researcher agent and brief.** The agent body, plus its brief at `skills/flow/references/researcher-brief.md` inside the plugin root.
- **Spike skill.** `skills/spike/SKILL.md`, which replaces the inline Spike path in the flow skill.
- **Auto-dispatch rules** for `kf:researcher` in the brainstorm, plan, implement and spike skills.
- **Claude Code install.** `kf install` registers the package's plugin root as a local marketplace and installs `kf` through the `claude plugin` CLI. `kf uninstall` reverses it, and `kf doctor` checks it. This is the default choice: the plugin comes from the npm package, so its version matches the CLI.
- **Other six runtimes.** One shared `kf-<name>` copy goes into `.agents/skills` for codex, gemini, cursor, opencode and devin, and Kiro gets its own copy in `.kiro/skills`. References are rewritten for the copies.
- **Cross-references.** Every reference to a skill or agent name is rewritten in skills, agents, references, `src/`, tests and the living docs.
- **Migration.** `kf install`, `kf uninstall` and `kf doctor --fix` clean up old installs: legacy skill entries and loose agent files.
- **Code changes.** `src/integrations/install.ts`, `src/integrations/agents.ts`, the doctor install checks (`doctor-install.ts`) and the CLI help in `src/cli/args.ts`.

### Out of Scope
- A `spike` mode inside the agent. Spike is a skill, by the user's decision.
- Splitting research into several agents.
- A `kf research` or `kf spike` command, a work-item kind for spikes, or any new state in `.kfw.json`.
- Letting the researcher edit tracked files, commit or decide scope.
- Caching research across work items, beyond the report files kept under each item.
- Renaming the product. The npm package, the repo, the `kf` CLI, `schema: "kanban-flow"`, `.works/` and the phrase `kanban <context> <feature>` stay as they are.
- Rewriting history. Archived feature docs (`docs/requirement/*`, `docs/use-cases/*` and `docs/testplan/*` of past items), `.works/`, CHANGELOG entries already released, and versioned fixtures such as `src/tests/fixtures/kanban-ship-0.13.0/` stay as they are.
- Aliases for the old names. They are removed.
- Publishing to a GitHub or third-party marketplace.
- Native bundles for the other runtimes (Devin plugins, Gemini extensions, Codex plugins). Research in `reviews/research-other-runtime-plugins.md` found that only Devin documents both namespaced skills and a CLI install. This becomes a follow-up item with its own install probe.

## Affected surfaces
- **Slash commands (breaking).** `/kanban-flow` becomes `/kf:flow`, and the same for every skill. The other runtimes see `kf-<name>`.
- **README.md.** The agent list (around line 101), the harness description (around line 217), the skill list and the install section.
- **`.github/pages/index.html`.** The agent list (around line 194), the skill count and the install steps.
- **`docs/workflow/harness.md`, `skills.md`, `autoconfig.md`, `cli-reference.md`.** The agent and skill counts and lists, and the install steps.
- **Living skills, references and agent bodies.** Every skill name, agent name and file path.
- **The flow skill.** The named-line table, the Spike row, "The six agent bodies" (now `skills/kanban-flow/SKILL.md:39`) and the Multi-agent harness section.
- **`references/harness-tools.md`.** The dispatch-by-name row and the paste path used by the other runtimes.
- **CLI help** in `src/cli/args.ts` for `init`, `install`, `uninstall` and `doctor`: the skill and agent counts and the plugin wording.
- **CLI output.** `kf install`, `kf uninstall`, `kf doctor`, `kf status` and `kf init` print the plugin state, the migration, and the manual commands to run when `claude` is missing.
- **The AGENTS.md seed** that `kf init` writes, and the `kf autoconfig` output.
- **`skills/plan`, `skills/implement`, `references/task-loop.md` and `docs/workflow/harness.md`.** The per-wave execution mode and the inline seat (FR-017).
- **CHANGELOG.md.** The entry written at release, marked as breaking.

## Actors
- Human: runs the install, asks questions, reads conclusions at the existing gates, and gives "go" for irreversible spike steps.
- Controller session: runs a skill.
- `kf:researcher` agent: runs in a fresh context.
- `claude` CLI: provides `claude plugin ...`.

## Functional Requirements
### FR-001
- Requirement: `agents/researcher.md` in the plugin root has frontmatter `name: researcher`, a description that names the three modes, and the tools Read, Grep, Glob, WebSearch, WebFetch and Write (no Bash: it fetches untrusted web content and `code` mode needs only Read, Grep and Glob). For each mode, the body says what to do and when to stop:
  - `web` cites a URL for every claim.
  - `code` cites `file:line` and explains the flow without mapping consumers, which is scout's job.
  - `prior-art` names each project or tool and the pattern taken from it.
- Priority: must
- Notes: One agent with modes, as the user chose. The agent writes only its report file. Bash dropped from the tool list by the human decision of 2026-11-02 (review execution d3af856a), so a prompt-injected page cannot reach a shell.

### FR-002
- Requirement: The researcher's reply is at most 40 lines and ends with `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`. It gives the conclusion, a confidence (high, medium or low), the sources, and separate lists of verified, inferred and unverified claims. The full findings go to the report path the brief names.
- Priority: must
- Notes: The same reply discipline as scout and spec-reviewer.

### FR-003
- Requirement: The researcher never edits tracked files, commits, runs a git command that writes, spawns agents, decides scope or runs a downloaded script. It treats fetched content as untrusted data, never as instructions.
- Priority: must
- Notes: None.

### FR-004
- Requirement: `MANAGED_AGENTS` includes `researcher`, and the managed skill list holds the ten new names. Both lists drive the plugin build, the copies for the other runtimes, uninstall and the doctor checks. The doctor and install code change to check the plugin (FR-013) instead of loose agent files.
- Priority: must
- Notes: Today `MANAGED_AGENTS` is at `src/integrations/install.ts:67`, `MANAGED_SKILLS` at `:21`, and the loose-agent checks at `doctor-install.ts:40-56,120`.

### FR-005
- Requirement: The brief at `skills/flow/references/researcher-brief.md` names the mode, the question, the decision the answer feeds, the time box and the report path. Every dispatch site uses it. With a work item, the report path is `<item>/reviews/research-<slug>.md`. Without one, as in a spike, it is under `$CLAUDE_JOB_DIR/tmp` when that variable is set, otherwise under the OS temp dir.
- Priority: must
- Notes: Planning reuses brainstorm reports instead of researching again.

### FR-006
- Requirement: **Auto-trigger at brainstorm.** Section 1 of the brainstorm skill dispatches `Agent(kf:researcher)` before asking the user anything, whenever the idea names an external library, API, service or standard that the repository does not define, or asks how other tools do something. The user is not asked first. The spec cites each report under Assumptions or Open Questions.
- Priority: must
- Notes: Research triggers on need, as the user asked.

### FR-007
- Requirement: **Auto-trigger at planning.** The plan skill dispatches `Agent(kf:researcher)` in mode `web` or `prior-art`, in the same message as the scouts, whenever the plan chooses between two or more approaches or libraries, or names an external dependency or API version. The approval summary names the choice and its sources. The plan's self-review fails a plan that makes such a choice without a research report.
- Priority: must
- Notes: The researcher runs next to the scouts and does not replace them.

### FR-008
- Requirement: `skills/spike/SKILL.md` runs the Spike path. The flow skill's Spike row loads `Skill(kf:spike)` and no longer describes the procedure inline. The spike skill:
  1. opens no work item;
  2. states in two sentences what it will probe, then starts without waiting for a nod;
  3. dispatches `Agent(kf:researcher)` for the questions research can answer;
  4. writes throwaway code only in a scratch dir under `$CLAUDE_JOB_DIR/tmp` or the OS temp dir;
  5. waits for an explicit "go" before any irreversible step;
  6. reports a recommendation, the sources and the exact commands;
  7. hands back to the flow skill to reclassify when the answer turns into work.
- Priority: must
- Notes: Read-only probing no longer waits for a nod.

### FR-009
- Requirement: **Auto-trigger at implement.** In section 3.2 of the implement skill, a developer `NEEDS_CONTEXT` or `BLOCKED` caused by missing outside knowledge makes the controller dispatch `Agent(kf:researcher)`. This does not apply to a plan defect, a test dispute or an architectural choice. The controller then follows the existing rule "NEEDS_CONTEXT → supply it, re-dispatch the same agent", passing the conclusion and the report path as the context. The ledger gets a `Ruling:` line that cites the report, so the seat grammar of `references/task-loop.md` and `kf loop-stats` stay unchanged. This dispatch is not a fix round and uses no fix brief.
- Priority: must
- Notes: None.

### FR-010
- Requirement: The flow skill's named-line table lists `Agent(kf:researcher)` at brainstorm, plan and implement, and adds a Spike row with `Skill(kf:spike)`. Every named line, skill hand-off and agent dispatch in the skills uses the `kf:` form, spelled exactly as Claude Code spells it.
- Priority: must
- Notes: The probe confirmed that a bare agent name fails with "Agent type ... not found" (`reviews/research-claude-plugin.md`).

### FR-011
- Requirement: The plugin root is self-contained. Every file a skill or agent reads lives in the plugin root or comes from the `kf` CLI, including the review rules (read today from `kanban-flow/review/rules`) and the templates. Skills reach bundled files through `${CLAUDE_PLUGIN_ROOT}`. Agent bodies do not rely on that variable; the dispatching skill passes absolute paths in the brief instead. `claude plugin validate <plugin root>` passes.
- Priority: must
- Notes: A marketplace install copies only the plugin root. The probe confirmed that the variable is substituted in SKILL.md bodies; agent bodies were not probed.

### FR-012
- Requirement: No living file outside the Out of Scope history names an old skill. The check runs `git grep -nE "kanban-(flow|brainstorm|plan|implement|test|review|archive|bug)\b"` over the tracked files, excluding the history paths listed in Out of Scope. It may match only:
  - the product name `kanban-flow`: package and repo names, URLs and `schema: "kanban-flow"`;
  - the legacy-name list in the migration code and its tests;
  - CHANGELOG.
- Priority: must
- Notes: This makes the rename check mechanical.

### FR-013
- Requirement: **Claude Code install.**
  - `kf install --agent claude` runs `claude plugin marketplace add <plugin root>`, then `claude plugin install kf@<marketplace> --scope <s>`. kf's `global` maps to `user`, and `project` maps to `project`. The command is idempotent.
  - Each session loads the plugin in place from the package folder, so a new package version takes effect without any update command (confirmed by probe). When the registered path differs from the running CLI's package path (after an nvm or volta switch, or a reinstall), install runs `claude plugin marketplace add <current plugin root>` again. That re-points the marketplace without a reinstall (confirmed by probe).
  - When `claude` is not on PATH, or a `claude plugin` call fails, install exits non-zero, quotes the output, and prints the manual `/plugin marketplace add` and `/plugin install` commands.
  - `kf init` in the same situation finishes the rest of the bootstrap, warns, and prints the same commands.
  - `kf uninstall --agent claude` runs `claude plugin uninstall kf` and `claude plugin marketplace remove`.
  - `kf doctor` reports a plugin that is missing, disabled, or registered at a path other than the running CLI's plugin root. A moved path makes the plugin fail to load with "cache-miss". `--fix` runs the install steps when `claude` is present, and otherwise prints the commands.
  - `kf status` prints a one-line warning when the registered path is stale, so a plugin that broke after a Node switch is noticed without running doctor.
- Priority: must
- Notes: Confirmed on claude 2.1.316 in an isolated config (`reviews/research-packaging-direction.md`). `marketplace remove` also uninstalls the plugin. A marketplace hosted on GitHub was considered and deferred: skills call the `kf` CLI, so the plugin and the CLI must stay in lockstep, and loading in place from the installed package guarantees that.

### FR-014
- Requirement: **Other runtimes share one copy.** For codex, gemini, cursor, opencode and devin, `kf install` copies the ten skills as `kf-<name>` directories into the open-standard dir: `.agents/skills/` at project scope and `~/.agents/skills/` at global scope. Kiro is the exception and gets its own copy in `.kiro/skills/` or `~/.kiro/skills/`. A single install for several of these runtimes writes the shared copy once.
  - Inside a copy, hand-offs name `kf-<name>`, and the paste path for agent bodies is `<skills dir>/kf-flow/agents/<name>.md`.
  - These runtimes paste agent bodies as they do today and register no agent names.
  - Ownership uses the existing manifest mechanism. An entry with the same name that kf does not own is left untouched and reported.
  - The runtime table in `src/integrations/agents.ts` points those five runtimes at the shared dir.
  - The "Also picked up by" note reports what reads the shared dir.
- Priority: must
- Notes: The user chose this on 2026-11-02. Each runtime's docs confirm it reads `.agents/skills` (`reviews/research-packaging-direction.md`). Claude Code does not read that dir and uses the plugin instead.

### FR-015
- Requirement: **Migration.** At both scopes, `kf install`, `kf uninstall` and `kf doctor --fix` remove:
  - the legacy skill entries `kanban-flow`, `kanban-brainstorm`, `kanban-plan`, `kanban-implement`, `kanban-test`, `kanban-review`, `kanban-archive` and `kanban-bug`, when each is a kf link or directory;
  - `travel`, only when the manifest says kf owns it;
  - the seven loose agent files in `.claude/agents/` or `~/.claude/agents/`, when kf owns them by link or manifest digest;
  - the old per-runtime `kanban-*` copies in the runtime dirs kf wrote before (`.agents/skills`, `.gemini/skills`, `.cursor/skills`, `.kiro/skills`, `.opencode/skills`, `.devin/skills`, and their user-scope forms, including `~/.config/opencode/skills`), on the same ownership rule.

  `kf doctor` reports what is left over. An entry kf does not own (a regular file, a link that points outside the package, or a `travel` it does not own) is reported and left alone.
- Priority: must
- Notes: The user chose automatic removal. A `kanban-*` directory with local edits still belongs to kf by its prefix, so it is removed and listed in the output.

### FR-016
- Requirement: The AGENTS.md seed that `kf init` writes, `kf autoconfig`, and every living doc name the new commands (`/kf:flow` and the rest, plus `kf-<name>` for the other runtimes) and describe the plugin install.
- Priority: must
- Notes: None.

### FR-017
- Requirement: **Execution mode per wave.** The plan and implement skills choose how each wave of the task graph runs.
  1. **Plan.** The plan skill reads `kf tasks <f> --graph` and records one `Execution:` line per wave in the plan: `Execution: wave <w> inline` when the wave holds one task, otherwise `Execution: wave <w> parallel, <N> developers`, where N = min(wave width, 4). The approval summary states the lines.
  2. **Inline seat.** In an inline wave the controller fills the developer seat itself. The ledger keeps the seat grammar of `references/task-loop.md`: `developer dispatched` and `developer done`, with `Note TASK-NNN: developer seat inline` right after the dispatched line, so `kf loop-stats` parses it unchanged. Test-writers still run ahead for the next 4 tasks in parallel, from the TCs and the plan's signatures. The code-reviewer stays an independent agent; the controller never reviews its own task.
  3. **Pipelined review.** After committing task N inline, the controller starts `kf verify` and the code-reviewer in the background and starts task N+1. It does not commit N+1 until N's review is back, and it fixes N's HIGH and MEDIUM findings first.
  4. **Signature drift.** When task N must deviate from a signature the plan fixes, the controller ledgers a `Ruling:` line and re-dispatches the test-writers of the dependent tasks. It never edits their tests.
  5. **Long chains.** A chain of more than 5 inline tasks, or one whose diffs are large, uses one developer subagent resumed for the whole chain instead of the controller, so the controller's context stays for coordination.
- Priority: must
- Notes: The user ruled on 2026-11-02 that a fully sequential run spawns no developer per step, and that test-writers still run in parallel. A per-project or auto-scaled cap is a separate item.

## Non-Functional Requirements
- The researcher defaults to `model: sonnet`. A brief may raise it to opus.
- On a runtime with no web tool, `web` and `prior-art` stop with `BLOCKED` and give the reason. The researcher never makes up sources.
- The agent body is at most 150 lines.
- The plugin facts come from the Claude Code docs (fetched 2026-11-02) and a probe on claude 2.1.316, recorded in `reviews/research-claude-plugin.md`. The facts about the other runtimes are in `reviews/research-other-runtime-plugins.md`.

## Main Use Cases
- UC-001 A skill dispatches the researcher on its own (brainstorm or plan trigger)
- UC-002 The human asks a spike question and the spike skill answers it
- UC-003 The controller unblocks a developer with research
- UC-004 A user with an old install runs `kf install` and moves to the `kf` plugin
- UC-005 The controller runs a one-task wave inline

## Constraints
- Follow the existing agent and skill file formats. No new CLI command and no new item state.
- Research claims cite sources. A claim without a source is labeled unverified.

## Assumptions
- The trigger rules are skill instructions that the model follows, not a hook. If a trigger applied and no `Agent(kf:researcher)` line appears, the step was skipped, visible in the transcript like any other missing named line.
- Unit tests stub the `claude` binary. Testing runs one live `claude -p --plugin-dir` probe as the end-to-end check.

## Acceptance Criteria
- [ ] The plugin root holds:
  - `.claude-plugin/plugin.json` (`name: "kf"`, the package version);
  - `marketplace.json`;
  - ten `skills/<name>/SKILL.md` with matching frontmatter names;
  - seven `agents/<name>.md`, including `researcher.md` with the three modes and the guardrails of FR-001 to FR-003.

  `claude plugin validate` passes on it.
- [ ] The researcher body states the 40-line limit, the closing `STATUS:` line, the confidence, the verified, inferred and unverified lists, and the `BLOCKED` stop for `web` and `prior-art` when no web tool is available.
- [ ] `skills/spike/SKILL.md` has the steps of FR-008. The flow skill's Spike row names `Skill(kf:spike)` and has no inline procedure.
- [ ] The brainstorm, plan, implement and spike skills state the trigger conditions of FR-006 to FR-009 and name `Agent(kf:researcher)` and the brief.
- [ ] The plan self-review fails a plan that makes a choice without a research report. Implement 3.2 records research as a `Ruling:` line.
- [ ] The grep in FR-012 matches only the allowed uses.
- [ ] With a stubbed `claude`, `kf install --agent claude` issues the marketplace-add and install calls with the plugin root and the mapped scope. A second run makes no calls beyond the read-only `list`. With `claude` missing, it exits non-zero and prints the manual commands, and `kf init` warns and completes.
- [ ] With a stubbed `claude list --json` that reports a stale path or a missing plugin, `kf doctor` reports each, `kf doctor --fix` issues `marketplace add <current root>` (and `install` when the plugin is missing), and `kf status` prints the stale-path warning.
- [ ] In a temp dir, `kf install --agent codex --agent gemini` writes ten `kf-<name>` directories, once, into `.agents/skills`, with rewritten hand-offs and agent paths. `--agent kiro` writes them into `.kiro/skills`. Old `kanban-*` copies in `.gemini/skills` and `.cursor/skills` are removed.
- [ ] In a temp dir with an old `kanban-*` install, an owned `travel` and the seven loose agent files, `kf install` leaves none of them behind. A foreign `review` skill and a `travel` kf does not own are left untouched and reported. `kf doctor` reports leftovers, and `--fix` removes them.
- [ ] The AGENTS.md seed, `kf autoconfig`, README, Pages, `docs/workflow/*` and the CLI help name `/kf:<name>` and the plugin install.
- [ ] Live probe: `claude -p --plugin-dir <plugin root> "/kf:plan"` loads the plan skill, and a dispatch with `subagent_type: kf:researcher` reaches the agent. The command and its output are recorded in the test result.
- [ ] The plan skill records one `Execution:` line per wave from `kf tasks --graph`. The implement skill states the inline seat, the ahead test-writers, the independent reviewer, the pipelined review gate, the signature-drift ruling and the long-chain rule of FR-017. `kf loop-stats` parses an inline ledger.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass.

## Edge Cases
- The question is really about blast radius: the researcher points to scout and stops with `NEEDS_CONTEXT`.
- Sources conflict: the researcher reports both and lowers the confidence.
- The time box runs out: the researcher returns what it has, with `DONE_WITH_CONCERNS`.
- Several researchers run in parallel: each has its own report path.
- A spike answer turns into a change: the spike skill hands back to the flow skill and never implements.
- An irreversible spike step: the spike skill waits for an explicit "go".
- A foreign skill already occupies a `kf-<name>` dir in another runtime: kf's copy is not installed, and the install says so.
- An npm upgrade or Node switch moves the package: the plugin fails to load, `kf status` warns, `kf doctor` reports the stale path, and `kf install` or `kf doctor --fix` re-points it.
- `claude` is missing or a `claude plugin` call fails: the install exits non-zero, quotes the output, and never reports success.

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: no
- Tools: vitest (`npm test`, `src/tests/*.test.ts`) with a stubbed `claude` binary; one live `claude -p --plugin-dir` probe recorded in the testing result
- Coverage Target: 80%

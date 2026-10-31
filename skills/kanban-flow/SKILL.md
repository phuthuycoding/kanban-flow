---
name: kanban-flow
description: Drive a kanban feature or bug through brainstorm, planning approval, implementation, testing, review (PR + CI) and the close on merge using the kf CLI — one command, every gate, each delegated step leaving a named line. Use when the user requests the kanban workflow or resumes a work item managed in .works. Classifies the request (spike, bounded, architectural) and delegates each phase to its dedicated skill.
---

# Kanban Flow — the spine

**The user describes the idea; the agent decides the rest.** One command runs the whole lifecycle; each phase runs a dedicated skill; the `kf` CLI holds the state. **Every gate is kept at every size** — what scales with the request is the depth of the design and the fan-out of the agents, never the number of steps.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `kanban auth user-login` or `kanban billing payment-timeout --type bug`

```
0 kf status ──► 1 classify ──► 2 brainstorm ──confirm──► 3 plan ──approve──► 4 implement ──► 5 test ──► 6 review + PR + CI ──PASS──► 7 merge on GitHub ──► done
                 spike │ bounded │ architectural                                   ▲                │  FAIL / REJECT  │
                 (no item)                                                         └────────────────┴─────────────────┘
```

State is enforced by `kf`: artifact gates, approval fingerprints, execution ids, report statuses and traceability. The agent authors and verifies the content; file presence alone never proves that code was tested.

**Human boundary — three decisions and nothing else:** confirm the requirement (Phase 1), approve the execution contract (Phase 2 — the approval starts the item; a reply that defers parks it in backlog), and merge the reviewed PR on GitHub. Everything between runs autonomously inside the approved scope. Stop and ask only for `REQUIREMENT_BUG`, a scope change, or a stop code that names the human.

**Preflight:** if the project has no `.works/`, run `kf init --defaults` first (full bootstrap without prompts; `kf init -i` when the user should answer the setup questions). Detect stack and tooling by READING the repository — never assume.

---

## Every step leaves a named line

A step invoked as a tool renders one line carrying its name; a step merely *performed* dissolves into a scatter of reads and shell calls that look like every other piece of work. Then "did the review actually happen?" is answerable only by trusting the summary — and this pipeline exists so its steps can be checked by looking. **A missing line is a skipped step.**

| Step | Named line(s) in the transcript | Skipped when |
|---|---|---|
| 2 Brainstorm | `Skill(kanban-brainstorm)` · `Agent(spec-reviewer)` once before the confirmation ask | the spec was written without the reviewer, or confirmed without the user's word |
| 3 Plan | `Skill(kanban-plan)` · `Agent(scout)` per thing that changes · `Agent(spec-reviewer)` before the approval ask | the impact survey was done inline, or the plan presented without the reviewer |
| 4 Implement | `kf drive <f>` (task harness) or `Skill(kanban-implement)` with `Agent(code-reviewer)` per task | a task was marked complete without a review seat |
| 5 Test | `Skill(kanban-test)` | a PASS report with no command and exit code behind it |
| 6 Review | `Skill(kanban-review)` · `Agent(code-reviewer)` × the tier `select-tier` chose · the landing board `cat` from its file · `gh pr create` (first review only) and the CI watcher, both after the reviewer PASS | the orchestrator wrote findings itself, dispatched fewer seats than the tier, summarised the board instead of printing it, or opened the PR before the reviewer passed |
| 7 Merge / close | the PR URL handed to the human, then `kf status` showing `done` after their merge | a close before the PR merged, or a merge made by the agent |

The three agent bodies live in this skill at `agents/<name>.md`; `kf install` registers them where Claude Code looks (`.claude/agents/`), and other runtimes paste the body into a plain subagent. **A session never fills the review seat itself.** The action → tool mapping per runtime is in [references/harness-tools.md](references/harness-tools.md).

---

## 1. Classify the request — and say it out loud

Before `kf new`, name the path so the user can override it:

| Path | What it is | What happens |
|---|---|---|
| **Spike** | A question, not a change: "can we…", "how long would…", "what does X return today". The output is an answer; anything built is throwaway. A one-shot operation that lands no code (delete old releases, flip a catalog setting) is a spike with the human's explicit "go" before the irreversible step. | **No work item.** Say what you will probe in two sentences, get a nod, find out as cheaply as correctness allows, report the recommendation and the exact commands run. If the answer turns into work, classify again. |
| **Bounded** | A change to a flow that already exists in this repository: a flag, a small endpoint, a one-file fix — "I know the kind of app" is not enough; the flow you change must be here to read. | `kf new` and **every gate below**, at the smallest honest size: one or two UCs, test cases for the touched behaviour only, a plan of one to three tasks, one `scout` on the one surface, no divergence framework, review at the tier the diff earns (usually T1). The spec and plan are a page each. |
| **Architectural** | New projects, new subsystems, changes that restructure how components fit or alter interfaces others depend on, anything with a shared surface. | The full process: divergence framework, several scouts, the complete planning contract, the reviewer tier the diff demands. |

**One-way ratchet:** hidden complexity found mid-task upgrades the path — stop, say so, step up. Never downgrade to skip a gate, and never call something "too simple to need a design": a bounded design is two paragraphs, not zero. In doubt, take the heavier path.

**Bugs** (`--type bug`) have their own lighter contract (`kanban-bug`: reproduction, root cause, regression) and skip the classification — a bug is bounded by definition until its fix turns out to need a feature, which is a human decision.

---

## 2–7. Phase model & artifact contract

```
brainstorm → planning → implementation → testing → review ──merge on GitHub──→ done
                 ↘ backlog ↗
```

Folder name: `{feature_name}_{timestamp}` (created by `kf new`). Artifacts follow `phase-{x}-{name}.md`.

| Phase | Skill | Gate artifacts (filled to LEAVE) | Notes |
|-------|-------|----------------------------------|-------|
| 2. Brainstorm / Bug triage | `kanban-brainstorm` or `kanban-bug` | `phase-1-spec-requirement.md` (`status: confirmed`) | Ground the names first; `spec-reviewer` before the confirmation ask; human confirms |
| 3. Planning | `kanban-plan` | Feature: four phase-2 files + `use-cases/UC-###(-<slug>).md`; bug: confirmed bug report | `scout` per surface, saved under `<item>/reviews/`; `spec-reviewer` before approval; **human approves: `kf approve` starts, `kf approve --backlog` defers** |
| Backlog | — | Approved planning contract remains intact | Waiting for the explicit decision to start (`kf stage <f> implementation`) |
| 4. Implement | `kanban-implement` | — (tasks.md and the `loop/progress.md` ledger track) | `kf drive` when a task harness is configured, else the subagent-driven task loop — fresh implementer per task, `code-reviewer` per task, bounded fix loop |
| 5. Testing | `kanban-test` | `phase-4-testing-result.md` (`status: PASS`) | Counts, not verdicts; a changed behaviour no test covers is run for real; FAIL/REJECT → loop to implementation |
| 6. Review | `kanban-review` | `phase-5-review-report.md` (`status: PASS`) | Facts and pack by the orchestrator, findings by independent `code-reviewer` agents at the tier the diff earns, evidence verified; the landing board stamps every check with the tree's fingerprint; only after the reviewer PASS is the item branch pushed and the PR opened, then CI is watched (`ci:` / `landing:` in the report); FAIL/REJECT or red CI → loop; REQUIREMENT_BUG → STOP |
| 7. Closure | `kanban-archive` | Feature: `phase-6-feature-report.md` (written at review PASS); bug: current test/review evidence | Internal: once the PR is merged on GitHub, `kf status` / `kf sync` close the item to `done` (a `landing: none` item with no commits closes on the next `kf status`); `kf archive` is the explicit, idempotent form |

**Two gate layers on every move:**
1. **Artifact gate** — files exist and contain no template placeholders.
2. **Directional gate** — report `status` semantics: FAIL/REJECT blocks forward motion and forces a loop back to implementation; REQUIREMENT_BUG blocks **all** motion (STOP FEATURE — never silently rewrite the requirement).

For features, `kf validate` checks each `## TC-###` for FR references and matching individual UC files. Approval fingerprints the requirement, four planning artifacts and individual UC files. For bugs, approval fingerprints only the bug report; feature planning artifacts and feature report are not required. A changed contract must return to planning for human approval. Each entry to testing creates a new execution id; testing and review reports must carry that id in `execution:`. Read templates with `kf instruct <artifact> --change <feature>` to obtain the current id and exact output path.

Feature canonical docs are synced by the CLI on close:
- Requirement: `docs/requirement/{context}/{feature_name}.md`
- Use cases: `docs/use-cases/{context}/{feature_name}/README.md`, one `UC-###(-<slug>).md` per use case and `diagram.md`
- Test plan/result: `docs/testplan/{context}/{feature_name}.md` and `{feature_name}-result.md`

Work item type is stored in `.kfw.json` as `kind: feature|bug`. Create a bug with `kf new <name> --type bug`; route it to `kanban-bug` for reproduction and triage before planning. Bug closure updates the existing related feature docs only if needed; never auto-create feature docs for a bug or overwrite a feature requirement with bug-report content.

---

## How to delegate phases

The pipeline is ONE run but each phase has a specialist skill:

```bash
kf status --all                # which phase is each feature in?
kf status --change {feature}   # current phase + artifact checklist + Next: + Approval
```

Then **load the skill for the feature's CURRENT phase** and follow it to its endpoint (each skill ends pointing at the next one). Do not re-read phase instructions you have already executed; go straight at the target.

The approval is the start: `kf approve {feature}` moves the item to implementation (worktree provisioned when enabled), `kf approve {feature} --backlog` parks it when the human's reply defers; there is no second question. If planning is already approved and its fingerprint is unchanged, `kf approve` re-runs the move. Before presenting the plan, check `.kf/config.json`: when `harness.verify.stage` is set and `worktree.enabled` is not `true`, the drive cannot start — say so in the approval summary. After the approval, if a drive is configured (`harness.verify.stage` set and `worktree.enabled: true`), run `kf drive {feature}` instead of loading `kanban-implement` yourself, monitor it with `kf drive {feature} --status` (each live worker's last action and its age), and handle stops as the `kanban-implement` stop-code table says. When the drive ends `ready`, the review is PASS and its PR is open: hand the human the PR URL to merge. If an item is in backlog, do not start implementation without an explicit user decision (`kf stage {feature} implementation`). If review has a current PASS report, the only next step is the human's merge on GitHub; `kf status` (or `kf sync`) then closes the item to `done` — a feature needs `phase-6-feature-report.md` first, which `kanban-review` writes at PASS. A PR closed without merge keeps the item in review: report it and ask. If already in done, validate and finish only missing closure work (`kanban-archive`); never implement again. Resume existing artifacts and tasks instead of recreating the item or approved plan. `kf status --all` includes backlog and done and ends with the `Needs you` and `Waiting to merge` buckets.

**Ownership:** a ledger line `driving` or `blocked` in `.kf/travel/progress.md` (when a travel day is running) means travel owns that item's drive; do not start a second `kf drive` or poll it — `kf drive` refuses a second one anyway. When the human opens a `blocked` item in this session, this session owns the fix until they say it is done; travel drives it again after that, not this session. If you are resuming mid-pipeline, skip straight to the phase skill for the current phase. **Never trust a folder location alone — a stage folder is not "done"; artifact + report completeness is.**

## Multi-agent harness

Two layers hand work off, and they do not overlap. **Runner roles** (`kf run`, `kf drive`) are whole headless sessions kf spawns per stage or per task from `harness.roles`; they are configured in `.kf/config.json` and kf supervises them. **In-session agents** (`scout`, `spec-reviewer`, `code-reviewer`) are subagents the phase skills dispatch from whatever session is running the skill — the main agent or a runner worker alike — for a bounded job with a fresh context and a short report back. A worker running `kanban-review` under `kf run` still dispatches `code-reviewer`; the harness decides *who runs the stage*, the skill decides *who reviews*.

If `.kf/config.json` has `harness.stages`, some stages are assigned to **roles**, each backed by a runner CLI. Before doing a stage's work yourself, read `kf status --change {feature} --json`: when `assignedRoles` is non-empty, you are the orchestrator for that stage — hand it off:

```bash
kf run {feature}            # blocking; runs the stage's whole role chain in order
kf run {feature} --detach   # long stages (implementation): returns a chain id
kf runs {feature}           # poll until the runs are done, then read their STATUS
kf run {feature} --role writer   # re-run one role of the chain
```

A stage can list several roles; they run one after another and each gets told where the previous one wrote. If a role does not finish `DONE`/`DONE_WITH_CONCERNS`, the chain stops there and the later roles never run — read the log of the role that stopped, do not simply re-run the chain. When polling a detached chain, a run marked `chain stopped 1/2` means the later roles never ran: the stage is **not** done even though nothing is running.

Then act on the worker's `STATUS:`: `DONE` → `kf validate --change {feature}` and decide the transition (gates, not the worker's word, decide); `DONE_WITH_CONCERNS` → read the concerns in the run log, then decide; `BLOCKED` / `NEEDS_CONTEXT` → stop and ask the user. A run without a `STATUS:` line or with a non-zero exit is not done. Never do an assigned stage yourself unless the user says so.

**Task harness (implementation):** when `harness.verify.stage` is set and worktrees are on, implementation is driven task by task. The plan's Task Breakdown supplies each task's Role and Files allowlist; `kf tasks {feature}` lists the tasks, `kf run {feature} --task TASK-###` makes one attempt (no auto-retry), and `kf drive {feature}` runs them detached, with kf committing, merging and verifying each result via the pinned `harness.verify` commands. `kf drive` needs the item in implementation (or testing/review, to resume), a current approval, `worktree.enabled: true` and `harness.verify.stage`. It stops at review PASS (the PR opened, CI watched) or with a stop code and the next command; a file outside a task's allowlist ends in `plan_change_needed` (edit the plan's Files, `kf approve`, `kf drive`). The drive verifies each task mechanically and runs no per-task reviewer; the whole-branch review at stage 6 is where the independent `code-reviewer` meets a driven item.

---

## Interaction policy

- User gives ONE command. Agent does everything else automatically.
- Brainstorm asks about **material ambiguity** only (missing scope, unclear behavior, conflicting acceptance criteria). Minor details → reasonable assumption, recorded in the spec.
- Confirm the requirement in Phase 1, then obtain execution-contract approval in Phase 2. Present a tight summary + implementation plan and ask for approval. On approval run `kf approve` (`kf approve --backlog` when the reply defers). Without approval, do not start autonomous execution.
- If scope must change after approval, stop implementation and explain the change. On the user's direction run `kf stage <feature> planning`, revise the contract and obtain fresh approval. REQUIREMENT_BUG blocks this route too; report it and await a human decision.
- Auto-fix benign blockers once. Stop + ask only when genuinely stuck.
- Never bypass a failed gate with `--force` unless the user explicitly approves.

---

## CLI reference

```text
kf init                        # scaffold .works/ + hooks + docs
kf doctor [--fix] [--json]     # diagnose the project; --fix applies the repairs needing no human decision
kf issues [view <n>|create|link|sync <feature>]  # GitHub issues on the configured repository, via gh
kf contexts [--json]           # declared contexts + counts, or a survey brief when none
kf new {feature} --context {ctx} [--type feature|bug]   # Phase 1: create feature/bug + seed spec
kf status --change {feature}   # artefact checklist + Next: + approval state
kf instruct {artifact} --change {feature}   # current execution id + exact output path
kf approve {feature} [--backlog]   # Phase 2 HITL gate: approve and start (implementation); --backlog defers
kf validate --change {feature}  # gate + traceability issues
kf stage {feature} {phase}     # move (gates + hooks run; planning → backlog/implementation)
kf run {feature} [--detach]    # run the roles assigned to the current stage (harness.stages), in order
kf runs {feature}              # worker run history (role, runner) + STATUS lines
kf tasks {feature} [--json]    # task harness: tasks parsed from the approved plan, with state
kf run {feature} --task TASK-### [--dry-run]   # one task attempt, no auto-retry
kf drive {feature} [--status|--watch|--stop] [--json]  # detached task-harness drive up to review PASS; --status / --watch show each worker's last action
kf archive {feature}           # explicit, idempotent close: merged-PR (or landing: none) check → review → done + docs + issue close + board + delivered stamp; kf status / kf sync run it after the merge
```

Contexts: a project may declare the ones it uses in `.kf/config.json`, and the first entry is the default. `kf new` refuses a context outside that list and names the nearest declared one; a case-only variant is refused too. Run `kf contexts --json` before `kf new` and use a declared name exactly. Never add a context to the config to get past a refusal — naming a business domain is the human's call.

Phase hooks: `<project>/.kf/hooks/{phase}.sh` run automatically before entering a phase (project → user `~/.kf/hooks` → package precedence). Exit non-zero blocks the transition (`--skip-hooks` bypasses). The agent does NOT run hooks manually — `kf stage` does. Hooks also receive `KFW_REPOSITORY` when `.kf/config.json` sets `repository`, and `KFW_PROJECT_*` when a `project` block (GitHub Projects board) exists; `kf init` can seed the generic sync pack into `.kf/hooks/`.

---

## Hard rules

- Do NOT ask "continue to next step?" — autonomous after the Phase 2 approval (`kf approve` starts the item).
- Obtain requirement confirmation and planning approval; after approval continue within the approved scope. The human's reply to the plan carries the start or the deferral (`kf approve` / `kf approve --backlog`) — never infer a deferral and never ask a second question about it. After review PASS the human merges the PR on GitHub; never ask how to close the item, and never merge it yourself.
- Never `mv` feature folders manually — always `kf stage` / `kf archive`.
- Never bypass a failed gate with `--force` unless the user explicitly approves. Every real bypass (`--force` on a failing gate, `--skip-hooks` on an existing hook) is recorded in `.kfw.json` and reported by `kf status`/`kf validate`.
- Always write `phase-4-testing-result.md` and `phase-5-review-report.md` — gates enforce it.
- FAIL/REJECT loops back to implementation and re-testing before review. REQUIREMENT_BUG → STOP, never rewrite the requirement. When the item should be dropped for good, **propose** `kf cancel {feature} --reason "<why>"` and let the user decide; never cancel on your own. Reopening later is `kf stage {feature} <the stage it was cancelled from>`.
- No scope creep beyond the approved plan. Hidden complexity upgrades the path; it never widens the contract silently.
- Follow the project's AGENTS.md and the user's permissions. Autonomous execution does not authorize unrelated changes, database operations, deployment or messages to others.
- Never silently swallow errors. If a step cannot complete and cannot be auto-fixed, STOP and report.
- The user's single command IS authorization for the full pipeline — up to the Phase 2 approval gate.

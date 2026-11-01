---
feature: drive-retire
context: harness
created: 20261101_0946
kind: feature
status: archived
---
# Spec Requirement

## Feature
drive-retire

## Objective
Make the in-session task loop the only way kanban-flow runs work. Remove the headless harness: `kf drive`, `kf run`, `kf runs`, `kf harness`, the runner roles and the per-task worktrees. Keep the mechanical checks the drive gave, exposed as one `kf verify` command the loop calls, and drop the plan's runner `Role` column. Rewrite `travel` so the travel session itself controls N items.

## Problem Statement
kanban-flow carries two ways to run an item.
- **Headless harness** — about 3,500 lines under `src/harness/` (supervisor, claims, control, watch, runner sessions, worker prompts, task pipeline) plus `kf drive`/`kf run`/`kf runs`/`kf harness`. It spawns `claude -p` workers the human cannot watch, and it has no per-task reviewer.
- **In-session task loop** — `kanban-implement` section 3. With harness-agents it gains test-writer → developer → code-reviewer seats. It is the path the human uses and trusts (memory: prefer in-session subagents, in-session primary path).

Every skill still carries `kf-run:` worker paragraphs, every doc explains both paths, and `travel` is written entirely around `kf drive`. The duplication costs review time on every change and confuses which path is real.

## Journey (what the user sees)
1. `kf drive`, `kf run`, `kf runs` and `kf harness` are gone: `kf -h` does not list them, and calling one prints the unknown-command error.
2. The human approves a plan. `Next:` points at the in-session implement skill, not at `kf drive`. The session runs the task loop. After each task's commit it runs `kf verify <feature> --task TASK-### --base <sha>`, which checks the files against the task's allowlist and runs `harness.verify.task`. Before testing it runs `kf verify <feature> --stage`.
3. The human says "travel". The morning plan works as today. After approval, the travel session keeps N items in flight at once, each in its own worktree, and runs each item's phases itself. It dispatches each item's seats (test-writer, developer, code-reviewer and the review seats) and switches between items. Each item's ledger lets it resume after compaction. Needs-you, waiting-to-merge and carry-over behave as today.
4. `kf doctor` reports leftover drive config keys (`harness.roles/stages/runners/main/parallel/retries/maxLoops/budget`) and leftover run/drive meta in a work item's `.kfw.json`. `kf doctor --fix` removes both; nothing else strips them.

## Scope
### In Scope
- Delete the commands `kf drive`, `kf run`, `kf runs` and `kf harness`, their args entries and help.
- Delete the code only they use: `src/harness/` except the `harness.verify` config parsing and the allowlist matcher `pathAllowed` (moved next to `kf verify`), `src/cli/commands/{drive,run,harness}.ts`, `src/worktree/tasks.ts` (per-task worktrees), the run/drive meta types and stop codes in `src/workflow/features.ts` (`drive`, `runs`, `sessions`, `tasks`), the drive-live and `run-in-progress` guards (archive, migrate, inspect, sync, status, doctor, cancel, transition), and the run metrics in `src/dashboard/dashboard.ts`. Delete the tests that cover only deleted code.
- Add `kf verify <feature> --task TASK-### --base <sha>` and `kf verify <feature> --stage`.
- Remove these keys from the config schema and `kf init`/autoconfig: `harness.main`, `harness.roles`, `harness.stages`, `harness.runners`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget`. Keep `harness.verify.task` and `harness.verify.stage`.
- `kf doctor` finds leftover keys and leftover run/drive meta; `--fix` removes them. No write-time migration.
- The plan's `Role` column: removed from the implementation-plan template and kanban-plan; `task_role_unknown`, `plannedRolesMissing` and kf tasks' role column go; a plan that still has a Role column parses with the column ignored.
- CLI output that names the drive: `kf approve` `Next:`, `kf inspect`, `kf autoconfig`.
- Skills:
  - remove every `kf-run:` worker paragraph and every `kf drive`/`kf run` hand-off;
  - kanban-implement calls `kf verify`;
  - kanban-review's "no subagent tool" fallback no longer says `kf run --role reviewer`;
  - rewrite travel (SKILL.md and references/estimation.md, ledger-format.md) for session-as-controller.
- Docs: README, Pages site, every `docs/workflow/*` page that mentions drive/run/runs/harness roles, and `.kf/config.json` of this repository.

### Out of Scope
- harness-agents content (agents, seat order): it must land first, and this feature builds on it.
- Parallel tasks inside one item. The loop stays sequential per worktree.
- New runtimes, or replacing headless runs with a cloud runner.
- Rewriting historical docs snapshots (`docs/requirement|use-cases|testplan`) and CHANGELOG history. Contradicted snapshots get the archive reconcile's `Superseded by` banner.

## Affected surfaces
- CLI: `kf -h` and `src/cli/args.ts` — `drive`, `run`, `runs` and `harness` removed, `verify` added.
- `README.md` — the harness, drive and travel sections.
- `.github/pages/index.html` — drive and harness mentions.
- `docs/workflow/harness.md`, `cli-reference.md`, `autoconfig.md`, `README.md`, `skills.md`, `gates.md`, `state-machine.md`, `lifecycle.md`, `artifacts.md`, `source-layout.md`.
- `src/dashboard/dashboard.ts` — run metrics removed.
- Skills: `kanban-flow` (SKILL.md, references/harness-tools.md), `kanban-implement` (SKILL.md, references/task-loop.md), `kanban-review` (SKILL.md, references/ci-watch.md), `kanban-test`, `kanban-plan`, `kanban-archive` (reconcile.md), `travel` (SKILL.md, references/estimation.md, references/ledger-format.md), and every skill's `kf-run:` paragraph.
- `kf init` seeded config and `kf autoconfig` checklist.
- CHANGELOG — one entry for the removal (breaking change).

## Actors
- Human operator
- In-session controller (kanban-flow / kanban-implement session)
- Travel session (controls N items)
- kf CLI

## Functional Requirements
### FR-001
- Requirement: `kf drive`, `kf run`, `kf runs` and `kf harness` no longer exist. `kf -h` does not list them, and invoking any of them exits non-zero with the CLI's unknown-command message.
- Priority: must

### FR-002
- Requirement: `kf verify <feature> --task TASK-### --base <sha>` lists the files changed in `<sha>..HEAD` of the item worktree. Any file outside that task's `Files` allowlist is printed, and the command exits 2. Matching keeps today's semantics of `pathAllowed` (`src/harness/task-pipeline.ts:52`: exact path, directory prefix, glob), moved next to `kf verify`. Otherwise it runs each `harness.verify.task` argv in the worktree, in order, and exits 0 when all pass, or exits 1 naming the first failing command with its exit code. When `harness.verify.task` is not configured, it does the allowlist check only and prints that no task verify is configured. Bad input — a TASK id the plan does not have, a `--base` that does not resolve or is not an ancestor of HEAD, a missing flag — exits 3 with the reason and runs nothing.
- Priority: must
- Notes: keeps the drive's mechanical allowlist and verify gate without its supervisor.

### FR-003
- Requirement: `kf verify <feature> --stage` runs each `harness.verify.stage` argv in the item worktree. It exits 0 when all pass, or 1 naming the first failure. When none is configured, it exits 0 and prints that nothing is configured.
- Priority: must

### FR-004
- Requirement: The kanban-implement loop calls `kf verify --task` after each task's commit, before the code-reviewer. Exit 2 is handled as a plan change: stop, edit the plan's Files and re-approve. Exit 1 goes back to the developer as a fix round. Exit 3 is the controller's own invocation error: it fixes the call and re-runs, never a fix round. The loop runs `kf verify --stage` once all tasks are complete, in place of the hand-run build gate when `harness.verify.stage` is configured.
- Priority: must

### FR-005
- Requirement: The config schema, `kf init` and `kf autoconfig` no longer know `harness.main`, `harness.roles`, `harness.stages`, `harness.runners`, `harness.parallel`, `harness.retries`, `harness.maxLoops` or `harness.budget`. A config that still has them loads: the keys are ignored, and `kf doctor` reports each one as a warning with the `--fix` remedy. `kf doctor --fix` removes them and keeps every other key with its value. Until then no other kf write (`kf init`, bootstrap) drops or rewrites them.
- Priority: must

### FR-006
- Requirement: Leftover run/drive meta in a work item's `.kfw.json` (`drive`, `runs`, `sessions`, `tasks`) is reported by `kf doctor` per item and removed only by `kf doctor --fix`. Every other command ignores it: no command refuses to act because of a leftover record (the `run-in-progress` and drive-live guards are gone).
- Priority: must

### FR-007
- Requirement: No skill carries a `kf-run:` worker paragraph, a `kf drive` or `kf run` hand-off, or an `assignedRoles` check. kanban-flow's "Multi-agent harness" section describes only the in-session agents. kanban-review's no-subagent fallback says the review cannot complete in that session and the human must be told. It does not say `kf run --role reviewer`.
- Priority: must

### FR-008
- Requirement: Travel runs as session-as-controller. After plan approval the travel session keeps up to `slots=N` started items, each in its own item worktree. For each item it runs the phase skills itself: implementation, testing and review with their seats. It advances one item while subagents of other items run in the background. Travel still never approves, archives, merges or pushes to main. Its ledger `.kf/travel/progress.md` and each item's `loop/progress.md` are enough to resume after compaction.
- Priority: must
- Notes: subagents cannot spawn subagents, so an item cannot be handed to a background controller agent; the travel session is the controller.

### FR-009
- Requirement: Travel's states and stop handling no longer read `kf drive --status`. A line is `driving` while the travel session is running that item's phases. It becomes `blocked` with the reason and the next command when a phase skill stops for the human (REQUIREMENT_BUG, a plan change, a fix-loop breaker). It becomes `waiting-to-merge` when review is PASS and the PR is open.
- Priority: must

### FR-011
- Requirement: The implementation plan has no `Role` column: the template, kanban-plan and `kf tasks` drop it, and `kf validate` no longer raises `task_role_unknown` nor doctor `plannedRolesMissing`. A plan written before, with a Role column, still parses and validates; the column is ignored.
- Priority: must

### FR-012
- Requirement: No CLI output names a removed command: `kf approve` prints `Next:` pointing at the implement skill, and `kf inspect` and `kf autoconfig` no longer mention drive, run, runs or harness roles.
- Priority: must

### FR-010
- Requirement: Every Affected surface describes only the in-session path. No document or skill mentions `kf drive`, `kf run`, `kf runs` or `kf harness` as a current command, except CHANGELOG history and archived snapshots.
- Priority: should

## Non-Functional Requirements
- The full suite stays green after the deletions. Tests that covered only deleted code are deleted with it, and no surviving test is weakened.
- Net source size shrinks. Report the `src/` line delta in the feature report.
- English only. Never name the external kit.
- Breaking change: CHANGELOG notes the removed commands, the removed config keys and the `kf doctor --fix` migration path.

## Main Use Cases
- UC-001 Verify a task and a stage with kf verify
- UC-002 Implement an item in session with kf verify gates
- UC-003 Run the day with travel as controller
- UC-004 Clean leftover drive config and state with kf doctor

## Constraints
- harness-agents (#110) must be merged before this item starts implementation: both rewrite `skills/kanban-implement/SKILL.md`.
- Skills are linked globally, so the change goes live in every project when the primary main moves. Other projects with drive config get warnings, not failures (FR-005).
- No database. No release or publish in this item.

## Assumptions
- No external user depends on `kf drive`/`kf run` beyond this repository's own owner. kanban-flow is open source, but the human accepts the breaking change.
- `kf tasks` (read-only task graph view) stays, minus drive state columns.
- The in-session loop keeps hand-maintaining `tasks.md` checkboxes and the `## Baseline`; kf no longer renders `tasks.md`.

## Acceptance Criteria
- [ ] `kf drive x`, `kf run x`, `kf runs x` and `kf harness` each exit non-zero with the unknown-command message, and `kf -h` lists none of them.
- [ ] `kf verify f --task TASK-001 --base <sha>` with a commit touching a file outside the task's Files exits 2 and prints that file.
- [ ] `kf verify f --task TASK-001 --base <sha>` inside the allowlist runs `harness.verify.task`. It exits 0 when every command passes and 1 naming the failing command.
- [ ] `kf verify f --stage` runs `harness.verify.stage` and exits with the same 0/1 rule. With none configured it exits 0 and says so.
- [ ] A config with `harness.roles` loads. `kf doctor` warns about each drive key, and `kf doctor --fix` removes them and keeps `harness.verify`.
- [ ] A work item `.kfw.json` with a drive block is reported by `kf doctor` and loses the block after the migration. `kf archive` and `kf status` work on it.
- [ ] `src/harness/` holds no supervisor, run, session, prompt or claim code, and `src/worktree/tasks.ts` is gone.
- [ ] `grep -rnE "kf (drive|run|runs|harness)\b"` over skills/, README.md, .github/pages/ and docs/workflow/ returns only lines that say the commands were removed.
- [ ] skills/travel/SKILL.md never calls `kf drive`, and it describes the session-as-controller loop with N slots.
- [ ] kanban-implement calls `kf verify --task` after each task commit and `kf verify --stage` before testing, and handles exits 1, 2 and 3 as FR-004 says.
- [ ] `kf verify` with an unknown TASK id or a non-ancestor `--base` exits 3 and runs no command.
- [ ] `grep -rnE "kf-run:|assignedRoles"` over skills/ returns nothing; kanban-review's no-subagent fallback says the review cannot complete and the human is told, without `kf run`.
- [ ] skills/travel/SKILL.md defines `driving`, `blocked` and `waiting-to-merge` without `kf drive --status`, and says the session dispatches an item's subagents in the background and advances another item while they run.
- [ ] A plan with a Role column validates; the template and kanban-plan have no Role column; `kf tasks` shows no role.
- [ ] `kf approve` on a freshly planned item prints a `Next:` without `kf drive`; `kf inspect` and `kf autoconfig` output name no removed command.
- [ ] `kf init` on a config with `harness.roles` keeps the key until `kf doctor --fix`.

## Edge Cases
- An item with a live drive or detached run from before the upgrade: no supervisor exists to stop it. The `kf doctor` report shows `drive.supervisorPid` and each live `runs[].pid` and tells the human to stop the process; kf does not kill it.
- `kf verify --task` with a `--base` that is not an ancestor of HEAD, or a TASK id the plan does not have: exit 3 with the reason, and never a pass.
- A task whose Files cell is empty (files unknown): the allowlist check is skipped and the output says so, and the verify commands still run.
- `kf verify` on an item with no worktree runs in the project root and says so.
- Travel with `slots=1` behaves like a single kanban-flow session.
- Travel context compaction mid-item: resume reads `.kf/travel/progress.md`, then that item's ledger. No item is restarted from scratch.
- A project whose config only has `harness.verify` sees no doctor warning.

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`, `src/tests/*.test.ts`); integration tests drive the real `kf` CLI against temp git repos as the existing tests do
- Coverage Target: 80%

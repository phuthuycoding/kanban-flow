---
feature: task-harness
context: harness
created: 20261024_1055
kind: feature
status: archived
---
# Spec Requirement

## Feature
task-harness

## Objective
Turn the kf harness from a stage-level tool the main agent operates into a real harness: after the human approves a plan and chooses to start, `kf drive` runs the item through implementation → testing → review on its own — dispatching the plan's tasks as a dependency graph, in parallel where safe, each to the role the plan declared, verifying each result with human-pinned commands — and stops only at a human gate or a stop condition it can name.

## Problem Statement
Today the harness maps `stage → role chain → runner` and runs one worker per role for a whole stage, sequentially. The main agent still drives everything: it calls `kf run`, reads the STATUS line, runs `kf validate`, decides `kf stage`, and must stay alive for the whole pipeline. Inside implementation, task splitting and agent choice live only in skill prose (`kanban-implement` section 3), so they are neither reproducible nor enforced. "Done" is the worker's word: kf never runs the build or tests itself (BACKLOG:13). There is no lock on `.kfw.json`, so concurrent writers would trample each other (BACKLOG:27). The owner wants one standardized, professional workflow where the pipeline after approval runs deterministically and the same plan produces the same dispatch.

Framework used — First Principles:
- Fundamental truths: (1) the human owns requirement, approval, start, and ship decisions; (2) a task's result counts only when an independent check passes; (3) parallel writers need isolation and serialized merges; (4) state lives in files, so any process may crash and resume.
- Questioned assumptions: "the main agent must orchestrate" → no, orchestration after start is mechanical and belongs to kf; "agents pick the best agent" → rejected again (agent-roles decision): the plan declares it and approval fingerprints it; "kf may not run commands" → it may, when the commands are pinned in `.kf/config.json` by a human and never read from agent-written artifacts.
- Rebuilt shape: approved plan task table (with `Role`, `Files`) → DAG scheduler → isolated task worktrees → pinned verify → serialized merge → existing stage gates → stop at the ship gate.

## Scope
### In Scope
- Structured task table in the implementation plan (`Role`, `Files` columns added to Task Breakdown), parsed and validated by kf.
- `kf tasks <feature>` — task DAG with per-task state.
- `kf run <feature> --task TASK-###` — run a single task with its declared role.
- DAG scheduler with bounded parallelism and file-overlap serialization.
- Per-task git worktrees branched from the item branch; kf commits a verified task result and merges it back, one merge at a time.
- Pinned verification commands in `.kf/config.json` (`harness.verify`) run by kf, per task and per stage.
- Bounded task retries and bounded test/review repair loops.
- `kf drive <feature>` — detached, resumable driver from implementation to the ship gate, with `--status` and `--stop`.
- Per-item lock around every `.kfw.json` read-modify-write.
- Allowlist enforcement: a task that changes files outside its `Files` fails.
- Run budget (max worker runs per drive) and an optional `drive-stop` hook for notification.
- Skill, template, and doc updates so the workflow is the documented standard.

### Out of Scope
- Agents choosing a role or agent by capability at runtime — rejected for reproducibility (agent-roles decision, kept).
- The async inbox bridge between agents (BACKLOG:22) — the driver is a supervisor process, not agent-to-agent messaging.
- Driving several items in one coordinated schedule — each item has its own drive; items do not share a scheduler.
- Performing the start decision or the ship decision automatically — `kf drive` starts only from `implementation` and stops at the ship gate.
- Auto-merge to the default branch or automatic shipping.
- Ad-hoc `kf run --task "<description>"` outside the plan (BACKLOG:24) — `--task` here takes only a planned `TASK-###`.
- A dashboard UI for drives.
- Remote or cloud runners.

## Affected surfaces
- CLI `-h` / `kf help`: new `kf drive`, `kf tasks`, `kf run --task`; `kf runs` gains a task column.
- `.kf/config.json` schema: `harness.verify`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget`.
- Template `kanban-flow/templates/phase-2-implementation-plan.md` (Task Breakdown columns).
- Skills: `kanban-plan` (write Role/Files), `kanban-implement` (task-worker mode; replace runtime agent-picking prose), `kanban-flow` (use `kf drive` after the start decision).
- `kf doctor` (harness verify / driver readiness checks) and `kf init` seed.
- Hooks: new `drive-stop` event, documented in `docs/workflow/autoconfig.md`; not seeded into `.kf/hooks/` (opt-in).
- Docs: `docs/workflow/harness.md`, `cli-reference.md`, `lifecycle.md`, `state-machine.md`, `gates.md`, `skills.md`.
- `README.md` quick-start.
- `CHANGELOG.md`.
- npm package contents (templates, skills shipped).

## Actors
- Owner / operator: writes the requirement, approves the plan, chooses start, pins verify commands and roles in `.kf/config.json`, makes the ship decision.
- Main agent (role `harness.main`): brainstorms and plans with the human, then hands the item to `kf drive`.
- kf driver: detached supervisor process that schedules tasks, runs verifies, merges, moves stages, and stops.
- Worker agent: a headless runner CLI executing one task or one stage role.

## Functional Requirements
### FR-001
- Requirement: The implementation plan's Task Breakdown table carries `Role` and `Files` columns. `kf validate` parses it and reports an ERROR for: a duplicate `TASK-###` id (`task_duplicate`); a dependency naming a task that does not exist (`task_dep_missing`); a dependency cycle, including a self-dependency, naming the cycle as `TASK-002 → TASK-003 → TASK-002` (`task_dep_cycle`); a `Role` that is neither `-` nor a key of `harness.roles` (`task_role_unknown`). Ids are compared upper-cased. A Dependencies cell of `-`, `—`, `none`, `n/a` or empty means no dependencies; otherwise every `TASK-###` token in the cell is a dependency and other text is ignored. A task with an empty or missing `Files` cell, or a plan with no Role/Files columns, is valid: role `-`, files unknown. A Task Breakdown section with no table yields zero tasks and no ERROR.
- Priority: must
- Notes: The plan file is already fingerprinted by approval, so the DAG and role assignment become part of the approved contract — same plan, same dispatch.

### FR-002
- Requirement: `kf tasks <feature> [--json]` lists every planned task with its id, role (resolved), dependencies, files, wave number (longest dependency depth), and state: `pending | ready | running | verifying | merging | done | failed | blocked`, plus the reason for `failed`/`blocked`; it exits 1 and prints the graph ERRORs when the graph is invalid. Task state is stored in `.kfw.json`; `tasks.md` is rendered from it with one checkbox per task (ticked only when `done`) and a `## Baseline` section — the item branch HEAD sha and `git status --porcelain` of the item worktree — that kf writes when the first task run or drive starts and keeps byte-identical on every re-render.
- Priority: must
- Notes: One source of truth for progress; the dashboard's existing tasks.md counting keeps working.

### FR-003
- Requirement: `kf run <feature> --task TASK-###` runs exactly that task once with its resolved role's runner, in the task's worktree. The worker prompt names the task, its FR/UC references, expected output, the `Files` allowlist, absolute paths to the work item folder, and the existing STATUS contract. It refuses (exit 1, nothing created) when: the id is unknown; a dependency is not `done`; the item is not in `implementation` or its approval is not current; `worktree.enabled` is not true; the same task already has a live run. `--task` cannot be combined with `--stage`, `--role` or `--detach`; with `--dry-run` it prints the prompt and plan without running. A manual run never retries on its own: a failure leaves the task `failed`, and running it again counts as the next attempt and resumes the task's session.
- Priority: must
- Notes: Manual entry point and the unit the driver schedules.

### FR-004
- Requirement: Role resolution for a task: the plan's `Role` when it names a declared role; for `-`, the first role of `harness.stages.implementation`; when that is empty, `harness.main`. Stage roles in the driver resolve the same way: `harness.stages.<stage>` first, else `harness.main`.
- Priority: must
- Notes: Deterministic, never a runtime guess.

### FR-005
- Requirement: The scheduler runs every `ready` task (all dependencies `done`) concurrently, up to `harness.parallel` (default 3). Two tasks whose `Files` patterns overlap never run at the same time, and a "files unknown" task runs alone. Overlap is decided conservatively on declared patterns: two patterns overlap when they are equal, when one is a directory prefix of the other, or when the static prefixes before the first glob character (`*`, `?`, `[`) of either are prefix-related; `**`, `*` and `.` overlap everything. The single-active-run rule of today's `kf run` becomes: one drive per item, one live run per task id, and a stage-level `kf run` is refused while a drive or task run of the item is live.
- Priority: must
- Notes: Overlap is decided on the declared patterns before running; actual changes are checked in FR-007.

### FR-006
- Requirement: The task harness requires `worktree.enabled: true`. Each running task gets its own task worktree and branch cut from the item branch's current HEAD. When `worktree.enabled` is not `true`: `kf drive` and `kf run --task` refuse before doing anything, naming the setting to change in `.kf/config.json`; `kf validate` on an item in `planning` or `backlog` of a project that opted into driving (`harness.verify.stage` set) reports a WARNING that the task harness cannot start until worktrees are enabled; and the `kanban-flow` skill checks this at the start-now/backlog decision and asks the human to enable worktrees before starting a harness drive.
- Priority: must
- Notes: No silent sequential fallback on the user's main checkout — the human learns before the start decision, not after.

### FR-007
- Requirement: After a task worker finishes `DONE` or `DONE_WITH_CONCERNS`, kf (a) blocks the task — no retry — when the worker changed any path outside its `Files` allowlist, naming the paths (checked in the task worktree before anything is committed); because the approved plan's `Files` must change, which needs a plan edit and re-approval, a drive stops with code `plan_change_needed`, naming the task, the paths, and the next step (edit the plan, `kf approve`, `kf drive`); (b) after the merge of FR-008, runs `harness.verify.task` commands in the item worktree and, on a non-zero exit, resets the item branch to its pre-merge commit and fails the task, keeping the output tail. A task is `done` only after both pass. A worker STATUS alone never marks a task done.
- Priority: must
- Notes: "files unknown" tasks skip check (a) only. Verify runs in the item worktree, not the task worktree, because a fresh task checkout has no installed dependencies (the item worktree's `worktree-create` hook installed them) and because it checks the integrated result. Amended during planning.

### FR-008
- Requirement: A task's changes that pass the allowlist check are committed by kf on the task branch (`task(TASK-###): <description>`) and merged into the item branch one merge at a time; the merge is kept only if FR-007 (b) passes. kf refuses to merge while tracked files in the item worktree have uncommitted changes, and marks the task `blocked` with that reason; untracked files do not count — when a merge would overwrite an untracked file, git refuses and the task is `blocked` with git's message. A merge conflict marks the task `blocked` with the conflicting paths and leaves its branch for the human; unrelated tasks continue. Task worktrees are removed after a successful merge; branches of failed or blocked tasks are kept. Task branch and worktree names are siblings of the item's (`<item-branch>--task-###` and `<baseDir>/<feature>.tasks/task-###`, lower-cased), because git cannot hold `<item-branch>/<task>` next to `<item-branch>`. `kf worktree list` does not report them as orphans, and `kf archive` / `kf cancel` remove clean task worktrees and refuse on dirty ones like the item worktree.
- Priority: must
- Notes: Workers still never commit (existing contract); kf commits because it verified the result.

### FR-009
- Requirement: Verification commands come only from `harness.verify` in `.kf/config.json` (`task: string[][]`, `stage: string[][]`, each a non-empty argv array run without a shell). Validation rejects with the field named: a non-array value, an empty argv, an empty string element, an argv whose first element starts with `-`, and any element containing `{` … `}` placeholder syntax. kf never executes a command read from an artifact, a report, or worker output.
- Priority: must
- Notes: Resolves BACKLOG:13 safely — the agent cannot edit what kf executes. Config edits are a human action.

### FR-010
- Requirement: Task outcomes: a worker `STATUS: BLOCKED` or `NEEDS_CONTEXT` makes the task `blocked` at once with the worker's summary — no retry — and stops the driver (FR-012). An allowlist violation makes the task `blocked` at once with no retry (FR-007). Any other failure — non-zero exit, timeout, missing STATUS line, verify failure, failed kf commit — makes the task `failed`. Under the driver a `failed` task gets up to `harness.retries` (default 1) repair runs that resume the same task session with the failure reason (allowlist paths or verify output tail); when no retry remains (including `retries: 0`) it becomes `blocked`. Tasks that depend on a `blocked` task stay `pending` and are reported as blocked by it. When nothing can progress the driver stops with reason `tasks_blocked`.
- Priority: must

### FR-011
- Requirement: `kf drive <feature>` refuses (exit 1, nothing written) and names the human step needed unless: the item is in `implementation`, or it is in `testing` or `review` with a stored stopped drive of that item (resume); its approval is current; `worktree.enabled` is true; `harness.verify.stage` is set; no drive of the item is live. It then loops: run the task DAG to completion → run `harness.verify.stage` → `kf stage testing` (normal gates and hooks) → testing role(s) → `kf validate` → on PASS `kf stage review` → review role(s) → `kf validate` → on PASS stop with result `ready` and "ready for ship decision". For a `kind: bug` item, which has no plan task table, the implementation step is one run of the implementation stage role(s) in the item worktree (no task DAG), followed by the same verify and stages.
- Priority: must
- Notes: Start and ship gates stay human; the driver never passes `--force` or `--skip-hooks`.

### FR-012
- Requirement: On a FAIL/REJECT testing or review report, the driver moves the item back to implementation, runs one repair run of the implementation role pointed at the report (existing repair-loop prompt), runs `harness.verify.stage`, and re-enters testing. The driver stops at the next step boundary — no new run starts; runs already in progress finish and their results go through the normal pipeline — with a stop code and a one-line reason when: `harness.maxLoops` (default 2) repair loops are used (`loop_limit`); a report says REQUIREMENT_BUG (`requirement_bug`); a worker returns BLOCKED or NEEDS_CONTEXT (`worker_blocked`); a task touched files outside its allowlist (`plan_change_needed`); no task can progress (`tasks_blocked`); `harness.verify.stage` fails (`verify_failed`); a stage transition is refused or its hook fails (`transition_refused`); the approval fingerprint changes (`approval_changed`); `harness.roles`, `harness.runners`, `harness.verify` or `worktree.enabled` differ from their hash at drive start (`config_changed`); the run budget is exhausted (`budget`); `--stop` was used (`stopped_by_user`); or a git step that leaves the item branch in an unknown state fails — `merge --abort` or the reset to the pre-merge commit — (`git_error`, the task is `blocked` with git's message). A stop for a running supervisor whose pid is dead is reported as `crashed`.
- Priority: must

### FR-013
- Requirement: `kf drive` detaches by default and survives the caller's exit. Its state (current step, loop count, run count, stop code and reason, config hash) is stored in `.kfw.json`. `kf drive <feature> --status` prints the state, running tasks, and — when stopped — the stop code, the reason and the exact next command. `kf drive <feature> --stop` terminates the supervisor and its workers and keeps every worktree and branch. Re-running `kf drive` resumes from the stored state without re-running `done` tasks; `failed` and `blocked` tasks are reset to `pending` with their attempt count cleared, on the assumption that the human fixed the cause; the config hash is re-taken. Two `kf drive` calls for the same item, concurrent or not, start at most one drive; the other is refused naming the live one.
- Priority: must

### FR-014
- Requirement: Every read-modify-write of an item's `.kfw.json` (stage, approve, cancel, archive, issues, ship, worktree, run records, sessions, task state, drive state) holds a per-item lock file under `.works/.locks/<feature>.lock` containing the holder's pid. A lock whose pid is dead is taken over; a live lock is waited on for up to 30 seconds and then fails naming the holder pid. The lock is held only around the re-read, the write and — for stage moves — the folder rename, never across hooks or worker runs. A run record that reached `done`, `failed`, `timeout` or `reset` is never set back to `running` by a later write.
- Priority: must
- Notes: Required now that parallel workers and a supervisor write concurrently (BACKLOG:27 start condition met). Expected to also remove the BACKLOG:19 stale-record race if that is its cause — not assumed.

### FR-015
- Requirement: `harness.budget.maxRuns` (default 30) caps worker runs per drive, counting retries and repair runs; reaching it stops the driver with the count.
- Priority: should
- Notes: A cost cap in USD is not required because only some runners report cost.

### FR-016
- Requirement: Whenever the driver stops (success at the ship gate or any stop condition), it runs `.kf/hooks/drive-stop.sh` when present, with `KFW_DRIVE_RESULT` (`ready | stopped`) and `KFW_DRIVE_REASON` on top of the standard hook environment. Hook failure is a warning.
- Priority: should
- Notes: Lets the owner get a notification without kf owning a notifier.

### FR-017
- Requirement: `kf runs` shows the task id for task runs, and the driver appends one JSON line per event (task state change, verify result, merge, stage move, stop) to `runs/drive-<id>.jsonl` in the item folder.
- Priority: should

### FR-018
- Requirement: `kf doctor` reports, when at least one stage is assigned in `harness.stages`: missing `harness.verify.stage` (WARNING — `kf drive` refuses to start without it); a role used by a planned task of an open item that no longer exists (ERROR, naming item and task); task worktrees with no live drive or run, and lock files whose pid is dead (WARNING, each with the cleanup command).
- Priority: should

### FR-019
- Requirement: Skills and templates carry the standard: the implementation-plan template has the `Role` and `Files` columns; `kanban-plan` fills them; `kanban-implement` has a task-worker mode (prompt names one `TASK-###`) and drops runtime agent-picking in favour of the plan's role; `kanban-flow` hands an item to `kf drive` after the start decision when a harness is configured, and otherwise keeps the current manual flow.
- Priority: must
- Notes: Reverses the "pick the agent that fits" prose added in PR #69 for the harness path.

## Non-Functional Requirements
- No new runtime dependencies; Node standard library and git only.
- Crash safety: killing the supervisor at any point leaves state from which `kf drive` resumes or `--status` explains what to clean up; no task is reported `done` without its merge.
- Every stop prints one reason and one next command.
- Default limits are conservative (parallel 3, retries 1, maxLoops 2, maxRuns 30) and all are configurable.
- Existing behaviour without a harness, and `kf run` without `--task`, are unchanged.
- macOS and Linux supported; Windows keeps the existing detached-spawn behaviour, untested.

## Main Use Cases
- UC-001 Plan declares a task DAG with roles and files; validate catches bad graphs
- UC-002 Inspect the task graph and progress (`kf tasks`)
- UC-003 Run one planned task by hand (`kf run --task`)
- UC-004 Drive an approved item from implementation to the ship gate with parallel tasks
- UC-005 Task fails verification or the allowlist, retries, then blocks the drive
- UC-006 Task merge conflicts with a concurrent item-branch commit
- UC-007 Testing or review fails and the driver runs bounded repair loops
- UC-008 Stop, crash, and resume a drive
- UC-009 Operator configures verify commands, limits, and the drive-stop hook

## Constraints
- Human gates (requirement confirm, approval, start/backlog, ship) are never automated.
- No `--force` / `--skip-hooks` from the driver.
- Commands kf executes come only from `.kf/config.json`.
- Workers keep the existing contract: no `kf stage/approve/archive/run`, no commits, STATUS lines.
- The task harness requires `worktree.enabled: true`; there is no fallback mode without it.

## Assumptions
- Plans approved before this feature (no `Role`/`Files` columns) still drive: every task gets role `-` and "files unknown", so they run sequentially.
- The item branch is the item's worktree branch.
- A task commit message uses the task's Description column, truncated to 72 characters.
- Task sessions are fresh per task and resumed only for that task's retries; stage-role sessions keep the existing per-item-per-role rule.
- Detection of out-of-allowlist changes uses `git status --porcelain` plus diff against the task branch base, including untracked files.

## Acceptance Criteria
- [ ] `kf validate` reports a cycle `TASK-002 → TASK-003 → TASK-002`, a dangling dependency, a duplicate id, and an unknown role as separate ERRORs.
- [ ] `kf tasks <f> --json` returns each task's resolved role, wave, and state; `tasks.md` matches it.
- [ ] `kf run <f> --task TASK-002` refuses while TASK-001 (its dependency) is not done, and runs once it is.
- [ ] With parallel 3 and four independent tasks with disjoint files, at most and at some moment exactly three workers run at the same time; two tasks sharing a file never overlap in time; a `**` task runs alone.
- [ ] With `worktree.enabled: false`, `kf drive` and `kf run --task` exit 1 naming `worktree.enabled` and change nothing; `kf validate` on the item in planning shows the WARNING.
- [ ] A worker that edits, renames or deletes a file outside its allowlist leaves the task `blocked` naming that file, even with `STATUS: DONE`, with no retry; under a drive, no new run starts and the drive stops with `plan_change_needed`.
- [ ] An untracked file in the item worktree does not block a merge; a modified tracked file does.
- [ ] A task whose verify command exits 1 is retried once with the output tail, then `blocked`; its dependents are reported blocked by it.
- [ ] A task whose change conflicts with a commit made to the item branch while it ran is marked `blocked` with the conflicting path; its branch remains and no merge is left in progress.
- [ ] `kf drive` on an item in planning or backlog refuses and names the approve/start step.
- [ ] An approved item with passing fake workers ends in `review` with a PASS report and `kf drive --status` saying "ready for ship decision"; nothing was shipped or archived.
- [ ] A FAIL testing report triggers one repair loop; a second FAIL after `maxLoops: 1` stops the drive with the reason.
- [ ] Killing the supervisor mid-task and re-running `kf drive` does not re-run `done` tasks.
- [ ] Two processes writing run records to the same `.kfw.json` concurrently lose no record.
- [ ] Reaching `budget.maxRuns` stops the drive with the run count.
- [ ] `drive-stop.sh` receives `KFW_DRIVE_RESULT` and `KFW_DRIVE_REASON`.
- [ ] `kf drive` refuses to start when `harness.verify.stage` is missing.
- [ ] While task TASK-001 runs, `kf run --task TASK-002` for another ready task is accepted, and a stage-level `kf run` is refused.
- [ ] `harness.verify` with `[["-rf"]]` or `[["npm","{x}"]]` is rejected naming the field.
- [ ] A task whose merged result fails `verify.task` leaves the item branch at its pre-merge commit.
- [ ] Editing `harness.verify` in `.kf/config.json` while a drive runs stops the drive at its next step boundary with code `config_changed`.
- [ ] A `kind: bug` item drives through one implementation-role run, verify, testing and review without a task table.
- [ ] `kf worktree list` does not list a running task's worktree as an orphan; `kf archive` removes clean task worktrees.

## Edge Cases
- Dependency cycle, self-dependency, dependency on a task id with different casing.
- A dependency of a task ends `blocked`; dependents must never start.
- All remaining tasks blocked → driver stops instead of spinning.
- A `Files` pattern of `**` or `.` → effectively serial.
- A worker deletes or renames files (allowlist checks both old and new paths).
- The human commits to the item branch while a drive runs → the next merge sees the new HEAD; a conflict blocks only that task.
- Approval fingerprint changes mid-drive (someone edits the plan) → stop.
- Supervisor killed during a merge → resume detects the half-finished merge, aborts it, and retries the merge once.
- A stage hook refuses the transition → stop with the hook's output.
- A verify command not found on PATH → task `failed` with that message, not a crash.
- `worktree.enabled` flipped to `false` while a drive is running → the drive finishes its running tasks, then stops with that reason.
- Two `kf drive` calls racing → exactly one wins the lock; the other is refused.
- A stale lock left by a dead pid is taken over.
- The machine sleeps; timeouts are per run (existing `--timeout`), not wall-clock for the whole drive.

## Open Questions
- None blocking. Defaults (parallel 3, retries 1, maxLoops 2, maxRuns 30) are recorded as assumptions the owner may change at confirmation.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`npm test`), fake runner CLIs in `src/tests/helpers/fake-cli.ts`, real git repos in temp dirs for worktree/merge tests
- Coverage Target: 80%

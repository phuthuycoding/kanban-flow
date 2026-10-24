---
name: kanban-implement
description: 'Implement an approved kanban feature or bug, track tasks and verify the build. Use in implementation, or after an explicit start decision from planning/backlog or a FAIL/REJECT repair loop.'
---

# Kanban Phase 3 — Implement (Autonomous)

Argument: `<feature_name>`.

Execute the approved implementation plan for a feature, or the approved bug report's fix scope and regression strategy for a bug. If implementation requires a scope change, explain it and obtain the user's decision before revising the contract.

**Invoked through `kf run`?** If your prompt starts with `kf-run:`, you are a worker for this stage only: skip the "move to stage" step below, never run `kf stage` / `kf approve` / `kf archive` / `kf run`, never edit approved contract artifacts, do not commit, and end your final message with two lines exactly: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and `Summary: <one or two sentences>`. The main agent reads them and decides the transition.

**Task worker:** if your prompt starts with `kf-run:<id> TASK-###`, you implement exactly that one task and nothing else. Only touch files in its allowlist; if you need another file, stop with `STATUS: BLOCKED` and say which file and why. Do not edit tasks.md, do not commit (kf commits, merges and verifies), and end with the STATUS lines above.

---

## 1. Move to implementation

Read `kf status --change {feature_name}`. Move only when coming from planning or backlog with a valid approval, or when a FAIL/REJECT report requires a loop. If already in implementation, skip the move and resume existing tasks. If approval changed, stop and return to planning on the user's direction. Entering implementation from backlog requires the user's explicit start decision.

```bash
kf stage {feature_name} implementation
```

**Worktree:** when the project opted in with `worktree.enabled: true`, entering implementation provisions a git worktree + a `.<tld>` domain for the item — `kf status --change {feature_name}` prints `Worktree:` (path), `Domain:` (`http://<feature>.<baseDomain>`) and the direct `127.0.0.1:<port>` fallback. **All code work happens inside that worktree on its branch (`<prefix>/<feature>`, printed as `Worktree: … (branch …)`) — never on the user's main checkout.** Commit your changes there; the merge back is the human's call, not yours. `.works/` artifacts and `kf` commands keep working from inside the worktree (project root resolves through the git common dir). If domain DNS is not set up on the machine yet, the direct `127.0.0.1:<port>` URL always works; `kf worktree setup` (sudo, once) fixes the domain. A project `worktree-create.sh` hook may already have installed deps and seeded `.env` — check before re-installing.

Create tasks.md if missing: `- [ ] 1. ...` checkboxes mapping tasks to the approved test cases for a feature, or reproduction/acceptance/regression scope in the bug report for a bug. Preserve completed tasks on resume; add the required fix tasks when looping. Record the starting HEAD and pre-existing working-tree changes in a `## Baseline` section at the top of `tasks.md` so review can distinguish this work item's changes (under a `kf drive`, kf writes it). When a worktree exists, the baseline HEAD is the worktree branch's branch point, recorded from inside the worktree.

## 2. Hand off to the harness, if configured

Skip this section when your prompt starts with `kf-run:` — you are already the worker.

After the move, read `kf status --change {feature_name} --json` and `.kf/config.json`.

**Drive configured** (`harness.verify.stage` set and `worktree.enabled: true`): hand the item to the task harness. kf, not a worker, commits, merges and verifies each task result, and it writes the `## Baseline` section of tasks.md.

```bash
kf drive {feature_name}            # detached; runs the approved TASK-### rows
kf drive {feature_name} --status   # monitor; add --json for machine-readable output
kf drive {feature_name} --stop     # stop on the human's request
```

The drive stops at the ship gate with "ready for ship decision" — continue at section 4 and the testing hand-off. Every stop prints a reason and the next command. Act on the stop code:

| Stop code | What to do |
|---|---|
| `loop_limit` | Read the failing task's log; fix the cause or ask the human before re-driving |
| `requirement_bug` | Stop; report it and await a human decision (never rewrite the requirement) |
| `worker_blocked` | Read the worker's `BLOCKED` reason; resolve it or ask the human |
| `plan_change_needed` | A task needed a file outside its Files: edit the plan's Files, `kf approve`, then `kf drive` |
| `tasks_blocked` | Read which tasks are blocked and why; unblock them or ask the human |
| `verify_failed` | Read the `harness.verify` output; fix the cause, then `kf drive` again |
| `transition_refused` | Read the refused gate, fix what it names, then re-drive |
| `approval_changed` | The contract changed: return to planning for human approval |
| `config_changed` | Config changed mid-drive: confirm with the human, then re-drive |
| `budget` | Budget spent: ask the human whether to continue |
| `stopped_by_user` | Wait for the human's decision |
| `crashed` | Read the drive log; ask the human before re-driving |
| `git_error` | Inspect the worktree git state; fix it or ask the human |

To run a single task: `kf tasks {feature_name}` lists them, `kf run {feature_name} --task TASK-### [--dry-run]` makes one attempt with no auto-retry.

**No drive, but `assignedRoles` is non-empty:** the project's harness assigned implementation to those roles; you are the orchestrator, not the implementer:

```bash
kf run {feature_name} --detach   # implementation is long; returns a chain id
kf runs {feature_name}           # poll until done, then read each run's STATUS
```

`DONE` → continue at section 4 (build gate) to verify the worker's result yourself; `DONE_WITH_CONCERNS` → read the concerns in the run log first; `BLOCKED` / `NEEDS_CONTEXT`, a missing `STATUS:` line or a non-zero exit → stop and ask the user.

**Otherwise** implement it yourself (sections 3 and 4).

## 3. Work by dependency order

- Independent tasks → **parallelize via subagents**.
- Sequential / dependent tasks → main agent.

When your runtime offers subagents, dispatch independent tasks to general-purpose subagents (or a specialized agent type whose description matches the task). Role choice for harness runs is the plan's Role column. No subagent tool → do the task yourself in the same order.

**Subagent prompt contract** — every subagent prompt must state:

- Task: the exact task + the TC it must satisfy
- Files to read: plan excerpt, reference files, repo conventions
- Files it may modify: explicit allowlist — nothing else
- Acceptance criteria: what "done" means, verifiable
- Constraints: no contract changes, no unrelated edits
- Context: `.works/implementation/{feature}/` path (and reports path when applicable)

**Subagent status protocol** — require every subagent to end with:

```text
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Summary: one or two sentences
Concerns/Blockers: (optional)
```

Treat `DONE_WITH_CONCERNS` and `BLOCKED` as not-done: resolve the concern or unblock before ticking the task.

## 4. Tick tasks as they land; gate on build

```bash
{build_command}
```

- PASS → continue.
- FAIL → analyze, fix, re-run.
- Failed again → STOP, show error, ask.

When all tasks ticked, run the FULL build (not just the touched module).

Do not modify the approved requirement, plan or test-case contract. Project-specific permissions for database operations and other external actions still apply.

---

## Done

All tasks done, build green, no test regressions. Hand off:

```text
Load the kanban-test skill and move the feature to testing.
```

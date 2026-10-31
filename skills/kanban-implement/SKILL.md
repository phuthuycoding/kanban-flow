---
name: kanban-implement
description: 'Implement an approved kanban feature or bug: hand the item to kf drive when a task harness is configured, otherwise run the subagent-driven task loop — a fresh implementer per task, an independent task review, a bounded fix loop and a ledger — then verify the build. Use in implementation, or after an explicit start decision from planning/backlog or a FAIL/REJECT repair loop.'
---

# Kanban Phase 3 — Implement (Autonomous)

Argument: `<feature_name>`.

Execute the approved implementation plan for a feature, or the approved bug report's fix scope and regression strategy for a bug. If implementation requires a scope change, explain it and obtain the user's decision before revising the contract.

**You are the controller, not the implementer.** The plan is executed by fresh subagents with isolated context, each reviewed by another fresh subagent before its work cascades into the next task. Your context stays for coordination: the ledger, the briefs, the rulings. Fixing a finding yourself pollutes that context and skips review.

**Invoked through `kf run`?** If your prompt starts with `kf-run:`, you are a worker for this stage only: skip the "move to stage" step below, never run `kf stage` / `kf approve` / `kf archive` / `kf run`, never edit approved contract artifacts, do not commit, and end your final message with two lines exactly: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and `Summary: <one or two sentences>`. The main agent reads them and decides the transition. You still run section 3's task loop with subagents when your runtime offers them.

**Task worker:** if your prompt starts with `kf-run:<id> TASK-###`, you implement exactly that one task and nothing else — you are the implementer, not the controller. Only touch files in its allowlist; if you need another file, stop with `STATUS: BLOCKED` and say which file and why. Do not edit tasks.md, do not commit (kf commits, merges and verifies), never dispatch a subagent, and end with the STATUS lines above. Follow the TDD and self-review rules of `references/implementer-brief.md`.

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

The drive verifies each task mechanically (`harness.verify.task`) but runs no independent per-task review; the whole-branch review by `code-reviewer` happens at the review stage. The drive stops at the ship gate with "ready for ship decision" — continue at section 4 and the testing hand-off. Every stop prints a reason and the next command. Act on the stop code:

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

**Otherwise** run the task loop yourself (section 3), then the build gate (section 4).

## 3. The subagent-driven task loop

Read the approved plan once: `kf tasks {feature_name} --json` gives the task graph (id, description, dependencies, role, files, refs, expected output, wave); the plan's `## Global Constraints` and `## Review Focus` bind every task. For a bug, the "plan" is the approved bug report: one task per fix scope item plus one regression task. Read the requirement the plan argues from; conflicts inside the plan resolve against the requirement.

**Ledger first.** The item folder holds this item's loop artifacts under `<item>/sdd/`: `progress.md` (the ledger, first line `# SDD ledger — <feature> — plan: <abs plan path>`), `task-NNN-brief.md`, `task-NNN-report.md`, `review-<base7>..<head7>.diff`. **Resume from the ledger**: a `TASK-NNN: complete` line is never re-dispatched; a task whose last line is a fix round resumes at the next round. Conversation memory does not survive compaction; the ledger and `git log` do.

**Pre-Task-1 conflict scan.** Before the first dispatch, scan the plan for tasks that contradict each other or the Global Constraints, and for anything the plan mandates that the review rubric treats as a defect. Write the table to the ledger with a `Ruling:` per row — the requirement is binding, the plan is its argument. A clean scan is a table with no rows, not a sentence.

**Rulings, not stalls.** Decide conflicts, ambiguities, plan defects and caps yourself, requirement-binding, and ledger each as `Ruling: <decision> — <why> — <cost if wrong>`. **Four things stop you, and only these:** an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree (merge, push to a shared branch, publish, a database write); a plan too broken to act on. Never check in between tasks.

**Order and parallelism.** Tasks run by wave; within one worktree they are **sequential — never two implementers in the same git history**, because task A's review package would then contain task B's commits and the reviewer grades A against code it never wrote. Batch several tiny same-shape tasks (the same one-line change across files) into one brief and one review; keep one-dispatch-per-task for anything that needs its own judgement or its own tests.

**Scout before a shared change.** When a task's `Files` touch a shared surface (a route, an event, a schema, a public export, a CLI contract) or the task changes existing behaviour, dispatch `Agent(scout)` on the thing about to change before the implementer, and carry its `Highest risk` and `Uncovered paths` lines into the brief. A scout report that changes nothing about the brief was either unnecessary or unread.

### 3.1 Dispatch the implementer

1. **Record `BASE`** — `git rev-parse HEAD` in the worktree. The review package and the fix diffs need it.
2. **Write the brief** to `<item>/sdd/task-NNN-brief.md`: the task row verbatim (description, expected output, FR/UC refs, Files allowlist), the UC and TC excerpts it serves, the Global Constraints, the interfaces earlier tasks produced, your resolution of any ambiguity, and the scout lines. Exact values live only in the brief; no subagent reads the whole plan.
3. **Dispatch** with `references/implementer-brief.md` verbatim, naming the model: mechanical tasks (clear spec, one or two files) → `sonnet`; multi-file coordination or design judgement → `opus`; the same test failing twice in this task → `opus` with the error on disk. Record the implementer's agent identity — rounds 1–3 of the fix loop resume it.

The implementer writes its full report to `<item>/sdd/task-NNN-report.md` and returns only status, commits, a one-line test summary and concerns. It never dispatches subagents and never spawns a reviewer.

### 3.2 Handle the report

- **DONE** → `bash <kanban-review skill dir>/scripts/review-package "$BASE" HEAD <item>/sdd/review-<base7>..<head7>.diff` (exit 3 "empty commit range" means it committed nothing: send it back — DONE requires a commit), then 3.3.
- **DONE_WITH_CONCERNS** → read the concerns; correctness or scope concerns are addressed before review, observations are noted and reviewed.
- **NEEDS_CONTEXT** → supply it, re-dispatch the same agent.
- **BLOCKED** → a context problem gets more context; a reasoning problem gets a more capable model; a too-large task gets split; a wrong plan gets a ledgered `Ruling:` and a re-dispatch carrying it. Never force an unchanged retry, never ignore an escalation.

### 3.3 Review the task

Dispatch `Agent(code-reviewer)` with `references/task-reviewer-brief.md` verbatim: the brief file, the report file, the review package, the Global Constraints copied verbatim, and the model (`sonnet`; `opus` for a high-risk diff). It returns a spec-compliance verdict (✅ / ❌ / ⚠️ cannot verify from diff) and a quality verdict with findings in the shared schema. Resolve every ⚠️ item yourself from the plan or the code before completing the task; a confirmed gap is a failed spec review. Never accept a report missing either verdict; self-review never replaces this gate. Never pre-judge a finding in the brief ("do not flag X" is the tell).

### 3.4 The fix loop

Triggered by spec ❌, any HIGH or MEDIUM finding, or a ⚠️ you confirmed. **Minor (LOW) findings never enter the loop**: ledger them as `TASK-NNN: minor (deferred): <one-liner>` — the whole-branch review at the review stage reads them from the pack's `## Deferred` block. A plan-mandated finding is yours to rule on, ledgered before you act.

A round is one fix dispatch plus one scoped re-review. **Five rounds maximum per task.**

- **Rounds 1–3 resume the original implementer** with the open findings verbatim; it fixes, re-runs the covering tests, appends a fix report to its report file and returns the short contract.
- **Rounds 4–5 dispatch a fresh implementer one tier up**, with the brief path, the report path, the open findings and the framing "a prior implementer attempted this N times; you own it now".
- **The re-review is scoped:** `review-package <FIX_BASE> HEAD` where `FIX_BASE` is the head the previous review saw, dispatched with `references/re-review-brief.md`. Each finding comes back ADDRESSED or NOT ADDRESSED; new breakage in the fix diff joins the open list; out-of-scope observations become deferred minors.
- After each round append `TASK-NNN: fix round <R>/5 (<X> addressed, <Y> open — <one-liners>; commits <a7>..<b7>)`.

**The breaker.** When round 5 still leaves findings open, stop dispatching and adjudicate each: a contestable one is parked — `TASK-NNN: parked — <finding> — Ruling: <why>`; a load-bearing one gets a ruling on the smallest unblocking change. Silent discards are forbidden. Never start the next task with a HIGH finding neither fixed nor parked with a ruling.

### 3.5 Complete the task

Review clean, or every open finding parked at the cap → tick the task in tasks.md and append `TASK-NNN: complete (commits <base7>..<head7>, review clean)` or `… (<K> parked)`. "Review clean" certifies the diff matched the brief and the code is sound; it certifies nothing visual. A task whose deliverable is something a person looks at gets a real run before its ledger line (start the app at the item's domain or port, exercise the screen) — the plan should have flagged it.

**No subagent tool in your runtime?** Do the same loop yourself in the same order: brief, implement, self-review against `references/task-reviewer-brief.md`, ledger — and say in the ledger that the review seat was the controller's own.

## 4. Tick tasks as they land; gate on build

```bash
{build_command}
```

- PASS → continue.
- FAIL → the failing task's implementer fixes, re-run.
- Failed again → STOP, show error, ask.

When all tasks are complete, run the FULL build and the FULL suite (not just the touched module), in the worktree. Collect every ledger `Ruling:` line into your final message under "Rulings I made", each with what it costs if wrong — that list is the only place the decisions you took on the human's behalf reach them.

Do not modify the approved requirement, plan or test-case contract. Project-specific permissions for database operations and other external actions still apply.

---

## References

- `references/implementer-brief.md` — the implementer dispatch, verbatim.
- `references/task-reviewer-brief.md` — the task review dispatch, verbatim.
- `references/re-review-brief.md` — the scoped re-review after a fix round.
- `references/task-loop.md` — model selection, the ledger, fix-loop mechanics, the rationalizations to refuse.
- `../kanban-review/scripts/review-package` — the review package script (shared with the review stage).

## Done

All tasks complete, build and suite green, rulings reported. Hand off:

```text
Load the kanban-test skill and move the feature to testing.
```

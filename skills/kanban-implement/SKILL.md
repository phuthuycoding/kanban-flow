---
name: kanban-implement
description: 'Implement an approved kanban feature or bug: hand the item to kf drive when a task harness is configured, otherwise run the subagent-driven task loop — per task a test-writer, a developer and an independent code-reviewer, a bounded fix loop and a ledger — then verify the build. Use in implementation — after `kf approve` started the item, an explicit start from backlog, or a FAIL/REJECT repair loop.'
---

# Kanban Phase 3 — Implement (Autonomous)

Argument: `<feature_name>`.

Execute the approved implementation plan for a feature, or the approved bug report's fix scope and regression strategy for a bug. If implementation requires a scope change, explain it and obtain the user's decision before revising the contract.

**You are the controller, not the implementer.** The plan is executed by fresh subagents with isolated context, each reviewed by another fresh subagent before its work cascades into the next task. Your context stays for coordination: the ledger, the briefs, the rulings. Fixing a finding yourself pollutes that context and skips review.

**Invoked through `kf run` as the stage worker?** If your prompt starts with `kf-run:<id>` **without** a `TASK-###` token, you are the controller for this stage only: skip the "move to stage" step below, never run `kf stage` / `kf approve` / `kf archive` / `kf run`, never edit approved contract artifacts, never push, and end your final message with two lines exactly: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and `Summary: <one or two sentences>`. The main agent reads them and decides the transition. You run section 3's task loop when your runtime offers subagents; **the only commits in a stage worker's session are the ones that loop prescribes** — one per task on the item branch, made by the implementer it dispatches. You commit nothing yourself outside that loop.

**Task worker:** if your prompt starts with `kf-run:<id> TASK-###`, you implement exactly that one task and nothing else — you are the implementer, not the controller. Only touch files in its allowlist; if you need another file, stop with `STATUS: BLOCKED` and say which file and why. Do not edit tasks.md, do not commit (kf commits, merges and verifies), never dispatch a subagent, and end with the STATUS lines above. Follow the TDD and self-review rules of `references/implementer-brief.md`.

---

## 1. Move to implementation

Read `kf status --change {feature_name}`. `kf approve` already moved a freshly approved item here. Move only when coming from backlog with a valid approval and the user's explicit start decision, or when a FAIL/REJECT report requires a loop. If already in implementation, skip the move and resume existing tasks. If approval changed, stop and return to planning on the user's direction.

```bash
kf stage {feature_name} implementation
```

**Worktree:** when the project opted in with `worktree.enabled: true`, entering implementation provisions a git worktree + a `.<tld>` domain for the item — `kf status --change {feature_name}` prints `Worktree:` (path), `Domain:` (`http://<feature>.<baseDomain>`) and the direct `127.0.0.1:<port>` fallback. **All code work happens inside that worktree on its branch (`<prefix>/<feature>`, printed as `Worktree: … (branch …)`) — never on the user's main checkout.** Commit your changes there; the merge back is the human's call, not yours. `.works/` artifacts and `kf` commands keep working from inside the worktree (project root resolves through the git common dir). If domain DNS is not set up on the machine yet, the direct `127.0.0.1:<port>` URL always works; `kf worktree setup` (sudo, once) fixes the domain. A project `worktree-create.sh` hook may already have installed deps and seeded `.env` — check before re-installing.

Create tasks.md if missing: `- [ ] 1. ...` checkboxes mapping tasks to the approved test cases for a feature, or reproduction/acceptance/regression scope in the bug report for a bug. Preserve completed tasks on resume; add the required fix tasks when looping. Record the starting HEAD and pre-existing working-tree changes in a `## Baseline` section at the top of `tasks.md` so review can distinguish this work item's changes (under a `kf drive`, kf writes it). When a worktree exists, the baseline HEAD is the worktree branch's branch point, recorded from inside the worktree.

## 2. Hand off to the harness, if configured

Skip this section when your prompt starts with `kf-run:` — you are already the worker.

After the move, read `kf status --change {feature_name} --json` and `.kf/config.json`.

**Owner rule:** a `driving` or `blocked` line for this item in `.kf/travel/progress.md` means travel owns its drive — never drive it a second time from here (`kf drive` refuses a second drive anyway). A `blocked` item the human opened in this session is yours to fix until they say it is done; travel re-drives it.

**Drive configured** (`harness.verify.stage` set and `worktree.enabled: true`): hand the item to the task harness. kf, not a worker, commits, merges and verifies each task result, and it writes the `## Baseline` section of tasks.md.

```bash
kf drive {feature_name}            # detached; runs the approved TASK-### rows
kf drive {feature_name} --status   # monitor: the step and each live worker's last action with its age; add --json for machine-readable output
kf drive {feature_name} --watch    # stream events and a heartbeat with each worker's last action until the drive stops
kf drive {feature_name} --stop     # stop on the human's request
```

The drive verifies each task mechanically (`harness.verify.task`) but runs no independent per-task review; the whole-branch review by `code-reviewer` happens at the review stage. The drive ends `ready` once review is PASS and its PR is open — testing and review ran inside the drive; hand the human the PR URL to merge. Every stop prints a reason and the next command. Act on the stop code:

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
| `config_changed` | Config changed mid-drive: check the argv `kf` printed with the human, then `kf drive <f> --accept-config` |
| `budget` | Budget spent: ask the human whether to continue |
| `stopped_by_user` | Wait for the human's decision |
| `crashed` | Read the drive log; ask the human before re-driving |
| `git_error` | Inspect the worktree git state; fix it or ask the human |
| `usage_limit` | A worker hit the API usage limit: wait for the reset the reason quotes, then `kf drive {feature_name}` — the same worker session resumes; no run or attempt was spent |

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

**Seats, in this order.** Each task gets `Agent(test-writer)`, which writes the failing tests from the task's test cases; then `Agent(developer)`, which makes them pass and commits the task; then `Agent(code-reviewer)`, which reviews the task's diff. Whoever writes a file owns it: the developer never edits the test-writer's tests, and neither of them edits the automation-writer's specs. The agent bodies live in `<skills dir>/kanban-flow/agents/<name>.md`; when a seat's agent is not registered, a general-purpose subagent stands in with that body pasted first and `stand-in: general-purpose` written in the ledger line.

**Ledger first.** The item folder holds this item's loop artifacts under `<item>/loop/`: `progress.md` (the ledger, first line `# Task loop ledger — <feature> — plan: <abs plan path>`), `task-NNN-brief.md`, `task-NNN-tests-report.md`, `task-NNN-report.md`, `task-NNN-e2e-report.md`, `review-<base7>..<head7>.diff`. **Resume from the ledger**: a `TASK-NNN: complete` line is never re-dispatched; a task whose last line is a fix round resumes at the next round. Conversation memory does not survive compaction; the ledger and `git log` do.

**Pre-Task-1 conflict scan.** Before the first dispatch, scan the plan for tasks that contradict each other or the Global Constraints, and for anything the plan mandates that the review rubric treats as a defect. Write the table to the ledger with a `Ruling:` per row — the requirement is binding, the plan is its argument. A clean scan is a table with no rows, not a sentence.

**Rulings, not stalls.** Decide conflicts, ambiguities, plan defects and caps yourself, requirement-binding, and ledger each as `Ruling: <decision> — <why> — <cost if wrong>`. **Four things stop you, and only these:** an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree (merge, push to a shared branch, publish, a database write); a plan too broken to act on. Never check in between tasks.

**Order and parallelism.** Tasks run by wave; within one worktree they are **sequential — never two tasks in flight in the same git history**, because task A's review package would then contain task B's commits and the reviewer grades A against code it never wrote. Batch several tiny same-shape tasks (the same one-line change across files) into one brief and one review; keep one-dispatch-per-task for anything that needs its own judgement or its own tests.

**Scout before a shared change — reuse first.** The plan stage saved its scout reports under `<item>/reviews/scout-<target>.md`; a task whose target is covered there carries that report's `Highest risk` and `Uncovered paths` lines into the brief and dispatches nothing. Dispatch `Agent(scout)` only for a shared surface (a route, an event, a schema, a public export, a CLI contract) the plan stage did not scout, or one that changed on the base after approval; save the new report beside the others. A scout report that changes nothing about the brief was either unnecessary or unread.

### 3.1 Write the brief and dispatch the test-writer

1. **Record `BASE`** — `git rev-parse HEAD` in the worktree. The review package and the fix diffs need it.
2. **Write the brief** to `<item>/loop/task-NNN-brief.md`: the task row verbatim (description, expected output, FR/UC refs, Files allowlist), the UC and TC excerpts it serves, the Global Constraints, the interfaces earlier tasks produced, your resolution of any ambiguity, and the scout lines. Exact values live only in the brief; no subagent reads the whole plan. `kf tasks` carries no TC refs: select the `## TC-###` blocks of `phase-2-test-case.md` whose requirement or use case reference matches the task's FR/UC refs, and sort them by `Test type` — `Unit` / `Integration` for the test-writer, `UI` / `E2E` for the automation-writer (3.2).
3. **Pick the seats.** A task whose TCs include `Unit` or `Integration` gets the test-writer; so does a bug's regression task, where the test-writer writes the regression test from the bug report's reproduction. A task with no Unit or Integration TC (docs, config, glue) skips it: ledger `TASK-NNN: no test-writer — <why>`, and the developer's report then carries the `No TDD: <why>` line with real-run output. For a task with both Unit and UI TCs, the Unit TCs go to the test-writer and the UI TCs to the automation-writer; neither edits the other's files.
4. **Dispatch** `Agent(test-writer)` with `references/test-writer-brief.md` verbatim, naming the model per `references/task-loop.md` § Model selection. It writes `<item>/loop/task-NNN-tests-report.md`, never commits and returns the short contract.
5. **Check that each test fails for the right reason** — the report's failing output shows the TC's expected value not met, or the export, route or command the task adds missing. Then:
   - **A test that passes before implementation** proves nothing about this task: record a `Ruling:` before the developer is dispatched — the behaviour already exists (the task shrinks to what is missing) or the test is wrong (back to the test-writer). Never dispatch the developer on it silently.
   - **A test-writer `NEEDS_CONTEXT` for a TC with no concrete expected value** is a plan defect: rule on the value the requirement fixes and re-dispatch the test-writer with that `Ruling:`, or stop — a plan too broken to act on — when the requirement fixes none. It never goes to the developer, who would invent the value.
   - Any other `NEEDS_CONTEXT` or `BLOCKED` is handled as in 3.2.

### 3.2 Dispatch the developer and handle its report

**Dispatch** `Agent(developer)` with `references/developer-brief.md` verbatim, naming the model per `references/task-loop.md` § Model selection. Append the test-writer's test files and their failing output to the brief file first, and run `git hash-object <test files>` and ledger the result as `TASK-NNN: test hashes <file>=<sha> …`. The developer never edits those test files, makes them pass and commits the task — tests and code — on the item branch. When it reports, hash the same files again, read from the worktree files at the developer's committed HEAD, and compare them with the latest `TASK-NNN: test hashes` line — every test-writer change ledgers a new one (3.2 dispute, 3.4 test findings): a mismatch is handled like a `TEST_DISPUTE` — back to the test-writer — never accepted silently. Record the developer's agent identity — rounds 1–3 of the fix loop resume it.

The developer writes its full report to `<item>/loop/task-NNN-report.md` and returns only status, commits, a one-line test summary and concerns. It never dispatches subagents and never spawns a reviewer.

**UI tasks under `Level: full`.** A task whose TCs include `UI` or `E2E` gets `Agent(automation-writer)` with `references/automation-writer-brief.md` verbatim, naming the model: after the developer's commit, against the screen it built — or before the developer when the plan fixes a `data-testid` contract, the specs then expected to fail until the screen lands; in that case pass their paths to the developer as `[SPEC_FILES]`, which it never edits and keeps out of its task commit. It writes `<item>/loop/task-NNN-e2e-report.md` and never commits. Once the developer's task commit exists, resume the developer once to commit the automation-writer's spec files unchanged as a second commit of the task, before the code-reviewer, so the review package from `BASE` covers both commits. A spec the report says fails because the product is wrong is a code finding for the fix loop (3.4). The Playwright MCP is for selector discovery only, one agent at a time; the evidence is the headless `npx playwright test` run.

- **DONE** → for a UI task under `Level: full`, the automation-writer step above first; then `bash <kanban-review skill dir>/scripts/review-package "$BASE" HEAD <item>/loop/review-<base7>..<head7>.diff` (exit 3 "empty commit range" means it committed nothing: send it back — DONE requires a commit), then 3.3.
- **DONE_WITH_CONCERNS** → read the concerns; correctness or scope concerns are addressed before review, observations are noted and reviewed.
- **NEEDS_CONTEXT** → supply it, re-dispatch the same agent.
- **BLOCKED** → a context problem gets more context; a reasoning problem gets a more capable model; a too-large task gets split; a wrong plan gets a ledgered `Ruling:` and a re-dispatch carrying it. Never force an unchanged retry, never ignore an escalation.
- **`TEST_DISPUTE: <file:line> <why>`** → read the reason first. When it says the TC contradicts an FR or another TC (not the code), stop and report it to the human as a plan or requirement problem — never rule on it. Otherwise dispatch `Agent(test-writer)` with the line verbatim: it fixes the test against the TC, or keeps it and quotes the TC. Fixed → re-run `git hash-object` on the changed test files and ledger a new `TASK-NNN: test hashes` line before resuming the developer with the fixed test. Kept → record a `Ruling:` that the TC is binding, quoting it, and resume the developer with it. Stop, too, on a second dispute on the same test after a Ruling — it is not another round: report it to the human. Ledger every step as `TASK-NNN: test dispute <file:line> — <fixed | kept, Ruling | stopped>`.

### 3.3 Review the task

Dispatch `Agent(code-reviewer)` with `references/task-reviewer-brief.md` verbatim: the brief file, the developer's report file, the review package, the Global Constraints copied verbatim, and the model (`sonnet`; `opus` for a high-risk diff). It returns a spec-compliance verdict (✅ / ❌ / ⚠️ cannot verify from diff) and a quality verdict with findings in the shared schema. Resolve every ⚠️ item yourself from the plan or the code before completing the task; a confirmed gap is a failed spec review. Never accept a report missing either verdict; self-review never replaces this gate. Never pre-judge a finding in the brief ("do not flag X" is the tell).

### 3.4 The fix loop

Triggered by spec ❌, any HIGH or MEDIUM finding, or a ⚠️ you confirmed. **Minor (LOW) findings never enter the loop**: ledger them as `TASK-NNN: minor (deferred): <one-liner>` — the whole-branch review at the review stage reads them from the pack's `## Deferred` block. A plan-mandated finding is yours to rule on, ledgered before you act.

A round is one fix dispatch plus one scoped re-review. **Five rounds maximum per task**, one counter whichever seat fixes.

- **Code findings go to the developer.** **Rounds 1–3 resume the original developer** with the open findings verbatim; it fixes, re-runs the covering tests, appends a fix report to its report file and returns the short contract.
- **Rounds 4–5 dispatch a fresh developer one tier up**, with the brief path, the report path, the open findings and the framing "a prior developer attempted this N times; you own it now".
- **Findings about a test go to the test-writer** (a spec's to the automation-writer): resume it with those findings verbatim; it fixes the test against the TC, re-runs it and appends a fix report to its report file. Then re-run `git hash-object` on the changed test files and ledger a new `TASK-NNN: test hashes` line before resuming the developer to commit the fixed test unchanged. The round counts the same as a code round.
- **The re-review is scoped:** `review-package <FIX_BASE> HEAD` where `FIX_BASE` is the head the previous review saw, dispatched with `references/re-review-brief.md`. Each finding comes back ADDRESSED or NOT ADDRESSED; new breakage in the fix diff joins the open list; out-of-scope observations become deferred minors.
- After each round append `TASK-NNN: fix round <R>/5 (<X> addressed, <Y> open — <one-liners>; commits <a7>..<b7>)`.

**The breaker.** When round 5 still leaves findings open, stop dispatching and adjudicate each: a contestable one is parked — `TASK-NNN: parked — <finding> — Ruling: <why>`; a load-bearing one gets a ruling on the smallest unblocking change. Silent discards are forbidden. Never start the next task with a HIGH finding neither fixed nor parked with a ruling.

### 3.5 Complete the task

Review clean, or every open finding parked at the cap → tick the task in tasks.md and append `TASK-NNN: complete (commits <base7>..<head7>, review clean)` or `… (<K> parked)`. "Review clean" certifies the diff matched the brief and the code is sound; it certifies nothing visual. A task whose deliverable is something a person looks at gets a real run before its ledger line (start the app at the item's domain or port, exercise the screen) — the plan should have flagged it.

**No subagent tool in your runtime?** Implement task by task in the same order (brief, tests, implement, commit, ledger), but **do not fill the independent seats yourself** — a session does not grade its own work, and it never fills the test-writer and the developer seats in one session and claims them independent: tests and code written by one session are one seat. Write `TASK-NNN: implemented, test-writer seat: none, review seat: none` in the ledger and hand the review to a runner role (`kf run <feature> --role reviewer` when `harness.roles` has one) or leave it to the review stage, which then treats every task as unreviewed and reviews the whole branch at the tier the diff demands. A `complete (review clean)` line without an independent reviewer is a lie the ledger must not carry.

## 4. Tick tasks as they land; gate on build

```bash
{build_command}
```

- PASS → continue.
- FAIL → the failing task's developer fixes, re-run.
- Failed again → STOP, show error, ask.

When all tasks are complete, run the FULL build and the FULL suite (not just the touched module), in the worktree. Collect every ledger `Ruling:` line into your final message under "Rulings I made", each with what it costs if wrong — that list is the only place the decisions you took on the human's behalf reach them.

Do not modify the approved requirement, plan or test-case contract. Project-specific permissions for database operations and other external actions still apply.

---

## References

- `references/test-writer-brief.md` — the test-writer dispatch, verbatim.
- `references/developer-brief.md` — the developer dispatch, verbatim.
- `references/automation-writer-brief.md` — the automation-writer dispatch, verbatim.
- `references/implementer-brief.md` — the single-implementer dispatch; the task worker follows its TDD and self-review rules.
- `references/task-reviewer-brief.md` — the task review dispatch, verbatim.
- `references/re-review-brief.md` — the scoped re-review after a fix round.
- `references/task-loop.md` — model selection, the ledger, fix-loop mechanics, the rationalizations to refuse.
- `../kanban-review/scripts/review-package` — the review package script (shared with the review stage).

## Done

All tasks complete, build and suite green, rulings reported. Hand off:

```text
Load the kanban-test skill and move the feature to testing.
```

---
name: implement
description: 'Implement an approved kanban feature or bug: run the subagent-driven task loop — per task a test-writer, a developer and an independent code-reviewer, a bounded fix loop and a ledger — then verify the build. Use in implementation — after `kf approve` started the item, an explicit start from backlog, or a FAIL/REJECT repair loop.'
---

# Kanban Phase 3 — Implement (Autonomous)

Plugin root: `${CLAUDE_PLUGIN_ROOT}` — the reference files of this skill write paths with this placeholder; resolve it to this path.

Argument: `<feature_name>`.

Execute the approved implementation plan for a feature, or the approved bug report's fix scope and regression strategy for a bug. If implementation requires a scope change, explain it and obtain the user's decision before revising the contract.

**You are the controller, not the implementer.** The plan is executed by fresh subagents with isolated context, each reviewed by another fresh subagent before its work cascades into the next task. Your context stays for coordination: the ledger, the briefs, the rulings. Fixing a finding yourself pollutes that context and skips review.

---

## 1. Move to implementation

Read `kf status --change {feature_name}`. `kf approve` already moved a freshly approved item here. Move only when coming from backlog with a valid approval and the user's explicit start decision, or when a FAIL/REJECT report requires a loop. If already in implementation, skip the move and resume existing tasks. If approval changed, stop and return to planning on the user's direction.

```bash
kf stage {feature_name} implementation
```

**Worktree:** when the project opted in with `worktree.enabled: true`, entering implementation provisions a git worktree + a `.<tld>` domain for the item — `kf status --change {feature_name}` prints `Worktree:` (path), `Domain:` (`http://<feature>.<baseDomain>`) and the direct `127.0.0.1:<port>` fallback. **All code work happens inside that worktree on its branch (`<prefix>/<feature>`, printed as `Worktree: … (branch …)`) — never on the user's main checkout.** Commit your changes there; the merge back is the human's call, not yours. `.works/` artifacts and `kf` commands keep working from inside the worktree (project root resolves through the git common dir). If domain DNS is not set up on the machine yet, the direct `127.0.0.1:<port>` URL always works; `kf worktree setup` (sudo, once) fixes the domain. When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>` (the JSON outputs still carry `domain`; do not use it then): no domain is set up and `kf status` prints only the direct URL. A project `worktree-create.sh` hook may already have installed deps and seeded `.env` — check before re-installing.

**Owner rule:** a `driving` or `blocked` line for this item in `.kf/travel/progress.md` carries an owner token. Only one travel session runs per day; a session that is not travel never runs a task loop for an `owner=travel` line. A `blocked` item the human opens in this session is rewritten to `owner=human` and is yours to fix until they say it is done; travel then sets it back to `owner=travel`.

Create tasks.md if missing: `- [ ] 1. TASK-001: <what to do>` checkboxes, each line carrying its task id (`kf next` reads a bug's tasks from these ids, in file order), mapping tasks to the approved test cases for a feature, or reproduction/acceptance/regression scope in the bug report for a bug. Preserve completed tasks on resume. Record the starting HEAD and pre-existing working-tree changes in a `## Baseline` section at the top of `tasks.md` so review can distinguish this work item's changes. When a worktree exists, the baseline HEAD is the worktree branch's branch point, recorded from inside the worktree.

## 2. Read the verify configuration

Read `.kf/config.json`. `harness.verify.task` lists the commands `kf verify <f> --task` runs after each task commit (3.2); `harness.verify.stage` lists the commands `kf verify <f> --stage` runs at the build gate (section 4). With no commands configured, `kf verify` still checks the task's Files allowlist on `--task`; exit 0 then means only that nothing was run, so call it unconditionally.

## 3. The subagent-driven task loop

Read the approved plan once: `kf tasks {feature_name} --json` gives the task graph, one row per task with id, description, dependencies, files, refs (FR/UC refs, never TC refs), expectedOutput, wave, overlaps and state; the plan's `## Global Constraints` and `## Review Focus` bind every task. For a bug, the "plan" is the approved bug report: one task per fix scope item plus one regression task. Read the requirement the plan argues from; conflicts inside the plan resolve against the requirement.

**Seats, in this order.** Each task gets `Agent(kf:test-writer)`, which writes the failing tests from the task's test cases; then `Agent(kf:developer)`, which makes them pass and commits the task — except in an inline wave, where the controller fills the developer seat (Inline waves below); then `Agent(kf:code-reviewer)`, which reviews the task's diff. Whoever writes a file owns it: the developer never edits the test-writer's tests, and neither of them edits the automation-writer's specs. The agent bodies live in `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md`; when a seat's agent is not registered, a general-purpose subagent stands in with that body pasted first, recorded on its own line `Note TASK-NNN: <seat> stand-in general-purpose @ <ts>` written right after the seat's dispatched line, so the dispatched line keeps the grammar.

**Ledger first.** The item folder holds this item's loop artifacts under `<item>/loop/`: `progress.md` (the ledger, first line `# Task loop ledger — <feature> — plan: <abs plan path>`), `task-NNN-brief.md`, `task-NNN-tests-report.md`, `task-NNN-report.md`, `task-NNN-e2e-report.md`, `task-NNN-verify.log`, `review-<first7>..<last7>.diff`. Every ledger line after the header ends with ` @ <ISO-8601 timestamp with offset>`, once; the lines `kf loop-stats` reads follow the grammar in `references/task-loop.md` § The ledger, and the lines quoted below omit the suffix. Write every line through `kf record {feature_name} <event> …` (`kf record --help` lists the events): it stamps the line, checks it against the grammar and the ledger, and appends it under the item lock, so two writers never interleave. Conversation memory does not survive compaction; the ledger and `git log` do.

**The loop runs on `kf next`.** Every time you get a turn — a seat reports, a background command exits, or you have just dispatched something — run `kf next {feature_name}` and carry out every action it prints, then run it again. It reads the ledger, the plan, the reports, the verify logs and `git log`, changes no file and starts nothing; it owns the scheduling rules — task order and overlaps, the live developer cap and its step-ups and step-downs, contention re-runs, test-writers ahead, the seats after a commit, verify routing, fix rounds, cascade re-reviews and completion — so the session never re-derives them. The session is the only one that spawns seats: every `dispatch` is an `Agent()` call you make. The actions, one per line (`kf next {feature_name} --json` prints the same as data):
- `dispatch <seat> TASK-NNN[ round=R][ cascade=sha7] <mode>[ inline]` → dispatch that seat (3.1–3.4) and record it, `kf record {feature_name} dispatched TASK-NNN <seat> --model <m>` with its `--round` and `--cascade`. `new` is a new agent, `resume` the same agent resumed, `fresh` a new agent one tier up; `inline` is a developer seat the controller fills itself (Inline waves).
- `verify TASK-NNN: <command>` → `kf record … verify-started TASK-NNN`, run the command in the background, and record its exit with `kf record … verify-done TASK-NNN --exit <n>` (3.2).
- `write: <line>` → fill any `<…>` placeholder (a ruling's cost, a reason) and run the `kf record …` call printed under it.
- `complete TASK-NNN` → 3.5.
- `wait TASK-NNN: <reason>` → nothing to do; the reason names what releases it.
- `decide[ TASK-NNN] (<rule>): <reason> — closes with <line>` → the judgement under that rule's heading in Decisions below; it holds its own task's actions until you record the line it names.
- `stop[ TASK-NNN]: <reason>` → do what the reason names and report it to the human (3.2 exit 2, Repairing after the loop); no new seat starts meanwhile.
- `finished` → every task is complete and nothing is owed: section 4.

**Resume.** After compaction or in a new session, run `kf next --resume` (`kf next {feature_name} --resume`) before anything else: it lists every seat and verify the ledger shows open for a re-run, before any new developer, and gives a `Drift` decide (Decisions) instead of a re-dispatch when a task's report already names a commit dated after its open developer dispatch. A `dispatch developer … inline` it lists is an open inline task, resumed by the controller, which never spawns a developer for it: the controller inspects the worktree diff, finishes, commits and ledgers `developer done` — unless a chain `Ruling:` names a chain subagent for it, in which case the controller resumes that subagent and ledgers `developer done` when it reports. Fix rounds of an inline task run inline, or in the chain subagent its `Ruling:` names. A task with a `complete` line is never re-dispatched, unless a later `Note TASK-NNN: reopened` line reopens it (3.4).

**Pre-Task-1 conflict scan.** Before the first dispatch, scan the plan for tasks that contradict each other or the Global Constraints, and for anything the plan mandates that the review rubric treats as a defect. Write the table to the ledger with a `Ruling:` per row — the requirement is binding, the plan is its argument. A clean scan is a table with no rows, written as the one line `Scan: clean`, not a sentence; `kf next` opens no seat until a `Scan:` line exists.

**Rulings, not stalls.** Decide conflicts, ambiguities, plan defects and caps yourself, requirement-binding, and ledger each as `Ruling: <decision> — <why> — <cost if wrong>`. **Five things stop you, and only these:** an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree (merge, push to a shared branch, publish, a database write); a reopened task at its round cap, apart from the one minimal fix past the cap (3.4); a plan too broken to act on. Never check in between tasks.

**Inline waves.** A wave the plan records as `Execution: wave <w> inline` (one task: nothing to run beside it) spawns no developer — the controller fills the developer seat itself, because a subagent per sequential step only adds handover cost. Five rules keep the other seats intact:
1. **Ledger.** In an inline wave the controller still writes `developer dispatched model=inline` and `developer done`, with `Note TASK-NNN: developer seat inline` right after the dispatched line, so `kf loop-stats` reads it unchanged.
2. **Tests first.** In an inline wave the test-writers still run ahead, four tasks deep as `kf next` schedules them, in parallel, from the TCs and the plan's signatures; the controller makes them pass and never edits their tests.
3. **Review stays an independent agent.** `Agent(kf:code-reviewer)` reviews every inline task; the controller never reviews its own task.
4. **Pipelined review.** After committing task N, the controller starts `kf verify` and the code-reviewer in the background and starts task N+1. It does not commit N+1 until N's review is back, and fixes N's HIGH and MEDIUM findings first, committing those fixes through the path-limited script with only N's files. N+1's `developer dispatched` is written when its work starts; when N+1's Files overlap N's, N+1 starts only after N's review is clean and N's `complete` line is written, the same release point `kf next` uses for overlapping tasks.
5. **Signature drift.** On signature drift from the plan in task N, ledger a `Ruling:` and re-dispatch the dependent tasks' test-writers; the controller never edits their tests.

A chain — consecutive tasks in inline waves — of more than 5 inline tasks uses one developer subagent resumed for the whole chain instead of the controller, so the controller's context stays for coordination; a shorter chain with large diffs does the same on a `Ruling:` that says why. For the chain subagent the controller writes each chain task's `developer dispatched` when it hands that task over and its `developer done` when the subagent reports — never ahead of the hand-over, so `kf loop-stats` sees sequential intervals (no inline Note); a `Ruling:` names the chain and the subagent's identity, and a resume after compaction resumes that same subagent. When `kf next` prints a new inline developer seat, an inline task not yet started is started by the controller: it writes `developer dispatched model=inline` and its `Note TASK-NNN: developer seat inline` (Inline waves rule 1), or, when a chain `Ruling:` names a chain subagent for it, hands the task to that subagent and writes `developer dispatched` at the hand-over.

**Concurrent checks and commits.** While any other seat is in flight, a developer's own typecheck, lint, build and test runs are advisory: it runs focused tests, no full suite, and reports failures in files it neither wrote nor was handed as `not mine: <file>`; the task's authoritative checks are `kf verify --commits` (3.2). At dispatch, fill `[IN_FLIGHT]` with every seat dispatched in the same turn as well as the seats already running. Each developer commits only its own paths, by name, through the commit script (`references/developer-brief.md`). Each task's review package and `kf verify` use that task's own commit list, never a range, so none grades another task's commits. Batch several tiny same-shape tasks (the same one-line change across files) into one brief and one review; keep one-dispatch-per-task for anything that needs its own judgement or its own tests.

**While a seat runs.** Each turn, in order: (1) dispatch every ready seat `kf next` prints; (2) for every newly committed task, build the review package and start the `kf verify` it prints; (3) write the brief of the next task that has none (`TASK-NNN: brief written`) and hash its test files; (4) run the scouts a later task needs; (5) write the ledger lines and reports that are owed — each step recorded as it lands. A test-writer's runs are advisory while any developer is in flight (the build setup continues on tsc exit 2), and the developer's own first run confirms the failures (3.1). `kf verify`, a full suite and a build run with the runtime's background option, never in the foreground, while any item above still applies.

Never wait idle on a seat while one of these steps is pending: end the turn only when no item applies and a seat or background command is running.

**Scout before a shared change — reuse first.** The plan stage saved its scout reports under `<item>/reviews/scout-<target>.md`; a task whose target is covered there carries that report's `Highest risk` and `Uncovered paths` lines into the brief and dispatches nothing. Dispatch `Agent(kf:scout)` only for a shared surface (a route, an event, a schema, a public export, a CLI contract) the plan stage did not scout, or one that changed on the base after approval; save the new report beside the others. A bug's task dispatches none. A scout report that changes nothing about the brief was either unnecessary or unread.

### 3.1 Write the brief and dispatch the test-writer

1. **Record `BASE`** — `git rev-parse HEAD` in the worktree — and, from every seat report, the task's own commits: the task's commit list is those commits in history order. The review package, `kf verify` and the fix diffs take the commit list, because other open tasks' commits may interleave with this task's.
2. **Write the brief** to `<item>/loop/task-NNN-brief.md`: the task row verbatim (description, expected output, FR/UC refs, Files allowlist; when the plan's Files is `-` (unknown), [FILES] is `.` and its developer commits with `--allow .` — name each file you changed, never `.` or a directory), the UC and TC excerpts it serves, the Global Constraints, the interfaces earlier tasks produced, your resolution of any ambiguity, and the scout lines. Exact values live only in the brief; no subagent reads the whole plan. The `refs` of `kf tasks` are FR/UC refs only, never TC refs: select the `## TC-###` blocks of `phase-2-test-case.md` whose requirement or use case reference matches the task's FR/UC refs, and sort them by `Test type` — `Unit` / `Integration` for the test-writer, `UI` / `E2E` for the automation-writer (3.2).
3. **Pick the seats.** A task whose TCs include `Unit` or `Integration` gets the test-writer; so does a bug's regression task, where the test-writer writes the regression test from the bug report's reproduction. A task with no Unit or Integration TC (docs, config, glue) skips it: ledger `TASK-NNN: no test-writer — <why>`, and the developer's report then carries the `No TDD: <why>` line with real-run output. For a task with both Unit and UI TCs, the Unit TCs go to the test-writer and the UI TCs to the automation-writer; neither edits the other's files.
4. **Dispatch** `Agent(kf:test-writer)` with `references/test-writer-brief.md` verbatim, naming the model per `references/task-loop.md` § Model selection; the controller fills `[IN_FLIGHT]` at dispatch with the other seats in flight, or `none`. It writes `<item>/loop/task-NNN-tests-report.md`, never commits and returns the short contract.
5. **Check that each test fails for the right reason** — the report's failing output shows the TC's expected value not met, or the export, route or command the task adds missing. When the test-writer's run was advisory (another seat in flight), the "fails for the right reason" judgement uses the developer's step-3 run, and the ledger says so: the developer stops with NEEDS_CONTEXT if a handed test passes before implementation or fails for a reason other than the missing behaviour in its step-3 run, and the controller rules then, before the developer builds. When the developer's step-3 run is advisory too (other developers in flight) and a handed test fails inside another task's Files, the developer has stopped with NEEDS_CONTEXT: the controller re-runs the handed tests once those developers report, before resuming it to build, or ledgers a `Ruling:` that names the weaker evidence. Then:
   - **A test that passes before implementation** proves nothing about this task: record a `Ruling:` before the developer is dispatched — the behaviour already exists (the task shrinks to what is missing) or the test is wrong (back to the test-writer). Never dispatch the developer on it silently.
   - **A test-writer `NEEDS_CONTEXT` for a TC with no concrete expected value** is a plan defect: rule on the value the requirement fixes and re-dispatch the test-writer with that `Ruling:`, or stop — a plan too broken to act on — when the requirement fixes none. It never goes to the developer, who would invent the value.
   - Any other `NEEDS_CONTEXT` or `BLOCKED` is handled as in 3.2.

### 3.2 Dispatch the developer and handle its report

**Dispatch** `Agent(kf:developer)` with `references/developer-brief.md` verbatim, naming the model per `references/task-loop.md` § Model selection; the controller fills `[IN_FLIGHT]` at dispatch with the other seats in flight, or `none`, and `[COMMIT_SCRIPT]` with the absolute path of `scripts/commit-task.mjs`. Append the test-writer's test files and their failing output to the brief file first, and run `git hash-object <test files>` and ledger the result as `TASK-NNN: test hashes <file>=<sha> …`. The developer never edits those test files, makes them pass and commits the task — tests and code — on the item branch. When it reports, hash the same files again, read from the worktree files at the developer's committed HEAD, and compare them with the latest `TASK-NNN: test hashes` line — every test-writer change ledgers a new one (3.2 dispute, 3.4 test findings): a mismatch is handled like a `TEST_DISPUTE` — back to the test-writer — never accepted silently. Record the developer's agent identity — rounds 1–3 of the fix loop resume it.

The developer writes its full report to `<item>/loop/task-NNN-report.md` and returns only status, commits, a one-line test summary and concerns. It never dispatches subagents and never spawns a reviewer.

**UI tasks under `Level: full`.** A task whose TCs include `UI` or `E2E` gets `Agent(kf:automation-writer)` with `references/automation-writer-brief.md` verbatim, naming the model: after the developer's commit, against the screen it built — or before the developer when the plan fixes a `data-testid` contract, the specs then expected to fail until the screen lands; in that case pass their paths to the developer as `[SPEC_FILES]`, which it never edits and keeps out of its task commit. It writes `<item>/loop/task-NNN-e2e-report.md` and never commits. Once the developer's task commit exists, resume the developer once to commit the automation-writer's spec files unchanged as a second commit of the task, before the code-reviewer, when `kf next` prints that resume (`dispatch developer TASK-NNN resume`), so the task's commit list covers both commits. A spec the report says fails because the product is wrong is a code finding for the fix loop (3.4). The Playwright MCP is for selector discovery only, one agent at a time; the evidence is the headless `npx playwright test` run.

- **DONE** → for a UI task under `Level: full`, the automation-writer step above first (a DONE with no commit is sent back — DONE requires a commit); then, at the task's last commit:
  0. Name the commit first: when `kf next` prints `write Note TASK-NNN: commits <a7>,…` (its report lists commits no ledger line names yet), run its record before anything else — a commit lands where the ledger first names it, and cascades and verify waits are read from that position.
  1. Build the package from the task's commit list: `bash ${CLAUDE_PLUGIN_ROOT}/skills/review/scripts/review-package --commits <sha>[,<sha>…] <item>/loop/review-<first7>..<last7>.diff`, ledgered `TASK-NNN: review package <sha7>,…`.
  2. `kf next` prints the task's `verify` and its code-reviewer `dispatch` together: start `kf verify <f> --task TASK-### --commits <sha>[,<sha>…]` in the worktree, ledgered `TASK-NNN: verify started`, beside the task's code-reviewer (3.3), ledgered `TASK-NNN: code-reviewer dispatched …`. With one task in flight, the single-task form `kf verify <f> --task TASK-### --base <BASE>` still works; the loop uses `--commits`.
  3. When verify reports, ledger `TASK-NNN: verify done exit=<n>` — the exit code `kf verify` itself returned and logged, never one read from another command, with nothing after it; `kf loop-stats` checks it against the log — and act on its exit code:
     - exit 0 → verify passed; the task completes once its review does (3.5).
     - exit 2 (a changed file is outside the task's Files; the output lists them) → stop: this is a plan change — every in-flight seat reports and is ledgered before `kf stage <f> planning`, and the review result is kept; then edit the plan's Files, have the human re-approve with `kf approve <f>` (moves the item back to implementation), then re-run `kf verify`. Never a fix round, and never widen Files or commit the change yourself to get past it.
     - exit 1 → a configured command failed. `kf next` reads the failure from `<item>/loop/task-NNN-verify.log`: a contention-shaped one gets its step-down and one re-run first; otherwise the verify output joins the code-reviewer's findings for the task's next developer fix round (3.4). When the failing tests lie in another open task's Files, the evidence rule below decides which task's round it is, and the session records the outcome: `Note TASK-H: verify routed — TASK-X` with its `Ruling:`, or `Note TASK-H: verify waits — <file> (TASK-X)`.
     - exit 3 (bad input: unknown task, a commit that is not a commit, a merge, not an ancestor or out of history order, an empty list, missing worktree; nothing ran) → your call is wrong: fix the call and re-run it, never a fix round. Exit 3 with `kf verify could not run: …` (an unexpected kf error) → report it to the human, not a fix round. `kf next` holds the task on a `Verify exit 3` decide (Decisions) until you record a new `verify started` or a decided note.
- **DONE_WITH_CONCERNS** → read the concerns; correctness or scope concerns are addressed before review, observations are noted and reviewed.
- **NEEDS_CONTEXT** → supply it, re-dispatch the same agent. When the missing piece is outside knowledge (a library's behaviour, an API version, a standard, how other tools do it), dispatch `Agent(kf:researcher)` first with `${CLAUDE_PLUGIN_ROOT}/skills/flow/references/researcher-brief.md`, report path `<item>/reviews/research-<slug>.md`, and pass its conclusion and the report path as the context when you re-dispatch the same developer. The same holds for a **BLOCKED** caused by missing outside knowledge. It does not apply to a plan defect, a test dispute or an architectural choice. Ledger `Ruling: research <report path> supplied to TASK-NNN developer — <why> — <cost if wrong>`. This dispatch is not a fix round and uses no fix brief; the seat grammar of `references/task-loop.md` is unchanged.
- **BLOCKED** → a context problem gets more context; a reasoning problem gets a more capable model; a too-large task gets split; a wrong plan gets a ledgered `Ruling:` and a re-dispatch carrying it. Never force an unchanged retry, never ignore an escalation. A BLOCKED that quotes `commit made` names a commit that exists: add its sha to the task's commit list and continue as for DONE, never a re-commit.
- **`TEST_DISPUTE: <file:line> <why>`** → read the reason first. When it says the TC contradicts an FR or another TC (not the code), stop and report it to the human as a plan or requirement problem — never rule on it. Otherwise dispatch `Agent(kf:test-writer)` with the line verbatim: it fixes the test against the TC, or keeps it and quotes the TC. Fixed → re-run `git hash-object` on the changed test files and ledger a new `TASK-NNN: test hashes` line before resuming the developer with the fixed test. Kept → record a `Ruling:` that the TC is binding, quoting it, and resume the developer with it. Stop, too, on a second dispute on the same test after a Ruling — it is not another round: report it to the human. Ledger every step as `TASK-NNN: test dispute <file:line> — <fixed | kept, Ruling | stopped>`.

**A task's commit that cannot build alone.** Parallel tasks interleave commits on one branch, so H's newest commit may not build when it needs a file another open task X has not committed yet. That exit 1 is no fix round: ledger `Note TASK-H: verify waits — <file> (TASK-X)` and, once a ledger line names X's commit (the commits note `kf next` prints), re-run with `kf verify <f> --task H --commits <sha>[,<sha>…] --at-head`, a new `verify started` / `verify done` pair. X held by H's own overlap cannot land first: that is a plan defect, so stop and report it. It keeps the allowlist check on H's commits and runs the commands in a detached worktree at HEAD. A failure there is an ordinary exit 1. Another command's pass never stands in for `kf verify`.

**A verify failure in another task's Files.** When H's verify exits 1 on tests inside the Files of another open task X (X's commits are in the checked-out tree), the cause decides, by evidence: first wait for X's running verify, if any; if X's latest verify on a tree without H's fix commit passed those same tests, H broke them and the failure stays with H; otherwise it goes to X as a fix round of X, with a `Ruling:` line naming the tests and the evidence. H stays unverified until X's next verify passes. If X's developer reports `BLOCKED` because the cause lies in H's Files, the controller returns it to H as a fix round. If X parks the routed failure at its five-round cap, H counts as verified and completes with the parked failure named in its `complete` line. No deadlock: X's verify never waits for H's completion.

### 3.3 Review the task

Dispatch `Agent(kf:code-reviewer)` with `references/task-reviewer-brief.md` verbatim, beside the task's `kf verify` (3.2): the brief file, the developer's report file, the review package, the Global Constraints copied verbatim, and the model (`sonnet`; `opus` for a high-risk diff). It grades the review package only; the working tree may hold other tasks' uncommitted edits, which are context only. It returns a spec-compliance verdict (✅ / ❌ / ⚠️ cannot verify from diff) and a quality verdict with findings in the shared schema. Resolve every ⚠️ item yourself from the plan or the code before completing the task; a confirmed gap is a failed spec review. A ⚠️ that only a real run can answer is ledgered `TASK-NNN: unverified — <claim>`, and `kf:test` runs it. Never accept a report missing either verdict; self-review never replaces this gate. Never pre-judge a finding in the brief ("do not flag X" is the tell).

### 3.4 The fix loop

Triggered by spec ❌, any HIGH or MEDIUM finding, or a ⚠️ you confirmed. **Minor (LOW) findings never enter the loop**: ledger them as `TASK-NNN: minor (deferred): <one-liner>` — the whole-branch review at the review stage reads them from the pack's `## Deferred` block. A plan-mandated finding is yours to rule on, ledgered before you act.

A round is one fix dispatch plus one scoped re-review. **Five rounds maximum per task**, one counter whichever seat fixes.

- **Code findings go to the developer.** `kf next` names the round's developer seat and its mode: in rounds 1–3 it is the original developer, resumed with the open findings verbatim; it fixes, re-runs the covering tests, appends a fix report to its report file and returns the short contract.
- **Rounds 4–5 dispatch a fresh developer one tier up**, with the brief path, the report path, the open findings and the framing "a prior developer attempted this N times; you own it now".
- **Findings about a test go to the test-writer** (a spec's to the automation-writer): resume it with those findings verbatim; it fixes the test against the TC, re-runs it and appends a fix report to its report file — `task-NNN-tests-report.md` for the test-writer, `task-NNN-e2e-report.md` for the automation-writer. Then re-run `git hash-object` on the changed test files and ledger a new `TASK-NNN: test hashes` line before resuming the developer to commit the fixed test unchanged, when `kf next` prints that resume. The round counts the same as a code round.
- **The re-review is scoped:** `review-package --commits <fix sha>[,<fix sha>…]` over the round's fix commits, `FIX_BASE` being the head the previous review saw, dispatched with `references/re-review-brief.md`. Each finding comes back ADDRESSED or NOT ADDRESSED; new breakage in the fix diff joins the open list; out-of-scope observations become deferred minors.
- After each round append `TASK-NNN: fix round <R>/5 (<X> addressed, <Y> open — <one-liners>; commits <a7>,<b7>,…)`, listing the round's fix commits, with `kf record <f> fix-round TASK-NNN <R> -- …`.
- Sending a finding to the test-writer or the automation-writer instead of the developer stays your choice: `kf next` names the round developer; dispatch the round seat the findings need.

**A cascade re-review.** When `kf next` prints `dispatch code-reviewer TASK-X … cascade=<sha7>`, a fix of a task X depends on landed after X's developer was dispatched: put that fix's package in the re-review brief's `[CASCADE_FIX_DIFF]` (`references/re-review-brief.md`).

Coupling the plan did not declare is not a cascade: the stage gate's full build and full suite (section 4) are the backstop that catches it.

**The breaker.** When round 5 still leaves findings open, stop dispatching and adjudicate each: a contestable one is parked — `TASK-NNN: parked — <finding> — Ruling: <why>`; a load-bearing one gets a ruling on the smallest unblocking change. Silent discards are forbidden. Never complete a task — and so never let a task that depends on it complete — with a HIGH finding neither fixed nor parked with a ruling. A task never reopened takes the breaker for its open findings and kept verify failures; a task with a `reopened` note and no later `complete` line takes the `cap reached` stop instead.

**Repairing after the loop.** When a testing or review FAIL or REJECT, or red CI, loops the item back (section 1), each failure is repaired on the task that owns it: the task whose Files hold the failing file. A failure outside every task's Files is a plan change (3.2, exit 2), never routed to another task. Ledger `Note TASK-NNN: reopened — <testing|review|ci> <first 8 chars of the execution id>` first, then the usual round lines, continuing the task's round count, then a new `TASK-NNN: complete …` line. Five rounds is the whole life of a task: a repair that finds it at the cap never runs rounds 6–10 and is never parked to completion: ledger `Note TASK-NNN: cap reached — <failure>`, let the seats in flight finish, dispatch nothing new for the item, apart from the one minimal fix below, and report the failure to the human. Apart from the one minimal fix below, which the session makes on its own decision, only the human ends the stop: by `kf cancel`, or by `kf stage <f> planning`, where the re-approved contract gives the work a new task with its own five rounds, or no longer requires what failed. The session that resumes after that approval ledgers `TASK-NNN: complete (commits <a7>,<b7>,…, superseded by TASK-MMM)`, or `… superseded by contract)` when no task replaces it. Either line ends the stop. A task waiting on TASK-NNN's verify (3.2) re-verifies once TASK-MMM commits, or at once under `superseded by contract`, and a task depending on TASK-NNN waits for TASK-MMM's `complete` line, the re-approved plan listing TASK-MMM among its dependencies. The task's `tasks.md` box stays ticked. A `reopened` note cancels the task's earlier `complete` line: wherever the loop asks whether a task is complete, only a `complete` line after its latest `reopened` note counts. No other line shape is written for a repair.

**A minimal fix past the cap.** When the five rounds are spent — the breaker or the `cap reached` stop — and what stays open is the smallest change that closes it (one function or one condition, no new behaviour, no file outside the task's Files), make that change instead of parking it or stopping: ledger `Note TASK-NNN: decided — minimal fix past the cap: <the change>`, dispatch one fresh developer for that change alone (a round test-writer first when a test must pin it), then re-review it and verify it, without a `fix round` line; the package and verify `kf next` names cover the task's whole commit list, so scope the reviewer's brief to the fix commit. Its `dispatched` lines carry no `round=`, so the fix never counts as a sixth round. The decided note is the session's own decision, not the human's approval, and the session names the fix to the human in its next report. After a reopen, `kf next` stops printing the task's stop once the decided note is ledgered, and names the after-commit package, verify and review of the fix and every other task's due seats as usual (a task never reopened gets a task-level `Breaker` decide instead, which the decided note closes); the fix's own developer is the one dispatch the session makes on the decided note, and the task's `complete` line, earned as in 3.5, ends the stop. For a task never reopened, the breaker's ruling on the smallest unblocking change is this fix. One minimal fix per task; anything larger, or a second one, keeps the breaker or the stop for the human.

### 3.5 Complete the task

`kf next` prints `complete TASK-NNN` once the ledger earns it; completion is never inferred from the absence of open seats. A task stopped at `cap reached` gets it only after a `superseded` line or its one minimal fix past the cap (Repairing after the loop), and there is no plan-order barrier: independent tasks complete in any order. Then tick the task in tasks.md and append `TASK-NNN: complete (commits <a7>,<b7>,…, review clean)` or `… (<K> parked)` with `kf record <f> complete TASK-NNN -- commits <a7>,<b7>,…, review clean`, listing the task's commit list, naming any verify failure X parked. "Review clean" certifies the diff matched the brief and the code is sound; it certifies nothing visual. A task whose deliverable is something a person looks at gets a real run before its ledger line (start the app at the item's domain or port, exercise the screen) — the plan should have flagged it.

**No subagent tool in your runtime?** Implement task by task in the same order (brief, tests, implement, commit, ledger), but **do not fill the independent seats yourself** — a session does not grade its own work, and it never fills the test-writer and the developer seats in one session and claims them independent: tests and code written by one session are one seat. Write `TASK-NNN: implemented, test-writer seat: none, review seat: none` in the ledger — it counts as the task's `complete` line, on resume too — and leave the review to the review stage, which then treats every task as unreviewed and reviews the whole branch at the tier the diff demands. A `complete (review clean)` line without an independent reviewer is a lie the ledger must not carry.

## 4. Tick tasks as they land; gate on build

```bash
{build_command}
```

When `.kf/config.json` sets `harness.verify.stage`, `kf verify <f> --stage` replaces the hand-run build gate: run it in the worktree once all tasks are complete, instead of `{build_command}`. Exit 0 is the PASS and exit 1 the FAIL below; exit 3 means your call is wrong — fix it and re-run.

- PASS → continue.
- FAIL → the failing task's developer fixes, re-run.
- Failed again → STOP, show error, ask.

When all tasks are complete, run the FULL build and the FULL suite (not just the touched module), in the worktree. Collect every ledger `Ruling:` line into your final message under "Rulings I made", each with what it costs if wrong — that list is the only place the decisions you took on the human's behalf reach them.

Then run `kf loop-stats <f> --record` (it prints the item's report and writes (replacing any earlier) its row in `.works/loop-metrics.md`) and `kf loop-stats --all` (it prints the history and its `largest:` line), and print the item's report and the `largest:` line in your final message beside "Rulings I made". A session with no subagent tool has no seat lines and skips `--record`. An orphan a resume re-dispatched is expected and recorded. When `--record` refuses for unparsed lines, other orphans or late stamps, fix the ledger lines it lists and run it again; never hand-edit `.works/loop-metrics.md`. The numbers report where the loop's time went; they change no rule of the loop.

Do not modify the approved requirement, plan or test-case contract. Project-specific permissions for database operations and other external actions still apply.

## Decisions

`kf next` prints a `decide` where the next step is a judgement, not a rule. Each holds its own task's actions — a task-less one holds every new seat — until the ledger gains the line it names under `closes with`. A `Note TASK-NNN: decided — <what>` note closes one decide of its task, the earliest still open.

### Conflict scan

The ledger has no `Scan:` line yet. Run the pre-task conflict scan (3) and write its rows, or `Scan: clean` when it finds none; one planned task is `Scan: clean`. Closes with any `Scan:` line.

### Seat status

A seat's latest `done` is `NEEDS_CONTEXT`, `BLOCKED` or `DONE_WITH_CONCERNS`. Judge it as the 3.2 status list says: supply context, change the model, split the task, or address the concerns. Closes with a re-dispatch of that seat, a `Ruling:` naming the task, or `Note TASK-NNN: decided — <what>`; a developer's BLOCKED that quotes `commit made` also closes with `Note TASK-NNN: commits <sha7>`.

### Commit missing

A developer reported DONE but no commit of the task is recorded in a note, a review package or its report. Read `git log` and the report: record `Note TASK-NNN: commits <sha7>` for the commit that exists, or send the developer back — DONE requires a commit. Closes with that note or a re-dispatch.

### Verify exit 3

The task's latest verify exited 3: the call was wrong, or kf could not run it (3.2). Fix the call and re-run it, or report a kf error to the human; never a fix round. Closes with a new `TASK-NNN: verify started` or `Note TASK-NNN: decided — <what>`.

### Breaker

Round 5 of a task never reopened left findings or a kept verify failure open. Adjudicate each as The breaker (3.4) says: park the contestable with `TASK-NNN: parked — <finding> — Ruling: <why>`, rule on the smallest unblocking change for a load-bearing one. Closes with `Note TASK-NNN: decided — <what>` after the `parked` lines.

### Invalid ceiling

`kf tasks <f> --json` reports `developers.source: "invalid-config"`: `.kf/config.json` failed for another key, so the developer ceiling reads 1. Ledger a `Ruling:` that quotes `developers.error` and report it to the human. Closes with that `Ruling:` line.

### Drift

Under `--resume`, a task's report names a commit dated after its open developer dispatch, with no `developer done` after it: the developer finished and the session lost the report. Read the report, add the commit to the task's commit list and record `TASK-NNN: developer done status=DONE` — never re-dispatch it. Closes with that line.

### Unknown task

The ledger names a task the plan no longer has (a replan dropped or renumbered it). Decide what its lines mean for the current plan — superseded, folded into another task, or a plan defect to stop on. No seat starts for it. Closes with `Note TASK-NNN: decided — <what>`.

---

## References

- `references/test-writer-brief.md` — the test-writer dispatch, verbatim.
- `${CLAUDE_PLUGIN_ROOT}/skills/flow/references/researcher-brief.md` — the researcher dispatch, verbatim.
- `references/developer-brief.md` — the developer dispatch, verbatim.
- `references/automation-writer-brief.md` — the automation-writer dispatch, verbatim.
- `references/task-reviewer-brief.md` — the task review dispatch, verbatim.
- `references/re-review-brief.md` — the scoped re-review after a fix round.
- `references/task-loop.md` — model selection, the ledger, fix-loop mechanics, the rationalizations to refuse.
- `${CLAUDE_PLUGIN_ROOT}/skills/review/scripts/review-package` — the review package script (shared with the review stage).

## Done

All tasks complete, build and suite green, rulings reported. Hand off:

```text
Load the kf:test skill and move the feature to testing.
```

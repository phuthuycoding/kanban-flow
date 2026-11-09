---
feature: kf-next
context: harness
created: 20261107_1222
kind: feature
status: archived
---
# Spec Requirement

## Feature
kf-next

## Objective
Move the task loop's scheduling decisions from prose into tested code: `kf next` answers what the session runs now, `kf record` writes the ledger, and the session keeps dispatching every seat itself.

## Problem Statement
`kf drive` was retired (#115) because a background run hid its state. The loop moved into the session, and its scheduler moved into prose: `skills/implement/SKILL.md` is 50 KB and carries the dispatch conditions, the live cap, contention handling, fix rounds, cascades and a 12-step resume procedure. An LLM executes that prose on every turn. A misread rule changes the run silently, and none of it has a unit test. The ledger is hand-written, down to timestamps read from `date`, and `kf loop-stats` then parses it back and refuses lines that drifted from the grammar.

## Divergence
First Principles.

- Fundamental truths: only the session can spawn `Agent()`, so kf can never fill a seat. The human must see each seat in the transcript. State must survive compaction. Writing a brief, judging a finding and making a ruling need a model.
- Questioned assumption: "scheduling needs a running process". It does not. What the loop orders and gates is a function of files already on disk, so a short-lived query can answer it. Some rules need an evidence judgement; those stay with the session, and `kf next` says when one is due.
- Rebuilt shape: a pure function over those inputs behind `kf next`, and a writer behind `kf record`. The ledger grammar stays, so `kf loop-stats`, `kf:travel` and well-formed ledgers keep working.

IDEAS SURFACED: nine ledger shapes already have a strict grammar and a parser, so `kf next` needs no new state file. A `decide` action gives judgement a defined place in the loop.
SCOPE DECISION: ordering and gating move into code at once, because a half-moved scheduler leaves two sources of truth. Each judgement rule stays in the skill, and `kf next` names when it is due.
REMAINING BLIND SPOTS: whether the skill shrinks as much as expected, and how much each extra CLI call costs per seat.

## Scope
### In Scope
- `kf next <feature> [--resume] [--json]`: a read-only query printing the actions due now.
- `kf record <feature> <event> ...`: writes one ledger line with the real clock.
- Moving into code: dispatch conditions, test-writers ahead, seat order after a commit, the live cap, contention step-down and held re-runs, routing of verify exit codes, fix rounds, cascade re-reviews, the completion check and the resume order.
- `kf next` and `kf verify --task` for a bug (#139 item 1).
- Rewriting `kf:implement` around both commands, with the reasons kept in `references/task-loop.md`.

### Out of Scope
- Spawning agents, running in the background, or any process that outlives the command. That is what #115 removed.
- Running `kf verify` from `kf next`. It names the verify to run; the session runs it.
- Changing the nine ledger shapes or the `kf loop-stats` figures. New lines join the group those figures ignore, and two side effects are accepted: `otherTimed` rises and an in-progress wall time can extend to a trailing note.
- Removing or relaxing the live cap (#146 measures that).
- Gate evidence (#145), test tiers (#146) and the test stage (#147).
- Judgement: writing briefs, choosing models, judging findings, the breaker's parking decision, routing a failure to another task, handling `TEST_DISPUTE`, and chain subagents. These stay in the skill.
- Building and installing the binary and plugin. That is a named follow-up after this PR merges, before #145 starts.

## Affected surfaces
- README.md
- docs/workflow
- .github/pages/index.html
- CHANGELOG.md
- CLI help
- skills/implement
- skills/travel

## Actors
- Controller session: the Claude Code session running `kf:implement`. It calls both commands and dispatches seats.
- Human: watches seats in the transcript. Gains no new gate.
- `kf:travel` session: runs the same loop for items it owns.

## Functional Requirements
### FR-001
- Requirement: `kf next <feature>` prints every action due now, and `--json` prints the same actions as structured data.
- Priority: must
- Notes: inputs are the plan's task graph and `Execution:` lines, the `Level` or `Test Level` of the Test Strategy, the Test types in `phase-2-test-case.md`, `loop/progress.md`, `Commits created` in `loop/task-NNN-report.md`, the matching block of `loop/task-NNN-verify.log`, `tasks.md` for a bug, `git log` of the item's branch read from its worktree when it has one, and `harness.developers.max`. Action kinds: `dispatch` a seat, `verify`, `write` an owed ledger line, `complete` a task, `wait` with a reason, `decide` a judgement rule named by its skill section, `stop` with a reason, and `finished`, printed when every task is complete and no line is owed. Each `decide` holds its own task's later actions and no other task's. It closes when the ledger gains the line it names: a new dispatch of that seat, the note the rule writes, or `Note TASK-NNN: decided — <what>`.

### FR-002
- Requirement: `kf next` changes no file, leaves no process running after it exits, and prints the same actions when called twice with no change between them.
- Priority: must
- Notes: this is the line between this feature and `kf drive`.

### FR-003
- Requirement: `kf next` releases a task's developer only when every dependency's developer has finished with a commit, the task has hashes after its test-writer or a `no test-writer` line, its Files overlap no open task, no earlier overlapping task is incomplete, and fewer than N developers are in flight.
- Priority: must
- Notes: "open task" keeps today's meaning and Files unknown overlaps everything. Fix-round and resume-commit developers count against N and take a freed seat before new tasks. A reopened task's first round seat also waits for earlier overlapping tasks. An inline seat does not count against N. A developer held back gets a `wait` naming the cause. When only an overlap or only the cap holds it, its `developer waits` line is a `write` action owed once.

### FR-004
- Requirement: `kf next` releases test-writers for at most 4 tasks at once, counting those in flight, in wave then plan order, never for a task held by an overlap, and names the `wave <w>:` line due for same-wave test-writers.
- Priority: must
- Notes: a task with no Unit or Integration TC gets a `write` action for its `no test-writer` line, and the session supplies the reason. The `test hashes` line is a `write` action after a test-writer's `done`. On a bug, a `tasks.md` line containing the word `regression` gets a test-writer and any other line a `no test-writer` action. On an empty ledger the pre-task conflict scan is a `decide`, closed by any `Scan:` line, and no seat is released before it. The session writes all rows of a scan before asking again. A clean scan, or a plan with one task, writes `Scan: clean`.

### FR-005
- Requirement: at a task's last commit, `kf next` names the review package, the verify and the code-reviewer together. For a UI task under `Level: full` it first names the automation-writer after the developer's commit, unless the session already dispatched it ahead of the developer for a `data-testid` contract. On both paths it then names the resume-commit developer once the task commit exists and the specs are done.
- Priority: must
- Notes: a task's commit list comes from its `commits` ledger lines, in history order, and for a task with no `commits` line from its `review package` lines, then `Commits created`. A DONE with no commit in either is a `decide`. A re-review is scoped to the commits recorded since the previous review, carries `round=<R>`, and needs the same package step.

### FR-006
- Requirement: `kf next` computes the live cap N from the latest `Ruling: developer cap` line and the decisions owed after it: the start value, one step up per clean parallel wave decided in wave order, the `no step-up` outcomes, halving on a contention event, and a lowered ceiling. It names each owed line as a `write` action.
- Priority: must
- Notes: same rules as today: no step-up past the ceiling, on the last wave or past the widest incomplete wave. N halves at most once per contention event, once per signature per task until a pass, and stays 1 at 1 with no ruling. An `invalid-config` ceiling reads 1 and a `decide` reports it, closed by a `Ruling:` quoting the error.

### FR-007
- Requirement: on a contention-shaped verify failure, which goes before the routing of FR-008, `kf next` names the earliest held re-run once fewer than N developers are in flight, one re-run at a time, and releases no developer until the last held re-run has finished.
- Priority: must
- Notes: classified from that run's verify log block with today's strings. A failed verify with no log block gets one plain re-run first. A re-run's failure never steps N down. An orphan re-run stays held by the same rule, and uses `--at-head` when a `verify waits` note comes after the task's last `verify done`.

### FR-008
- Requirement: `kf next` routes a verify result by exit code: 0 passes, 1 enters a fix round when the task's review reports, 2 is a `stop` for a plan change, and 3 is a `decide` that never counts as a round.
- Priority: must
- Notes: the exit-2 `stop` holds every new dispatch of the item. It closes with a `decided` note written after the human re-approves, and `kf next` then names the verify again. kf cannot tell why a suite failed, so before asking again the session writes `Note TASK-NNN: verify waits — <file> (TASK-MMM)` or `Note TASK-NNN: verify routed — TASK-MMM` when the evidence rule of 3.2 applies, and `kf next` then acts on that note. `verify waits` gives an `--at-head` verify once the named task commits, and neither note counts as a round.

### FR-009
- Requirement: `kf next` names the next fix round for a task with review findings, a kept verify failure, or a `reopened` note with no round seat after it, says whether it resumes the original developer (rounds 1 to 3) or dispatches a fresh one (rounds 4 and 5), and never names a sixth round.
- Priority: must
- Notes: rounds count across the task, a reopened task's included. Sending a finding to the test-writer or automation-writer stays the session's choice, and a done `round=` seat then gives the `test hashes` line and the resume-commit developer. The `fix round <R>/5` line is a `write` action. At the cap, a task never reopened gets a `decide` for the breaker, closed by a `decided` note after its `parked` lines. A reopened task gets a `stop` with its `cap reached` note as a `write`, and that note with no later `complete` holds every new dispatch.

### FR-010
- Requirement: `kf next` derives each cascade re-review from commits and dependencies: a fix commit of H landing after X's developer was dispatched owes X a re-review when X depends on H directly or transitively and X has no standing `complete` line.
- Priority: must
- Notes: it names the owed line as a `write` action, then the re-review with `round=<R>` of H and `cascade=<sha7>`. A task with one unanswered is not complete. A complete task is reviewed again only after a `reopened` note, as today.

### FR-011
- Requirement: `kf next` names a task's `complete` line as due only when, counting only lines after its latest `reopened` note, it has `developer done`, a passing verify after its last commit, a clean review or a closed breaker, no cascade unanswered, and every dependency complete.
- Priority: must
- Notes: a verify also passes when its failure was routed to X and X's next verify passed or X parked it, or when it was parked at the cap. Any written `complete` line with no later `reopened` counts, superseded ones included, and so does the no-subagent `implemented` line. A reopened task never completes by parking.

### FR-012
- Requirement: `kf next --resume` lists every open seat and open verify for a re-run before any new developer. Without `--resume` they read as in flight.
- Priority: must
- Notes: kf cannot tell a running seat from a lost one, and only the session knows it lost context. "Open" means a dispatch with no `done` and no later dispatch of the same task and seat, so an honest orphan stays closed. A lost developer is listed whatever N is. A pending re-run keeps the hold of FR-007. A repeated `--resume` lists a seat again until the session records the new dispatch. An inline developer is listed for the session to resume itself, never as a spawn. Commits named in the ledger are matched against the item branch's `git log` when it is non-empty; a sha it lacks (after an amend or a rebase) is left out of the verify list and named in the Verify exit 3 reason.

### FR-013
- Requirement: `kf next --resume` gives a `decide` for drift, not a re-dispatch, when a task's report names a commit dated after that task's latest `developer dispatched` line and no `developer done` follows that line.
- Priority: must
- Notes: takes precedence over FR-012, and closes when the session records the `done`. It is today's resume step 4. A plain `kf next` still reads that seat as in flight, because a live developer writes its report before returning, but adds a hint that the report holds a commit. So a forgotten `done` is visible without a resume.

### FR-014
- Requirement: `kf next` gives a `decide` action for a seat that ended with `NEEDS_CONTEXT`, `BLOCKED` or `DONE_WITH_CONCERNS`, naming the status and its rule.
- Priority: must
- Notes: without this such a task would wait forever. A `TEST_DISPUTE` reaches the ledger as `status=BLOCKED`, so it takes this path too. It closes as in FR-001: a re-dispatch for `NEEDS_CONTEXT` and `BLOCKED`, and a `decided` note when the task goes on as for DONE. A `BLOCKED` quoting `commit made` closes with the `commits` line for that sha.

### FR-015
- Requirement: `kf record` appends exactly one line for an event from a fixed list, stamped from the real clock, and refuses an event that is not in the list or that the ledger contradicts, such as `done` with no open dispatch or a repeat of a wait already recorded. A refusal writes nothing.
- Priority: must
- Notes: the list covers the nine shapes except legacy `fix queued`, plus `Note TASK-NNN: commits <a7>,<b7>`, `Note TASK-NNN: decided — <what>`, `Note TASK-NNN: verify routed — TASK-MMM`, rulings, notes, `test hashes`, `test dispute`, `Scan: clean`, `parked`, `no test-writer`, `implemented`, `minor (deferred)`, `unverified`, `brief written`, `review package`, `wave` and `Scan:` lines. The three new lines use the `Note` form because a bare `TASK-NNN: verify ...` line is refused by `kf loop-stats --record`. The `commits` note is recorded by the session from a seat's report or reply and by an inline seat itself. It writes the ledger header first when the file is missing, and holds the item lock. A second dispatch of an open seat is allowed, and leaves an honest orphan.

### FR-016
- Requirement: `kf next` refuses to schedule when the ledger has a line it cannot read, names each line, and tells the session to repair it.
- Priority: must
- Notes: the refusal set is what `parseLedger` marks unparsed, plus unstamped lines of the nine shapes, plus malformed or unstamped lines the scheduler reads: cap rulings, `no step-up`, `verify rerun`, `verify waits`, `verify routed`, `no test-writer`, `test hashes`, `commits`, `decided`, `parked`, `reopened`, `cap reached`, and the inline note. A wrong schedule costs more than a stop. An old ledger with such a line is repaired, not auto-accepted.

### FR-017
- Requirement: each checkbox line of a bug's `tasks.md` carries `TASK-###`, `kf next` schedules those lines in file order with Files unknown, and `kf verify --task` accepts them with no Files check.
- Priority: must
- Notes: closes #139 item 1, which moves here from #145. `kf:implement` writes the id when it creates `tasks.md`. A `tasks.md` with no `TASK-###` gets a refusal naming the fix. Files unknown keeps a bug's tasks sequential.

### FR-018
- Requirement: `kf next` marks a task in a wave the plan declares `Execution: wave <w> inline`, so the session fills the developer seat itself, its fix rounds included.
- Priority: must
- Notes: the marked seat is outside the cap. In an inline wave, a `developer dispatched` line with no inline note after it is a chain subagent and counts against N. Choosing a chain stays with the session.

### FR-019
- Requirement: `kf:implement` dispatches from `kf next`, writes ledger lines through `kf record`, and no longer states the rules of FR-003 to FR-013.
- Priority: must
- Notes: every seat is still an `Agent()` call from the session. Judgement rules stay. The plan lists each moved paragraph by its opening phrase, and a surface test asserts those phrases are gone. Every surface test pinning moved text moves with it, `adaptive-cap-surface.test.ts` and `inline-execution.test.ts` among them, and `kf:travel`'s resume reference points at `kf next --resume`.

### FR-020
- Requirement: `kf next` gives the expected actions on a new committed fixture set, each holding a ledger, the plan inputs it needs and its expected actions, covering a fresh item, a mid-wave item, a resume with an honest orphan, contention, a reopen and the legacy `fix queued` shape.
- Priority: must
- Notes: the set lives under `src/tests/fixtures/`. The existing `loop-stats` fixtures hold only ledgers, so they cannot be the oracle. `resumed.ledger.md` stays a refusal case under FR-016. An in-flight item with a well-formed ledger continues without migration.

### FR-021
- Requirement: where this spec does not restate a scheduling rule, `kf:implement` at 543cd17 governs, and a difference from it is a defect, except a deviation a later FR states (FR-025).
- Priority: must
- Notes: the spec does not copy all of the skill's text. The plan maps each moved paragraph to a test case.

### FR-022
- Requirement: for every ledger `kf record` can produce and every plan, `kf next` prints `finished`, or for each plan task that is not complete at least one witness: an action naming the task, an In-flight entry naming it, or a wait whose blocker chain ends, without a cycle, in an action, an In-flight entry, or an item-level stop or decide of the same output.
- Priority: must
- Notes: the human's rule (2026-11-08): "getting stuck is not OK, the loop must run smoothly". Every decide names its closes, each alternative a line `kf record` accepts whose recording changes the next output for that task; every stop's reason names the line or the human step that ends it; every wait's reason names what it waits for. A state the scheduler has no rule for prints `stop TASK-NNN: kf next has no rule for TASK-NNN in <phase> — report this`, never silence. The `Action` types do not change. The state is computed by one per-task state machine folded once from the ledger. The liveness audit of 2026-11-08 (reviews/liveness-audit.md, 37 reproduced states plus 2) is its regression set.

### FR-023
- Requirement: `complete TASK-NNN` is printed only when the task's verify passed on its latest commits (or passed by route, or a kept failure is waived by parking at the cap), its own review is clean (or waived by parking), every cascade re-review is clean or cleared by a later own clean review or parked at the cap, no failure routed into the task is unanswered, no seat or implementer step of the task is open or owed, no judgement of the task is open, contention neither holds nor runs a re-run of it, every dependency is complete, and any minimal fix past the cap passed its own review and a verify started after the fix commit; and never beside another action of the same task.
- Priority: must

### FR-024
- Requirement: the In-flight list, the developer count against the live cap, and `--resume` read one set: the open, non-inline developer seats of plan tasks that are not complete.
- Priority: must
- Notes: a resumed seat is exempt from holds and from the cap; it is inline when its own line or the plan marks it inline. An open seat of a task the plan no longer has, or of a complete task, holds no cap slot.

### FR-025
- Requirement: at most one code-reviewer of a task is in flight; any other owed review of that task (its own or a cascade re-review) prints `wait TASK-NNN: code-reviewer of TASK-NNN in flight`, oldest first.
- Priority: must
- Notes: a deviation from 543cd17, which let a task's own review and a cascade re-review run together. The ledger's `done` line has no cascade field, so two open reviewers of one task cannot be told apart, and the nine ledger shapes do not change. Decided by the human with the state-machine plan (2026-11-08).

### FR-026
- Requirement: at the five-round cap, a `Note TASK-NNN: decided — minimal fix past the cap: <change>` line owes one fresh developer with no `round=`, both at the Breaker of a task never reopened and at the `cap reached` stop of a reopened task; the Breaker closes on a `parked` line plus a `decided` note in either order; a failed or abandoned minimal fix brings back the Breaker, closable only by parking, on a task never reopened, and the cap stop on a reopened task; cascade findings past the cap give a park-closable Breaker on a task never reopened and a stop on a reopened one; a second minimal-fix note owes nothing.
- Priority: must
- Notes: the human's rule "A minimal fix past the cap" (skills/implement/SKILL.md § 3.4). A verify started before the fix's developer reported does not count as the fix's outcome.

## Non-Functional Requirements
- `kf next` answers in under 1 second on a 1,000-line ledger.
- The scheduling logic is a pure function over parsed inputs, with unit tests that need no git repository and no filesystem.
- `kf next` makes no network call.
- No new runtime dependency.

## Main Use Cases
- UC-001 Run a task loop from `kf next`
- UC-002 Resume a loop after compaction
- UC-003 Handle a verify failure, a fix round and a cascade
- UC-004 Run a bug's tasks

## Constraints
- The session is the only process that spawns seats.
- The nine ledger shapes in `references/task-loop.md` § The ledger do not change.
- The human gates do not change.
- `kf:travel` keeps its behaviour. Only its resume reference changes.

## Assumptions
- The command is named `kf record`. The issue left the name open, and `kf done` would read like the `done` stage.
- `kf next` reads the graph and overlaps through the existing `kf tasks` code, not a second parser.
- The `commits`, `decided` and `verify routed` lines are added to the ledger's unparsed-for-figures group, so `kf loop-stats` figures do not change.
- #148 was closed as a duplicate of #149, the issue `kf new` opened.

## Acceptance Criteria
- [ ] Given a plan and an empty ledger, `kf next --json` names the conflict scan and no seat. After a `Scan:` line, `Scan: clean` included, it names the first eligible test-writers, a `no test-writer` line for a task with no Unit or Integration TC, and no developer.
- [ ] Two runs in a row print identical output and leave every file's mtime unchanged.
- [ ] A task whose Files overlap an open task gets a wait naming the holding task, not a dispatch.
- [ ] With N developers in flight no further developer is released, and an inline task still starts at N = 1.
- [ ] After a non-UI developer's commit, one call names the review package, the verify and the code-reviewer together.
- [ ] A UI task under `Level: full` gets the automation-writer, then the resume-commit developer, then the package, verify and reviewer, and a task whose automation-writer ran ahead still gets the resume-commit developer.
- [ ] A clean parallel wave with more work ahead raises N by one and names the ruling. On the last wave it names the `no step-up` note.
- [ ] A contention failure halves N once per event, and two failing verifies give two held re-runs, with no developer released until both finish.
- [ ] Verify exit 2 gives a stop that holds the item until its `decided` note, and exit 3 gives a `decide`. Neither counts as a round. A `verify routed` note moves the failure to the named task.
- [ ] Round 4 is a fresh developer, no sixth round appears, and a reopened task at the cap gives a stop. A `reopened` note with no round seat names a round, even after a clean review.
- [ ] A fix commit of H owes a re-review to a dependent X dispatched before it, and not to an independent task or a complete one.
- [ ] A task with all its own checks met is not complete while a dependency is incomplete.
- [ ] A `decide` holds its own task, not others, and repeats until the line it names is written.
- [ ] `kf next --resume` lists an open seat for re-dispatch, and plain `kf next` lists it as in flight. An honest orphan appears in neither.
- [ ] A report commit dated after the latest dispatch gives a drift `decide` under `--resume` and a hint without it. An older commit gives a re-dispatch.
- [ ] A seat ending in `NEEDS_CONTEXT` gives a `decide`, not a wait.
- [ ] `kf record` refuses `done` with no open dispatch and writes nothing. Its first event writes the header. Two concurrent calls leave two whole lines.
- [ ] A malformed scheduler line or an unstamped `developer done` makes `kf next` exit non-zero, naming the line.
- [ ] A bug with two `TASK-###` lines runs them one after the other, only the `regression` line gets a test-writer, and `kf verify --task` passes on each.
- [ ] On every ledger of the liveness audit, `kf next` prints `finished` or a witness for every incomplete task, and never `complete` beside an open finding, routed failure, cascade or seat of that task.
- [ ] A bounded exploration of six small plans finds no state where `kf next` is silent, deadlocked or repeats an action after it was recorded.
- [ ] A task whose own review and a cascade re-review are both owed runs them one after the other, the second waiting on the first.
- [ ] A minimal fix past the cap is named as a fresh developer with no round; when it fails, the Breaker or the cap stop returns.
- [ ] A surface test finds none of the plan's moved-paragraph phrases in `skills/implement/SKILL.md`, and `kf loop-stats` reads a ledger written through `kf record` with no refusal.

## Edge Cases
- A plan with a dependency cycle or an invalid graph, or a bad `harness.developers` value: `kf next` refuses like `kf tasks`.
- A plan with no tasks: `kf next` refuses and never prints `finished`.
- No ledger file yet: an empty ledger, and the session's first `kf record` writes the header.
- The ledger names a task the plan no longer has after a re-approval: a `decide` action naming the task. No seat is dispatched for it.
- `harness.developers.max` lowered mid-run: a ruling is owed, seats above it finish and none are cancelled.
- A `verify waits` note on a neighbour's commit: never a fix round.
- A session records `done` for a seat a resume re-dispatched: the `done` answers the latest dispatch and the earlier one stays an honest orphan.
- Two controllers on one item: the owner rule in `kf:implement` still applies.

## Open Questions
- None block planning. The JSON shape of an action is settled in Phase 2.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`vitest.config.ts`), with `src/tests` driving the built CLI for the integration cases
- Coverage Target: 80%

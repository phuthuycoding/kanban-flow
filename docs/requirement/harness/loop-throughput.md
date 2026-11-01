---
feature: loop-throughput
context: harness
created: 20261101_1349
kind: feature
status: archived
---
# Spec Requirement

## Feature
loop-throughput

## Objective
Overlap every step of the `kanban-implement` task loop that can safely overlap in one worktree — test-writer N+1 beside developer N, code-reviewer N and the full-suite verify of N beside developer N+1, the controller's own work beside seats — with exactly one developer writing code at a time and at most two tasks in flight; and measure every loop mechanically, keeping a per-machine history, so each loop reports where its time went and the next improvement is chosen from data.

## Problem Statement
The loop is strictly sequential: test-writer → developer → `kf verify` → code-reviewer → fix rounds, one task at a time, and the controller idles while a seat runs. The only measured run (drive-retire, 7 chained tasks, 2026-11-01) took ~85–90 min by git timestamps; seats account for ~55 min and the controller's own work for the rest. Ad-hoc overlap during that run worked but broke `kf verify --task --base`, whose `base..HEAD` range holds another task's commits once tasks interleave (observed exit 2), and polluted a developer's suite with the next task's uncommitted failing tests (ledger: "suite 1072 + 4 expected TASK-007 failures"). Probes on 2026-11-01: two `npm test` runs 5 s apart in one checkout both pass (1131/1131), so a shared `dist/` is not a collision when the source is the same; the full suite passes in a detached worktree with a `node_modules` link (48 s). Two developers editing one worktree would break each other's `tsc` build and typecheck, because the vitest globalSetup builds all of `src/`. The ledger has no timestamps, so nothing about speed can be measured after the fact, and travel's learned estimate factor rests on seat durations it reads from notifications.

## Scope
### In Scope
- Pipelining neighbouring tasks in one worktree with one developer at a time: test-writer N+1 beside developer N; code-reviewer N and `kf verify` of N beside developer N+1; a fix round of N queued until the running developer reports; a cascade re-review of N+1 after any fix of N.
- Same-wave tasks with disjoint Files run their test-writers at the same time; their developers run one after another.
- The controller does its own work (next brief, hashes, review package, ledger) while seats run.
- The full suite runs in `kf verify --task --commits` in a clean detached checkout, beside the task's code-reviewer; the developer's own runs while another seat is in flight are advisory.
- Enablers: `kf verify <f> --task TASK-### --commits <sha>[,<sha>…]`; `review-package --commits`; `kf tasks --json` `overlaps`; a staging rule for concurrent seats.
- Measurement: a machine-readable ledger grammar with ISO timestamps and seat models; `kf loop-stats` computing an item's time buckets; a per-machine history file with a cross-item summary naming the largest time bucket; the loop's final message carrying both; travel's measured work taking the implementation-phase seat minutes from `kf loop-stats`.
- A per-task resume rule for several in-flight tasks.
- Docs for every surface listed under Affected surfaces.

### Out of Scope
- Two developers writing in one worktree at the same time, and per-seat worktrees with merge-back (retired with `kf drive`, PR #115). The detached worktree of FR-013 is `kf verify`'s own, read-only and temporary.
- A per-run test build directory: probed unnecessary (same source, same output).
- A lighter or batched review for prose-only tasks — drive-retire's prose tasks had real findings.
- Changing model tiering rules (the ledger records the model so a later item can decide from data).
- Plan-sizing guidance.
- Acting on the measurements automatically (changing the loop's rules from the numbers); the loop reports, the human or a later item decides.
- Changing the `kf verify --base` mode or `review-package BASE HEAD`: they stay for a single contiguous task.

## Affected surfaces
- `skills/kanban-implement/SKILL.md` and `references/task-loop.md`, `test-writer-brief.md`, `developer-brief.md`, `task-reviewer-brief.md`, `re-review-brief.md`
- `skills/kanban-flow/SKILL.md` (CLI reference block, harness section), `skills/kanban-flow/agents/developer.md` steps 6 (test runs) and 7 (staging)
- `skills/kanban-review/scripts/review-package` usage header; `skills/kanban-review/SKILL.md` and `references/review-tiers.md` where they name the script's arguments
- `skills/kanban-plan/SKILL.md` where it names `kf verify`
- `skills/travel/SKILL.md` and `references/estimation.md` (ledger line shape, work source)
- `kf verify -h`, `kf tasks` JSON, new `kf loop-stats -h`
- `README.md`, `kanban-flow/README.md`, `.github/pages/index.html`, `CHANGELOG.md`
- `docs/workflow/cli-reference.md`, `harness.md`, `lifecycle.md`, `gates.md`, `artifacts.md`, `skills.md`, `autoconfig.md`, `source-layout.md`, `docs/workflow/README.md`
- `kanban-flow/templates/phase-2-implementation-plan.md` where it names `kf verify`

## Actors
- Controller — the session running `kanban-implement`
- Seats — `test-writer`, `developer`, `automation-writer`, `code-reviewer` subagents
- `kf` CLI (`kf verify`, `kf tasks`, `kf loop-stats`) and `review-package`
- Travel — measures items into `.kf/travel/estimates.md` and learns its estimate factor
- Human — approves the plan; reads the measurements and decides the next improvement

## Functional Requirements
### FR-001
- Requirement: `kf verify <f> --task TASK-### --commits <sha>[,<sha>…]` checks the union of files changed by exactly the listed commits (each against its first parent) against the task's Files allowlist, then runs `harness.verify.task` (FR-013); exit codes keep today's meaning (0 pass, 1 verify command failed, 2 file outside Files, 3 bad input). Exit 3 when a listed sha does not resolve to a commit, is not an ancestor of the item worktree's HEAD, is a merge commit, when the list is empty or not in history order (each sha an ancestor of the next), or when `--commits` is given together with `--base`. Files changed by commits not listed are not checked.
- Priority: must
- Notes: The drive-retire run proved the `base..HEAD` range wrong under any interleaving (ledger line "TASK-005: … exit 2"). `--base` is unchanged.

### FR-002
- Requirement: `review-package` accepts `--commits <sha>[,<sha>…]` in place of `BASE HEAD` and writes the diff of exactly those commits (each against its first parent, concatenated under the same header the range mode writes). Exit 2 on a sha that is not a commit, on a merge commit, on a repeated sha, or when `--untracked` is given with `--commits` (untracked files are other seats' work); exit 3 on an empty diff.
- Priority: must
- Notes: The task reviewer must grade only the task's commits once tasks interleave.

### FR-003
- Requirement: At most one developer seat (a task's developer, a fix round's developer, or the developer resumed to commit specs or fixed tests) is in flight per worktree at any time, and at most two tasks are incomplete with a seat dispatched: the head task H (the earliest incomplete task) and the next task. No seat of a later task is dispatched until H is complete. A fix round of H that is due while the next task's developer runs is queued and dispatched when that developer reports, ledgered `TASK-H: fix queued — developer TASK-M in flight`. While any other seat is in flight, a developer's own typecheck, lint, build and test runs are advisory: it runs focused tests, does not run the full suite, and reports failures in files it neither wrote nor was handed as `not mine: <file>`; the task's authoritative checks are `kf verify --commits` (FR-013).
- Priority: must
- Notes: Two developers editing one worktree break each other's `tsc` build (vitest globalSetup compiles all of `src/`) and typecheck. The two-task window bounds the cascade to one task and keeps every concurrent writer disjoint from the head.
### FR-004
- Requirement: `kanban-implement` pipelines the head task H and the next task X by default. Provided H's and X's Files are disjoint (FR-006 definition), the test-writer of X is dispatched when developer H starts, and developer X is dispatched when H's last task commit lands (the code commit, or the automation-writer's spec commit when the task has one), while code-reviewer H and `kf verify` of H run. When Files are not disjoint, both wait for `TASK-H: complete`, ledgered `TASK-X: developer waits — Files overlap <entry of X> / <entry of H>`. Each task's review package and `kf verify` use that task's commit list (FR-001, FR-002). When the test-writer's failing run was advisory (another seat in flight), the controller's "fails for the right reason" judgement uses developer X's step-3 run, made with no other developer in flight, and the ledger says so. The code-reviewer grades the review package; its brief states that the working tree may hold another task's uncommitted edits inside that task's Files and that files outside the reviewed task's Files are context only.
- Priority: must
- Notes: Replaces the rule "never two tasks in flight in the same git history"; the rule's reason (a mixed review package) is removed by FR-001/FR-002, not ignored.
### FR-005
- Requirement: When a fix round of head task H commits after developer X (the next task) was dispatched, task X gets a scoped re-review of its own commits after its review, with H's fix diff attached to the re-review brief: the ledger records `TASK-X: cascade re-review owed — after <fix sha7> of TASK-H`, the re-review is dispatched as `TASK-X: code-reviewer dispatched model=<m> round=<R> cascade=<fix sha7>`, and its `done` line answers it. No file check decides it: every such fix triggers it. Each `cascade re-review owed` line is answered by its own re-review (`cascade=` its sha7). Task X is not marked complete while H is incomplete or while a cascade line of X is unanswered. H is complete when its developer is done, its latest verify is `exit=0` (or its failures were routed to X and X's next verify passed, or X parked them at its cap, FR-009), its latest review is `clean` or every open finding is `parked` at the five-round cap, and none of its own cascade lines is unanswered.
- Priority: must
- Notes: By FR-003 only one task can be built on an incomplete head, so the cascade reaches exactly that task.
### FR-006
- Requirement: `kf tasks <f> --json` gives every task an `overlaps` list: one element per other task whose Files are not disjoint, naming the task and the first overlapping entry pair (`null` when either side has no Files). Two allowlists are disjoint when `filesOverlap(a, b)` in `src/workflow/allowlist.ts` is false. When the head and next task are in one wave and do not overlap, their test-writers may run at the same time; developers follow FR-003. The ledger records `wave <w>: parallel test-writers TASK-A, TASK-B — disjoint Files` or `wave <w>: sequential TASK-A, TASK-B — Files overlap <entry> / <entry>` (`— Files unknown` when a side has none).
- Priority: must
- Notes: `filesOverlap` compares static prefixes, so `src/**/*.ts` and `src/x` overlap even though neither is allowed by the other.
### FR-007
- Requirement: Concurrent seats commit only the paths they own: the developer stages by path, checks `git diff --cached --name-only` against its brief's Files plus the test files it was handed, and reports `BLOCKED` with the stray paths instead of committing when anything else is staged. Fix-round commits follow the same rule.
- Priority: must
- Notes: The drive-retire incident (a commit that picked up another seat's staged tests) is the case.

### FR-008
- Requirement: While a seat runs, the controller writes the next task's brief, hashes test files, builds review packages and writes ledger lines rather than waiting; each such step is ledgered (`TASK-NNN: brief written`, `TASK-NNN: review package <sha7>,…`), and the skill forbids waiting on a seat while such a step is pending.
- Priority: must
- Notes: Targets the ~30 min of controller time in the measured run.

### FR-009
- Requirement: After a task's last commit, the controller builds its review package, then starts `kf verify --task --commits` and dispatches the task's code-reviewer at the same time (`TASK-NNN: review package <sha7>,…`, `TASK-NNN: verify started`, `TASK-NNN: code-reviewer dispatched …`, then `TASK-NNN: verify done exit=<n>`). A verify exit 1 joins the reviewer's findings as one fix round of that task; when the failing tests belong to the other in-flight task X's Files (X's commits are in the checked-out tree), the cause decides, by evidence: the controller first waits for any running verify of X; if X's latest verify on a tree without H's fix commit passed those same tests, H broke them and the failure stays with H; otherwise it goes to X, with a `Ruling:` line naming the tests and the evidence. A failure routed to X leaves H unverified until X's next verify passes; if X's developer reports `BLOCKED` because the cause lies in H's Files, the failure returns to H as a fix round. If X parks that routed failure at its five-round cap, H counts as verified with the parked failure named in its `complete` line. No deadlock: X's verify never waits for H's completion. Exit 2 stops the task for a plan change: the controller first waits for every in-flight seat to report and ledgers their results, keeps the review result, then runs `kf stage <f> planning`. Exit 3 is the controller's error to fix.
- Priority: must
- Notes: The full suite (~48 s) runs off the developer's path.
### FR-010
- Requirement: Every ledger line after the header written by `kanban-implement` ends with ` @ <ISO-8601 timestamp with offset>`; a line is never given a second suffix. The existing shapes (`fix round <R>/5 (…)`, `complete (…)`, `minor (deferred)`, `test hashes`, `Ruling:`) keep their text before the suffix; their commit field becomes the task's commit list (`commits <a7>,<b7>,…`) instead of a range.
- Priority: must
- Notes: Suffix, not prefix, so the `TASK-NNN:` shape travel and the resume rule read stays first. Travel counts `fix round` lines (`estimation.md`); no new line shape contains that phrase.

### FR-011
- Requirement: On resume (after compaction or a new session), the controller rebuilds the state of the head task H and the next task X — the two earliest incomplete tasks; later tasks are not touched (FR-003) — and resumes each at its first unmet step, in this order: (1) no test-writer dispatched and no `no test-writer` line → test-writer dispatch (for X, under FR-004's timing); (2) test-writer dispatched without `done` → re-dispatch it; (3) no `developer dispatched` → developer dispatch under FR-004's gates (for X: H's last task commit has landed and their Files are disjoint, else wait for `TASK-H: complete`), queued behind any in-flight developer; (4) developer dispatched without `done` → re-dispatch it; (5) no `verify started` after the task's last commit → review package, verify and code-reviewer (FR-009); (6) `verify started` without `verify done` → re-run verify; (7) no code-reviewer dispatched after the last commit, or one without `done` → dispatch it; (8) a latest review with `status=findings`, or a latest verify `exit=1` kept by the task (FR-009), with no `developer dispatched` and no `fix queued` after it and the task below the five-round cap → the next fix round, queued behind any in-flight developer; at the cap → the breaker (park with rulings); (9) `fix queued` with no later developer dispatch → re-queue it; (10) a `cascade re-review owed` line without its answering `done` → dispatch that re-review; (11) otherwise → the completion check (FR-005, FR-009). A task with a `complete` line is never re-dispatched. The skill states this rule in place of "a task whose last line is a fix round resumes at the next round".
- Priority: must
- Notes: Pipelining produces several "last lines"; completion must be earned from the ledger, not inferred from the absence of open seats.
### FR-012
- Requirement: `kf loop-stats <feature> [--json]` parses the item's `loop/progress.md` (FR-014 grammar) and prints: wall-clock (first `dispatched` to last `complete`; when a task has no `complete`, to the last timestamped line, and the report says `in progress`); per seat kind (test-writer, developer, automation-writer, code-reviewer) the count, sum and median of dispatched→done minutes, and the same for verify (started→done); seat minutes (sum of all seat intervals, verify excluded); busy minutes (length of the union of seat and verify intervals); concurrency saving (seat + verify minutes − busy); controller minutes (wall-clock − busy); wait minutes (each `developer waits` or `fix queued` line to the next `developer dispatched` of that task); fix rounds (count of `fix round <R>/5` lines); cascade re-reviews (count of `cascade re-review owed` lines); tasks (distinct `TASK-NNN` with a `dispatched` line); per seat kind and model the sum of minutes. Each `done` pairs with the latest unmatched `dispatched` of the same task and seat before it; a `dispatched` left unmatched is listed by line and excluded; a `done` with no earlier `dispatched`, and any timestamped line whose start names an FR-014 shape (`TASK-NNN: ` followed by a seat name, `verify `, `developer waits`, `fix queued`, `fix round`, `cascade re-review owed` or `complete`) but does not match that shape, are listed by line number as unparsed; other timestamped lines (rulings, hashes, briefs, packages, wave lines) are counted as other-timed; lines without a timestamp are counted as `untimed`. Exit 0 on a report; 1 when the ledger is missing or has no timestamped seat line; 3 on bad input.
- Priority: must
- Notes: Mechanical, so the numbers do not depend on the controller's arithmetic.
### FR-013
- Requirement: `kf verify --task --commits` runs `harness.verify.task` in a detached, temporary git worktree checked out at the newest listed commit, with a `node_modules` symlink to the item dir's `node_modules` when it exists, and removes it afterwards on every exit path; creation failure is exit 3 `kf verify could not run: …`. `--base` keeps running in the item worktree. This repository's `harness.verify.task` is extended with `npm test`.
- Priority: must
- Notes: Probed 2026-11-01: the full suite passes in such a worktree (1131/1131, 48 s). Non-Node stacks get no dependency link; `--base` still works there.

### FR-014
- Requirement: Every ledger line `kf loop-stats` reads follows one grammar, written once in `references/task-loop.md` § The ledger and matched by `kf loop-stats`: `TASK-NNN: <seat> dispatched model=<model>[ round=<R>][ cascade=<sha7>] @ <ts>`; `TASK-NNN: <seat> done status=<STATUS> @ <ts>` (`<STATUS>` the seat's reported status; a code-reviewer's is `clean` or `findings`); `TASK-NNN: verify started @ <ts>`; `TASK-NNN: verify done exit=<n> @ <ts>`; `TASK-NNN: developer waits — <reason> @ <ts>`; `TASK-NNN: fix queued — developer TASK-MMM in flight @ <ts>`; `TASK-NNN: fix round <R>/5 (…) @ <ts>`; `TASK-NNN: cascade re-review owed — after <sha7> of TASK-MMM @ <ts>`; `TASK-NNN: complete (…) @ <ts>`. `<seat>` is one of `test-writer`, `developer`, `automation-writer`, `code-reviewer`. Other ledger lines (rulings, test hashes, briefs, packages, wave lines) carry the suffix and are not parsed for figures.
- Priority: must
- Notes: The model is recorded so model-tiering can be judged from data later.
### FR-015
- Requirement: `kf loop-stats <feature> --record` writes the item's row to `.works/loop-metrics.md` (created with a header on first use; the item's earlier row replaced, not duplicated): date, feature, tasks, wall, busy, controller, saved, waits, test-writer, developer, automation-writer, code-reviewer, verify, rounds, cascades, untimed (minutes as integers). It refuses with exit 1 while any task in `kf tasks` lacks a `complete` line, and with exit 1 naming the file when the file's header differs from the current one (no row rewritten). `kf loop-stats --all [--json]` prints the rows, the median of each column, the median minutes per task of controller, test-writer, developer, code-reviewer, verify and waits, and a `largest:` line naming the bucket with the biggest median minutes per task; with no history file it exits 1 `no loop measured yet`.
- Priority: must
- Notes: The history is per machine, beside the `.works/` it measures (already gitignored by `kf init`). Seat buckets overlap in time, so they are compared in minutes per task, not as shares of wall-clock.
### FR-016
- Requirement: When all tasks are complete, the controller runs `kf loop-stats <f> --record` and `kf loop-stats --all`, and its final message prints the item's report and the `largest:` line beside "Rulings I made".
- Priority: must
- Notes: The loop reports where time went; it does not change its own rules from the numbers.

### FR-017
- Requirement: Travel's `measure` takes the implementation phase's `work` and `review` minutes from `kf loop-stats <f> --json` (seat minutes, verify excluded; code-reviewer minutes) when the item's ledger has timestamped seat lines, and from seat notifications otherwise; testing and review phases keep the notification source. `estimation.md` states which source each row used.
- Priority: should
- Notes: Travel's learned factor (median of work ÷ estmin) gets measured, not reconstructed, inputs; verify is excluded because travel's work counts seats only today.
## Non-Functional Requirements
- Every concurrent path is safe by construction, not by luck: one developer per worktree, disjoint Files, committed-only verify, commit lists — never "usually fine".
- No change to exit-code meanings of `kf verify` or `review-package`; the range modes stay backward compatible.
- The ledger remains the resume truth; conversation memory is not relied on for in-flight state.
- Seat isolation unchanged: the controller never fills a review seat; writers still own their files.
- `kf loop-stats` never drops a line silently: unparsed and untimed lines are counted and shown.

## Main Use Cases
- UC-001 Pipeline two neighbouring tasks in one worktree
- UC-002 Run the test-writers of same-wave tasks with disjoint Files at the same time
- UC-003 Verify a task by its commit list in a clean checkout
- UC-004 Cascade re-review after a fix of an earlier task
- UC-005 Resume a loop with two tasks in flight
- UC-006 Measure a loop and record it
- UC-007 Read the history across loops

## Constraints
- One item worktree for the seats; `kf verify`'s detached worktree is temporary and read-only.
- `kf verify` and `review-package` are shared with the review stage; the range modes they expose today keep working.
- Travel reads `loop/progress.md` by counting `fix round` lines and reading `TASK-NNN:` lines; its parsing must not break.
- Apart from the suite itself, a `--commits` verify adds no more than the worktree checkout and link (~1 s).

## Assumptions
- Plans continue to carry Files allowlists and dependencies; a task with no Files overlaps every other.
- The runtime runs subagents in the background, so the controller can work while a seat runs (true for Claude Code's Agent tool).
- Timestamps come from the controller's clock at the moment it writes the line; a seat's interval is therefore controller-observed, which is what wall-clock is made of.
- The gain is estimated, not measured: ~23–40% on the ~88 min baseline depending on how much controller work overlaps. FR-012/FR-015 exist to replace the estimate.

## Acceptance Criteria
- [ ] On verify exit 2, every in-flight seat reports and is ledgered before `kf stage <f> planning`. (FR-009)
- [ ] `kf verify f --task TASK-002 --commits <sha-of-TASK-002>` exits 0 when TASK-001's later commit touches a file outside TASK-002's Files, and exits 2 when one of the listed commits does. (FR-001)
- [ ] `--commits` with `--base`, an empty list, a merge commit, an out-of-order list, a non-ancestor each exit 3 naming the cause. (FR-001)
- [ ] With an uncommitted failing test in the item worktree, `kf verify --commits <green sha>` exits 0 and `kf verify --base <parent>` exits 1; no `kf-verify-` worktree remains after any exit. (FR-013)
- [ ] `review-package --commits a,b out.diff` writes both commits' hunks and none from a commit between them; range mode output is unchanged. (FR-002)
- [ ] `kf tasks f --json` lists `overlaps` with the entry pair; `src/**/*.ts` vs `src/x` overlap. (FR-006)
- [ ] In a scenario run, no two developer intervals overlap, no seat of a third task starts while the head is incomplete, a fix round due during another developer shows `fix queued`, and test-writer and code-reviewer intervals overlap developer intervals. (FR-003, FR-004)
- [ ] A fix commit of TASK-001 after `TASK-002: developer dispatched` produces `TASK-002: cascade re-review owed — after <sha7> of TASK-001`, answered by a `cascade=` re-review, and `TASK-002: complete` comes after `TASK-001: complete` and the answer. (FR-005)
- [ ] A developer with a stray staged path reports `BLOCKED` naming it. (FR-007)
- [ ] `TASK-002: brief written` falls inside TASK-001's developer interval; `verify started` and `code-reviewer dispatched` precede `verify done`. (FR-008, FR-009)
- [ ] Every ledger line after the header ends with ` @ <ISO>`; seat lines match the FR-014 grammar; `grep -c "fix round"` equals the number of fix rounds. (FR-010, FR-014)
- [ ] A fresh session resumes only the head and next task, each at its first unmet step in FR-011's order; no task reaches completion without `developer done`, a passing (or fully routed) latest verify and a clean review. (FR-011)
- [ ] When H's verify fails on X's tests that X's earlier verify passed, the failure stays with H; when X's earlier verify had not passed them, it goes to X with a `Ruling:`, and H completes only after X's next verify passes. (FR-005, FR-009)
- [ ] A task whose open findings are all parked at the five-round cap completes. (FR-005)
- [ ] `kf loop-stats` on a fixture ledger prints the FR-012 figures equal to hand-computed values (complete and mid-loop), pairs a resumed seat's `done` with the re-dispatch, lists the orphan and unparsed lines by number, and counts untimed lines. (FR-012)
- [ ] `kf loop-stats f --record` twice leaves one row for `f`; an incomplete loop or a foreign header exits 1; `kf loop-stats --all` prints column medians, per-task bucket minutes and a `largest:` line; no history → exit 1. (FR-015)
- [ ] The loop's final message contains the item report and the `largest:` line. (FR-016)
- [ ] Travel's `measure` for an item with a timestamped ledger uses `kf loop-stats` seat minutes, and estimation.md says so. (FR-017)
- [ ] Every surface under Affected surfaces names `--commits` where it names `kf verify --base` or `review-package BASE HEAD`, and the CLI reference documents `kf loop-stats` and `overlaps`.

## Edge Cases
- A commit listed in `--commits` is unreachable from the item worktree's HEAD, or is a merge commit → exit 3; merges are not task commits.
- The test-writer of N+1 needs an interface N has not committed yet → it reports `NEEDS_CONTEXT`; the controller waits for N's commit and re-dispatches; no guessing.
- Same-wave tasks share a test helper outside both Files → not disjoint → sequential.
- `kf verify` exit 2 on task N while reviewer N is running → the task stops for the plan change; the reviewer's result is stored, not discarded.
- A seat crashes without a `done` line → resume re-dispatches it; `kf loop-stats` lists the orphan `dispatched` and excludes it.
- `kf verify`'s detached worktree cannot be created → exit 3 `kf verify could not run: …`, nothing ran, nothing left behind.
- A ledger written before this feature (no timestamps) → `kf loop-stats` exits 1 and says the ledger is untimed.
- A loop resumed in another session or timezone → timestamps carry their offset; intervals are computed in UTC.
- A plan where every task shares one Files entry → every pair overlaps; the loop degrades to today's order and the ledger says so per pair.

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`, `vitest.config.ts`); scratch-repo integration tests for `kf verify`, `review-package`, `kf loop-stats`; skill prose checked by surface tests (`src/tests/harness-agents-surface.test.ts` pattern); scenario runs on scratch items at testing
- Coverage Target: 80%

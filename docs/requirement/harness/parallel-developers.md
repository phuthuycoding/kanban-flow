---
feature: parallel-developers
context: harness
created: 20261101_2042
kind: feature
status: archived
---
# Spec Requirement

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

> **Partly superseded by `kf-next`:** the scheduling rules this doc puts in the `kf:implement` skill text (dispatch order, the live developer cap, contention, resume, fix-round and cascade routing) are now computed by `kf next` and ledger lines are written through `kf record`; the skill no longer states them. The behaviour itself still holds. Kept for history.

## Feature
parallel-developers

## Objective
Run several developers at the same time inside a work item's single worktree whenever their tasks are ready and their Files are disjoint, so the in-session loop stops queueing developers behind one another and the main agent keeps more seats busy.

The main session must also keep itself busy. Whenever it has a turn, it dispatches every ready seat and moves slow commands to the background, so ready work never waits on the controller.

## Problem Statement
After loop-throughput (#114, PR #117) the loop allows one developer seat per worktree, with a 2-task window: the head task plus the next. Its own measurement on itself was 29.2 min of `waits` in a 58 min wall (before the review repair) and `largest: developer`. On average only about 1.7 seats were in flight.

The user's rule is one worktree for every role of a feature, never one worktree per developer. So the developers have to share that worktree.

Two blockers were probed on 2026-11-01:
1. `src/tests/setup/build.ts` runs `execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"])`. A type error in any file under `src/`, for example another developer's half-done edit, makes it throw, and every vitest run in the worktree exits 1 before a single test runs. `tsc` still emits JS, because `noEmitOnError` is not set; only the throw blocks.
2. The developer brief checks `git diff --cached --name-only` against its Files. With a shared index, another developer's staged paths show up there and trigger a false BLOCKED. Two commits started at the same moment collide on `.git/index.lock`: one fails with "Unable to create … index.lock: File exists".

Already sound (probed and read):
- `git commit -m <msg> -- <paths>` commits only the named paths and leaves other staged entries in the index.
- `kf verify --task … --commits` accepts interleaved commit lists: it checks history order, not adjacency (src/workflow/verify.ts:149).
- `review-package --commits` packages each commit against its parent.

## Scope
### In Scope
- The vitest build setup continues on tsc exit 2 (type errors, output emitted) and fails on any other non-zero exit.
- A path-limited, lock-safe commit rule for the developer.
- The kanban-implement dispatch rule for up to N concurrent developers per worktree, with ready tasks and disjoint Files.
- The generalised cascade and completion order.
- Resume with several developers in flight.
- Ledger and `kf loop-stats` support for overlapping developer intervals: a peak figure.
- Docs.

### Out of Scope
- Dynamic file leases with a TTL (CodeFleet-style). The plan's static Files allowlist already acts as the lock set, needs no daemon and is checked by `kf verify`.
- A worktree per developer. The user rule is one worktree per feature for all roles.
- Developers on tasks whose Files overlap. They still wait.
- Changes to `kf verify` or `review-package` exit codes or semantics.
- Parallelism across items (travel's slots).
- Automatic recovery from a stale `index.lock`. Deleting a lock another process may hold is unsafe, so it is reported, not removed.
- A live controller harness binary. The loop stays skill prose.

## Affected surfaces
- skills/kanban-implement/SKILL.md
- skills/kanban-implement/references/task-loop.md
- skills/kanban-implement/references/developer-brief.md
- skills/kanban-implement/references/test-writer-brief.md
- skills/kanban-flow/agents/developer.md
- README.md
- docs/workflow/harness.md
- docs/workflow/lifecycle.md
- docs/workflow/cli-reference.md
- skills/kanban-plan/SKILL.md
- CHANGELOG.md
- .github/pages/index.html

## Affected surfaces notes
The skill files and the agent body are installed to users by `kf install`. README covers the task-loop bullet; harness.md the pipelined loop section (N developers, the build setup's exit-2 rule); lifecycle.md the implementation stage; cli-reference.md the new `kf loop-stats` figures and `kf tasks --graph`; kanban-plan the parallelism block in the approval summary; the Pages site the task-loop copy.

## Actors
- The controller: the main agent running kanban-implement.
- Developer seats (several at once).
- The test-writer and code-reviewer seats.
- The human, who reads the ledger and `kf loop-stats`.

## Functional Requirements
### FR-001
- Requirement: `src/tests/setup/build.ts` still runs `tsc -p tsconfig.build.json` and acts on its exit code:
  - exit 0: unchanged.
  - exit 2 (type errors, JavaScript still emitted): the setup passes `tsc`'s diagnostics through unchanged, writes `build setup: tsc exited 2 — type errors, dist emitted, continuing` to stderr, and does not throw. The suite runs.
  - any other non-zero exit (1, 3, 4, or tsc not runnable): it throws as today, and the run fails before any test runs.

  No environment variable controls this.
- Priority: must
- Notes: tsc exit 2 is `DiagnosticsPresent_OutputsGenerated`. A probe of 2026-11-01 got exit 2 on a type error and found the `.js` emitted, because `noEmitOnError` is unset. Type errors are still caught, not swallowed: `npm run typecheck` runs in `harness.verify.task` after each task commit and in the required CI `lint` job, and `harness.verify.stage` runs `npm run build`, which is strict. The other exits mean `dist/` is missing or stale, so continuing would test old code. That is why they still throw. Chosen over an opt-in env var (no brief has to remember to set it, and there is one code path) and over dropping the throw entirely (that would hide a stale `dist/`). Cost: a plain local `npm test` going green no longer implies a clean typecheck. The stderr warning and the gates above cover this.

### FR-002
- Requirement: The developer commits a task with `git commit -m <message> -- <paths>`, naming exactly the paths it changed or was handed. Before committing, every named path must be inside [FILES] plus [TEST_FILES] (plus [SPEC_FILES] for the spec commit); otherwise it reports `BLOCKED` naming the path and makes no commit. A path that is `.` or an existing directory, or a run from a subdirectory instead of the repository root, is refused the same way (amended at review 64dc74be FINDING-002 and 33aa4464 FINDING-001). The commit's sha is the latest commit on the named paths; when it cannot be read after a successful commit, the report is `BLOCKED: commit made …`, the commit exists, and it is never made again (amended at review 64dc74be FINDING-001 and 80ba98b3 FINDING-002). The developer runs the script at the absolute path the controller fills into `[COMMIT_SCRIPT]` (amended at review 80ba98b3 FINDING-001). Other developers' staged or unstaged paths are not its concern and never cause a BLOCKED.
- Priority: must
- Notes: This replaces the `git diff --cached --name-only` check of loop-throughput FR-007, which misfires with a shared index (probe 2026-11-01).

### FR-003
- Requirement: Any git command the developer runs that writes the index, `git add` or `git commit`, and fails because `.git/index.lock` exists gets one attempt plus up to 3 retries, 5 s apart. If it still fails, the developer reports `BLOCKED: index.lock held` with git's message, and never deletes the lock.
- Priority: must
- Notes: Two index writes started at the same moment collide on the lock (probe 2026-11-01). New files need `git add` before `git commit -- <paths>`, and that also takes the lock. A lock that stays in place is left to a human.

### FR-004
- Requirement: The controller may have up to 4 developer seats in flight in one worktree. That count includes fix-round developers and developers resumed to commit specs or fixed tests. It dispatches a task's developer only when all of the following hold:
  - every dependency's developer has reported DONE, so its task commit exists;
  - the task's test-writer is done and its test hashes are ledgered;
  - its Files overlap no **open task**, meaning a task with a `test-writer dispatched` or `developer dispatched` line and no `complete` line yet (so a task whose test-writer is in flight counts as open), checked with `kf tasks --json` `overlaps`. A task with unknown Files overlaps everything.

  Tie-break: a task whose tests are written (a `test-writer done` line and no `developer dispatched` line) does not hold back the developer of a task earlier in plan order; the earlier task's developer goes first and the later one waits for its `complete`. A task whose test-writer is still in flight holds back every task that overlaps it.

  > Amended at whole-branch review FINDING-005 (execution 1b3bbd6b) by the user's decision on 2026-11-01: the open-task definition and the tie-break above replace the developer-only definition first approved.

  A task held back only by an overlap is ledgered `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` and waits for `TASK-MMM: complete`. A developer seat held back only by the cap, including a fix round, is ledgered `TASK-NNN: developer waits — 4 developers in flight` and waits for the next `developer done`.
- Priority: must
- Notes: This replaces "one developer seat in flight per worktree" and the 2-task window. Gating on open tasks rather than in-flight developers keeps a later fix round of an overlapping task from editing files another developer is changing. The cap of 4 was confirmed by the user on 2026-11-01, backed by the concurrent-suite probe (Assumptions).

### FR-005
- Requirement: Test-writers may run for the next 4 tasks in plan order that have no `test-writer done` line and are not complete. A test-writer never writes a file inside the Files of an open task (FR-004) other than its own task's. Its runs are advisory while any developer is in flight (the build setup tolerates tsc exit 2, per FR-001).
- Priority: should
- Notes: This keeps tests ready ahead of the developers without letting a test-writer edit a file that a developer, or a later fix round, may change.

### FR-006
- Requirement: While another developer is in flight, a developer runs only its focused tests (the build setup tolerates tsc exit 2, per FR-001) and never the full suite. A failure in a file outside its own Files and test files is reported as `not mine: <file>`. `kf verify --task … --commits <its commits>` stays the task's authoritative check.
- Priority: must
- Notes: The FR-001 exit-2 rule removes the build blocker. It does not help when another developer's half-written file throws at module load, so such failures stay advisory.

### FR-007
- Requirement: A task completes when its own gates have passed: review clean or parked, `verify done exit=0` after its last commit, and every owed cascade answered. Its dependencies must also be complete. There is no plan-order barrier, so independent tasks complete in any order. A fix commit of task H that lands after the developer of a task X was dispatched owes `TASK-X: cascade re-review owed — after <sha7> of TASK-H` only when X depends on H, directly or transitively, per `kf tasks --json` `dependencies`. X does not complete until that re-review is answered. Coupling the plan did not declare is caught by the stage gate's full build and suite (kanban-implement § 4).
- Priority: must
- Notes: This replaces loop-throughput's "the head completes before the next" ordering. Greedy list scheduling with no barrier between dependency layers approaches the critical-path bound (Co-Coder, arXiv 2606.00953). With disjoint Files, verify run per commit list and the stage gate as backstop, a fix in an independent task cannot invalidate another task's reviewed diff.

### FR-008
- Requirement: Resume re-dispatches every seat of any kind that has a `dispatched` line with no `done`: test-writers, code-reviewers, cascade re-reviews and automation-writers, plus developers up to the cap. It also re-runs every `verify started` that has no `verify done`. All of this happens before any new developer is dispatched. The order rules of FR-004 and FR-007 apply, and the ledger stays the only source of in-flight state.
- Priority: must
- Notes: With several tasks in flight, a compaction interrupts more than one of them. The existing resume steps (SKILL.md § Resume) are generalised from H and X to every open task.

### FR-009
- Requirement: `kf loop-stats` reports `developers peak: <n>`, the largest number of overlapping developer intervals, and `developer overlap: <minutes>`, the minutes during which two or more developer intervals overlap. `--json` carries both as `developersPeak` and `developerOverlapMinutes`. The `.works/loop-metrics.md` header is unchanged.
- Priority: should
- Notes: This proves that parallelism actually happened. A history column would change the FR-015 header of loop-throughput, so the figure is kept out of it.

### FR-011
- Requirement: kanban-implement gives the controller one ordered work list, which it runs through every time it gets a turn (a seat reports, a background command exits, or it has just dispatched something):
  1. Dispatch every seat that is ready now: developers per FR-004, test-writers per FR-005, code-reviewers and re-reviews for committed tasks, owed cascades.
  2. Start `kf verify --commits` and build the review package for every newly committed task.
  3. Write the brief of the next task that has none.
  4. Run the scouts a later task needs.
  5. Write the ledger lines and reports that are owed.

  `kf verify`, a full suite and a build run with the runtime's background option, never in the foreground, while any item above still applies. The controller ends its turn only when no item applies and at least one seat or background command is running.
- Priority: must
- Notes: The user asked for this: "em phải tận dụng session… main session nó phải smart tí" (use the session fully; the main session should be smarter). In #114 the controller ran verify and suites in the foreground while ready seats waited. Surface tests pin the prose, and FR-012's dispatch lag makes the effect observable.

### FR-012
- Requirement: `kf loop-stats` reports dispatch lag: how many minutes ready work waited on the controller, measured between ledger lines.
  - **Developer lag:** measured for each first developer dispatch of a task, that is a `TASK-NNN: developer dispatched` line without `round=`. It is the minutes since the latest of these gate lines in the ledger:
    - that task's `test-writer done`;
    - each dependency's last `developer done`;
    - for a task with a `developer waits — Files overlap … (TASK-MMM)` line, the `TASK-MMM: complete` line;
    - for a task with a `developer waits — 4 developers in flight` line, the first `developer done` of any task after that wait line.
  - **Code-reviewer lag:** measured for each code-reviewer dispatch without `round=` or `cascade=`. It is the minutes since the latest `developer done` or `automation-writer done` of that task.
  - **Output:** the report prints `dispatch lag: developer median <m> max <m> (n=<k>), code-reviewer median <m> max <m> (n=<k>)`, and `--json` carries `dispatchLag.developer` and `dispatchLag.codeReviewer`, each `{ median, max, n }`. The `.works/loop-metrics.md` header is unchanged.
- Priority: should
- Notes: Every ledger line is written by the controller, so the lag measures the gap between the controller handling one event and dispatching the next seat. That is the waste FR-011 removes. The time a notification takes to reach the controller is not visible in the ledger. Every gate line used here is an existing ledger shape (task-loop.md § The ledger): `test-writer done`, `developer done`, `developer waits`, `complete`.

### FR-013
- Requirement: While another seat is in flight in the worktree, a developer runs only these index-writing git commands:
  - `git add -- <paths>` for paths inside its allowlist (FR-002);
  - `git commit -m <msg> -- <paths>`.

  It never runs a command that moves HEAD or rewrites the index or working tree as a whole: `checkout`/`switch`, `reset`, `restore --staged` on another seat's paths, `stash`, `rebase`, `merge`, `cherry-pick`, `commit` without a pathspec, `commit -a`, `add -A`/`add .`, `clean`, or `GIT_INDEX_FILE`. Needing one is a `BLOCKED` report naming the command.
- Priority: must
- Notes: The known failures of agents sharing one working tree come from these commands. Claude Code issue #90943 reports a per-session `GIT_INDEX_FILE` silently reverting another session's commit, and "claude code ate my repo" reports a shared-index race plus a commit that recorded missing files as deletions. A probe of 2026-11-01 ran 4 concurrent committers × 15 rounds with path-limited commits and retry in one repo: all 60 commits landed, the final tree held every change, and `git status` and `git fsck` were clean.

### FR-014
- Requirement: `kf tasks <feature> --graph` prints the plan's critical path (the longest dependency chain, as task ids), its length, the maximum number of tasks that could run at once given the dependencies and Files overlaps (`max width`), and each task's earliest start step. The max width is exact for plans of up to 30 tasks; above 30 it is a greedy conflict-free lower bound printed as `max width: ≥N (ids)`, and the graph's JSON carries `maxWidthExact` (`false` for a lower bound). kanban-plan prints this block in the approval summary, so the human sees how parallel the plan is before approving. `kf tasks --json` is unchanged.
- Priority: should
- Notes: Parallel gains are set by the dependency structure, not by the number of agents. A plan with a long chain or overlapping Files gains nothing from 4 developer seats, and the planner can only fix that before approval. The 30-task bound was amended at review FINDING-003 (an exact search took over 60 s at 60 tasks).

### FR-010
- Requirement: The docs listed under Affected surfaces describe:
  - concurrent developers in one worktree;
  - the cap of 4;
  - both wait lines;
  - the build setup's exit-2 rule;
  - the controller's work list;
  - the new `kf loop-stats` figures.

  No doc or skill file still states "one developer seat in flight per worktree" or "at most two tasks in flight" as the rule. The surface tests that pin those phrases today (src/tests/loop-parallel-surface.test.ts) are updated to pin the new rule.
- Priority: must
- Notes: An absence test is only meaningful against the phrase that actually exists, so it is spelled exactly as it is today.

## Non-Functional Requirements
- Every concurrent path must be safe by construction: disjoint Files, path-limited commits, verify that checks committed work only, and commit lists.
- Errors are never swallowed. The build setup prints tsc's diagnostics on exit 2; a held lock is reported; a cascade is ledgered.
- When no two ready tasks are disjoint, at most one developer is in flight, so a plan of chained tasks runs one developer at a time.

## Main Use Cases
- UC-001 Dispatch concurrent developers on ready, disjoint tasks
- UC-002 Wait on an overlap or the cap
- UC-003 Commit a task with a shared index
- UC-004 Run focused tests while other developers edit
- UC-005 Cascade a late fix to the fixed task's dependents
- UC-006 Resume with several developers in flight
- UC-007 Measure the parallelism
- UC-008 Keep the controller working while seats run
- UC-009 Show the plan's parallelism before approval

## Constraints
- Builds on main after PR #117 (loop-throughput) merges: `kf verify --commits`, `overlaps`, `kf loop-stats` and the ledger grammar.
- One worktree per item for every role (user rule, 2026-11-01).
- The `kf verify` and `review-package` exit codes are unchanged.
- Travel's parsing of `loop/progress.md` (`fix round` lines, `TASK-NNN:` lines) must not break.

## Assumptions
- The cap is 4 (user-confirmed). Changing it is one number in the skill prose, plus a test. Probe of 2026-11-01: 4 full suites ran at once in one detached worktree, each running its own `tsc` into the shared `dist/`. All 4 exited 0 with 1266/1266, at 114–116 s each against 51 s solo. Shared `dist/` is not a collision at 4, and aggregate throughput is about 1.8× a single run. Developers run focused tests while others are in flight (FR-006), which costs far less than a full suite.
- `tsc` keeps emitting when it reports errors, which is the default with `noEmitOnError` unset.
- Developers edit files with tools whose writes are whole-file and atomic. Syntax-broken windows are therefore short, and FR-006 covers them as advisory.

## Acceptance Criteria
- [ ] With a type error planted in one `src/` file, `npx vitest run <an unrelated test file>` runs that file's tests and prints the warning plus the diagnostics. With `tsc` made to exit with another non-zero code (for example a broken `tsconfig.build.json`), the run fails before any test runs. (FR-001)
- [ ] With another path staged in the index, a developer's commit contains only its named paths, and the other path stays staged. (FR-002)
- [ ] A named path outside the allowlist, or an absolute, `..`, `:`-prefixed or backslash path, gives BLOCKED and no commit (bad paths amended at review FINDING-002). (FR-002)
- [ ] A held `index.lock` gives 4 attempts (1 + 3 retries) and then `BLOCKED: index.lock held`, and the lock file still exists afterwards. (FR-003)
- [ ] The kanban-implement prose states the cap of 4, the three dispatch conditions and both wait lines, and the open-task overlap rule with its tie-break (amended at review FINDING-005), and no longer states "one developer seat in flight per worktree" or "at most two tasks in flight". Surface tests pin each. (FR-004, FR-010)
- [ ] A scratch scenario run with 3 ready disjoint tasks and 1 overlapping task produces overlapping developer intervals for the 3 and a `developer waits — Files overlap` line for the 4th. (FR-004)
- [ ] The test-writer and developer brief prose state the focused-test and advisory rules. (FR-005, FR-006)
- [ ] The completion rule allows out-of-order completion of independent tasks. A cascade is owed only to dependents of the fixed task, and surface tests pin both. (FR-007)
- [ ] The developer agent and brief list the allowed and forbidden git commands, and surface tests pin each forbidden one. (FR-013)
- [ ] On a fixture plan with a 3-task chain and 3 independent disjoint tasks, `kf tasks --graph` prints the critical path, its length and the correct max width. A plan with unknown Files counts those tasks as overlapping everything. A plan of more than 30 tasks prints `max width: ≥N` with `maxWidthExact: false` (amended at review FINDING-003). (FR-014)
- [ ] The resume rule re-dispatches every open developer seat before any new one. (FR-008)
- [ ] The kanban-implement prose carries the ordered controller work list, the background rule for verify/suite/build, and the "end the turn only when nothing applies" rule. Surface tests pin each. (FR-011)
- [ ] On a fixture ledger, `kf loop-stats` prints `dispatch lag:` with the hand-computed developer and code-reviewer median and max values, `--json` carries `dispatchLag`, and the history header is byte-identical. (FR-012)
- [ ] In the scratch scenario run, no ready developer waits more than 1 min for its dispatch (the developer `max` of `dispatch lag` is ≤ 1.0). (FR-011, FR-012)
- [ ] `kf loop-stats` on a fixture ledger with 3 overlapping developer intervals prints `developers peak: 3` and the hand-computed overlap minutes; `--json` carries both fields; the history header is byte-identical. (FR-009)

## Edge Cases
- Four vitest runs at once each run `tsc` into the one shared `dist/` that the spawned-CLI tests execute from. This is probed at brainstorm with 4 concurrent full suites in one worktree; the result is recorded under Assumptions.
- Two tasks both touch an undeclared shared file, such as `package-lock.json` or `src/cli/args.ts`. The overlap check cannot see it, and `kf verify --commits` exits 2 for the task whose Files lack it: a plan change, as today.
- Developer A's file is syntactically broken while developer B's spawned-CLI tests run. The exit-2 rule cannot help with a syntax error that throws at module load, so B reports `not mine:` and verify decides.
- A fix round of task H starts while 4 developers are in flight. It takes a developer slot, so it waits with `developer waits — 4 developers in flight`. A fix round never conflicts on Files, because H is itself an open task, so no overlapping developer or test-writer is dispatched while H is open (FR-004).
- A cascade fans out to 3 dependent tasks from one fix commit: three owed lines, three re-reviews. An independent task in flight owes none.
- A task with unknown Files (null) overlaps everything, so it runs alone.
- All tasks are chained (each depends on the previous one). No concurrency is possible, and the loop behaves as today.
- After a crash the `index.lock` is stale. The developer reports BLOCKED and the human removes it.
- A resume finds 4 open developer seats plus a queued fix. It re-dispatches the 4 first, and the fix waits for a slot.

## Open Questions
- None. The user settled both on 2026-11-01: the cap is 4, and the build setup tolerates tsc exit 2 only (FR-001), with no env var.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`, `vitest.config.ts`); a scratch-repo integration test for path-limited commits and the held lock; a subprocess test of `src/tests/setup/build.ts` with a planted type error; surface tests for the skill prose; `kf loop-stats` fixtures; one scratch scenario run at testing with real developer seats
- Coverage Target: 80%

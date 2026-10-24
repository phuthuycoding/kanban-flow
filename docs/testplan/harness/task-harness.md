---
feature: task-harness
context: harness
created: 20261024_1105
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

**Drive fixture** (used by every Integration case unless the case says otherwise): a git-backed temp project (`git init` with user name/email, `.works/` ignored, initial commit), `worktree.enabled: true` with `baseDir` and `routesFile` inside the temp dir, `harness.verify.stage: [["true"]]`, no `verify.task`, fake runners on `PATH`, and an approved item `demo` in `implementation` with the task table named in the case.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | task-harness |
| Context | harness |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`npm test`); fake runner CLIs (`src/tests/helpers/fake-cli.ts`); git-backed fixture (`src/tests/helpers/git-fixture.ts`); built CLI for detached runs |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 10 | 10 | TC-001, TC-002, TC-003, TC-005, TC-007, TC-011, TC-026, TC-028, TC-035, TC-036 |
| Integration | 26 | 26 | TC-004, TC-006, TC-008, TC-009, TC-010, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024, TC-025, TC-027, TC-029, TC-030, TC-031, TC-032, TC-033, TC-034 |
| UI / E2E | 0 | 0 | CLI only — no UI; detached integration tests exercise the built CLI |
| **Total** | **36** | **36** | **All must pass** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-004, FR-019 | TC-001, TC-002, TC-003, TC-004, TC-005 | 5 | Graph errors separate; old plans valid; roles deterministic; template and skills carry the standard |
| UC-002 | FR-002 | TC-006, TC-007 | 2 | JSON and tasks.md agree; Baseline kept; invalid graph exits 1 |
| UC-003 | FR-003, FR-004, FR-005, FR-006, FR-017 | TC-008, TC-009, TC-010, TC-033 | 4 | Refusals exact; task run recorded and merged; concurrency rules |
| UC-004 | FR-005, FR-006, FR-008, FR-011, FR-013, FR-017, FR-019 | TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-032, TC-036 | 8 | Parallel bound and overlap; refusals; ends ready without shipping; bug path; list/archive/cancel aware; typed transitions |
| UC-005 | FR-007, FR-010 | TC-017, TC-018 | 2 | Allowlist and verify failures; reset; retry then blocked |
| UC-006 | FR-008 | TC-019, TC-020 | 2 | Conflict blocks one task; dirty item worktree refused |
| UC-007 | FR-012, FR-015 | TC-021, TC-022, TC-023, TC-034 | 4 | Loops bounded; every stop code; budget |
| UC-008 | FR-013, FR-014 | TC-024, TC-025, TC-026, TC-027, TC-035 | 5 | Resume and crash; racing drives; lock; no lost or regressed records |
| UC-009 | FR-006, FR-009, FR-011, FR-015, FR-016, FR-018 | TC-028, TC-029, TC-030, TC-031 | 4 | Config validation; preconditions and warning; hook env; doctor findings |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002, TC-004 | Yes | |
| FR-002 | UC-002 | TC-006, TC-007 | Yes | |
| FR-003 | UC-003 | TC-008, TC-009 | Yes | |
| FR-004 | UC-001 | TC-003 | Yes | |
| FR-005 | UC-003, UC-004 | TC-011, TC-012, TC-033 | Yes | |
| FR-006 | UC-003, UC-004, UC-009 | TC-010, TC-012, TC-029 | Yes | |
| FR-007 | UC-005 | TC-017, TC-018 | Yes | |
| FR-008 | UC-004, UC-006 | TC-016, TC-019, TC-020, TC-032 | Yes | |
| FR-009 | UC-009 | TC-028 | Yes | |
| FR-010 | UC-005 | TC-018 | Yes | |
| FR-011 | UC-004, UC-009 | TC-013, TC-014, TC-015, TC-029, TC-036 | Yes | |
| FR-012 | UC-007 | TC-021, TC-023, TC-034 | Yes | |
| FR-013 | UC-008 | TC-024, TC-025 | Yes | |
| FR-014 | UC-008 | TC-026, TC-027, TC-035 | Yes | |
| FR-015 | UC-007 | TC-022 | Yes | |
| FR-016 | UC-009 | TC-030 | Yes | |
| FR-017 | UC-003, UC-004 | TC-009, TC-014 | Yes | |
| FR-018 | UC-009 | TC-031 | Yes | |
| FR-019 | UC-001 | TC-005 | Yes | |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Harness with roles `coder`, `tester` |
| Input | Task Breakdown with a duplicate id, a dependency on `TASK-099`, a cycle `TASK-002 → TASK-003 → TASK-002`, a self-dependency on `TASK-004`, and role `designer` |
| Steps | See steps table below |
| Expected outcome | ERRORs: one `task_duplicate`, one `task_dep_missing`, two `task_dep_cycle` (`TASK-002 → TASK-003 → TASK-002` and `TASK-004 → TASK-004`), one `task_role_unknown` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the task-graph validator | Exactly those findings |
| 2 | Fix all and re-run | No task findings |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Plans written before this feature |
| Input | (a) table without Role/Files; (b) Task Breakdown as bullets, no table; (c) dependency `task-001`; (d) Dependencies cells `-`, `—`, `None`, `n/a`, empty, `TASK-001 (schema)` |
| Steps | See steps table below |
| Expected outcome | (a) valid, every role `-`, files unknown; (b) zero tasks, no ERROR; (c) resolves to `TASK-001`; (d) the first five mean no dependency, the last means `TASK-001`; existing status and affected-surfaces fixtures stay green |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse and validate each plan | Outcomes as listed |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Harness configs (a) `stages.implementation: ["coder"]`; (b) empty stages, `main: architect` |
| Input | Tasks with role `tester` and `-`; stage `testing` with and without an assigned role |
| Steps | See steps table below |
| Expected outcome | `tester` → tester; `-` → coder under (a), architect under (b); stage roles fall back the same way; repeated calls give the same result |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Resolve under (a) and (b) | As expected |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; item approved |
| Input | Edit one task's Role cell after `kf approve` |
| Steps | See steps table below |
| Expected outcome | `kf validate` reports `approval_changed`; `kf drive` exits 1 naming re-approval |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Approve, edit the Role cell | Drift detected |
| 2 | Run `kf drive` | Refused |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-019 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Package template and skills |
| Input | `kanban-flow/templates/phase-2-implementation-plan.md`; `skills/kanban-plan`, `kanban-implement`, `kanban-flow` SKILL.md |
| Steps | See steps table below |
| Expected outcome | Template header has `Role` and `Files` and its sample row parses; kanban-plan tells the planner to fill Role and Files; kanban-implement has a task-worker section naming a single `TASK-###` and no longer contains "Pick the agent that fits"; kanban-flow checks `worktree.enabled` at the start decision and hands off to `kf drive`; open-source-surface test green |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse the template | Columns found |
| 2 | Assert the skill markers | All present / absent as listed |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; tasks 001 (no deps), 002 (dep 001), 003 (deps 001, 002); 001 done |
| Input | `kf tasks demo --json`; then a plan edited to contain a cycle |
| Steps | See steps table below |
| Expected outcome | Valid plan: 001 done wave 1, 002 ready wave 2, 003 pending wave 3, each with resolved role and files, exit 0; text mode shows the same; cycle: exit 1 printing `task_dep_cycle` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run with --json and without | Same data |
| 2 | Run on the cyclic plan | Exit 1 with the ERROR |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Task state with one done and one blocked; a `tasks.md` whose `## Baseline` holds a sha and porcelain lines |
| Input | Render `tasks.md` twice |
| Steps | See steps table below |
| Expected outcome | One checkbox per task, only done ticked; Baseline byte-identical after both renders; `countTasks` reports 1/2 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Render twice and count | As expected |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; TASK-002 depends on TASK-001; second item in testing |
| Input | `kf run demo --task TASK-002`; `--task TASK-404`; `--task TASK-001 --role coder`; `kf run other --task TASK-001` |
| Steps | See steps table below |
| Expected outcome | All exit 1 with nothing created: unfinished TASK-001 named; unknown id; `--task` cannot combine with `--role`; item not in implementation |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | Refusals as listed; no run record, no worktree |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-003, FR-017 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; TASK-001 role `tester` mapped to runner `fakeb`; fake runner writes an allowed file; variant prints `STATUS: DONE_WITH_CONCERNS` |
| Input | `kf run demo --task TASK-001`; `kf runs demo` |
| Steps | See steps table below |
| Expected outcome | Runner `fakeb` ran with cwd = the task worktree; prompt names TASK-001, its FR/UC refs, expected output, allowlist, absolute item folder path and the STATUS contract; record has `task: TASK-001`; `kf runs` shows the task column; task `done` with a `task(TASK-001): …` commit (message ≤ 72 chars) merged into the item branch; DONE_WITH_CONCERNS is treated like DONE |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the task | Exit 0 |
| 2 | Inspect captured argv/prompt/cwd, record, git log | As expected |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture with `worktree.enabled: false`; item in implementation |
| Input | `kf run demo --task TASK-001`; `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | Both exit 1 naming `worktree.enabled` in `.kf/config.json`; `git worktree list` and `.kfw.json` unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run both | Refusals as expected |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | Scheduler, `parallel: 3` |
| Input | Tasks A, B, C, F independent with disjoint files; D sharing a directory prefix with A; E files unknown; G with `**`; H depending on a blocked task |
| Steps | See steps table below |
| Expected outcome | First pick has exactly three of {A, B, C, F}; D never runs alongside A; E and G run only alone; H never becomes ready and is reported blocked by its dependency; pattern-overlap rule: `src/a.ts` vs `src/` overlap, `src/a/*.ts` vs `src/b/*.ts` do not, `*` overlaps everything |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Step the scheduler through completions | Ready sets as listed at each step |
| 2 | Check overlap pairs | As listed |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-005, FR-006 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; four independent tasks with disjoint files plus a fifth sharing a file with the first; fake runner records start/end timestamps and sleeps 1s |
| Input | `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | Max concurrent workers is exactly 3; the overlapping pair never overlaps in time; while running, task worktrees sit at `<baseDir>/demo.tasks/task-00n` on branches `<item-branch>--task-00n`; no task route or port is written |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the drive and read timestamps | Concurrency as expected |
| 2 | Sample `git worktree list` and the routes file | As expected |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-011 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; items: approved in planning, in backlog, and in planning with pending approval |
| Input | `kf drive` on each |
| Steps | See steps table below |
| Expected outcome | Exit 1, nothing written; planning/backlog name `kf stage <f> implementation`; pending names `kf approve <f>` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run on each | Refusals as listed |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-011, FR-017 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; fake coder/tester/reviewer write PASS reports with the current execution id |
| Input | `kf drive demo`, poll `kf drive demo --status` |
| Steps | See steps table below |
| Expected outcome | Item ends in review with a PASS review; status result `ready` and "ready for ship decision"; no shipping/dones move, no `meta.ship`; `runs/drive-<id>.jsonl` has task, verify, merge, stage and stop events |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run and wait | Stage review, PASS |
| 2 | Inspect metadata and log | As expected |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-011 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Drive fixture; approved `kind: bug` item in implementation |
| Input | `kf drive demo-bug` |
| Steps | See steps table below |
| Expected outcome | One implementation-role run in the item worktree, no task records, verify.stage, testing, review; ends `ready` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Drive the bug | As expected |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-008 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Drive fixture; a drive with one task running |
| Input | `kf worktree list` mid-drive |
| Steps | See steps table below |
| Expected outcome | The running task's worktree is not reported as an orphan; the item worktree still listed normally |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | List | No `unmanaged-worktree` for task worktrees |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-007 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; TASK-001 allowlist `src/a.ts`; variants: fake runner (1) writes `src/a.ts` and `src/b.ts`, (2) renames `src/c.ts` to `src/a2.ts`, (3) deletes `src/c.ts`; each prints `STATUS: DONE` |
| Input | `kf run demo --task TASK-001` per variant; variant (1) also under `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | Task `blocked` (no retry) naming `src/b.ts` / `src/c.ts` and `src/a2.ts` / `src/c.ts`; nothing committed or merged; item branch HEAD unchanged; drive variant (`retries: 1`, a second independent task running): exactly one run for TASK-001, the running task finishes and merges, no new run starts, drive stops `plan_change_needed` naming TASK-001, the paths and the next step |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each variant | Reasons as listed; HEAD unchanged |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-007, FR-010 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; `verify.task: [["./fail.sh"]]` where fail.sh exits 1; `retries: 1`; TASK-002 depends on TASK-001; variant with `verify.task: [["no-such-cmd"]]` |
| Input | `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | TASK-001 merged, verify fails, item branch reset to the pre-merge sha; one retry resumes the same task session with the output tail in the prompt; still failing → `blocked`; TASK-002 reported blocked by TASK-001; drive stops `tasks_blocked`; the missing-command variant fails the task with "not found" instead of crashing |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the drive | Two runs for TASK-001, same session |
| 2 | Inspect branch, states, status | As expected |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-008 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; TASK-001 edits line 1 of `shared.txt`; TASK-003 independent; the fake runner for TASK-001 commits a different line 1 of `shared.txt` to the item branch from the item worktree before printing DONE (simulating a human commit during the drive) |
| Input | `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | TASK-001 merge conflicts: merge aborted, task `blocked` naming `shared.txt`, its branch kept; TASK-003 done; no MERGE_HEAD in the item worktree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the drive | One blocked task with the conflicting path |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-008 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Drive fixture; variant (a) a modified tracked file in the item worktree; variant (b) only an untracked file `notes.tmp` not touched by the task; variant (c) an untracked `src/new.ts` in the item worktree while the task adds a tracked `src/new.ts` |
| Input | `kf run demo --task TASK-001` |
| Steps | See steps table below |
| Expected outcome | (a) worker runs; merge refused; task `blocked` with "item worktree has uncommitted changes"; the file untouched. (b) merge proceeds, task `done`, `notes.tmp` untouched. (c) git refuses the merge, task `blocked` with git's message, the untracked file untouched, no merge in progress |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the task | Blocked, file intact |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-012 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; (1) tester writes FAIL then PASS; (2) tester always FAILs with `maxLoops: 1`; (3) reviewer writes REJECT then PASS |
| Input | `kf drive demo` per variant |
| Steps | See steps table below |
| Expected outcome | (1) one repair loop whose prompt names the FAIL report, then review PASS; (2) stops `loop_limit` after one loop; (3) REJECT loops back through implementation and testing before review PASS |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each variant | Outcomes as listed |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-015 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Drive fixture; `budget.maxRuns: 2`, `parallel: 1`, three independent tasks |
| Input | `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | Stops `budget` naming 2/2 runs after the second run; no third run record |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the drive | Stopped on budget |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-012 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; variants: (1) TASK-001 worker edits `harness.verify` in the main checkout's `.kf/config.json`; (2) TASK-001 worker prints `STATUS: BLOCKED` |
| Input | `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | (1) stops `config_changed` at the next step boundary, no further run starts; (2) TASK-001 `blocked` without retry, drive stops `worker_blocked` with the worker summary |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each variant | Stop codes as listed |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-013 |
| Use case reference | UC-008 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; TASK-001 done, TASK-002 running, TASK-003 blocked from an earlier attempt |
| Input | SIGKILL the supervisor; `kf drive demo --status`; `kf drive demo` |
| Steps | See steps table below |
| Expected outcome | Status reports `crashed` with the next command; re-run does not re-run TASK-001, re-runs TASK-002, resets TASK-003 to pending and runs it; drive completes |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Kill and read status | `crashed` |
| 2 | Resume | Run records as expected |

## TC-025

| Field | Detail |
|---|---|
| Test case ID | TC-025 |
| Requirement reference | FR-013 |
| Use case reference | UC-008 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; separately an item worktree left with MERGE_HEAD by a simulated crash during a merge |
| Input | Two `kf drive demo` started concurrently; `kf drive demo --stop`; resume after the simulated half merge |
| Steps | See steps table below |
| Expected outcome | Exactly one drive starts, the other exits 1 naming it; `--stop` leaves no live supervisor or worker pid and keeps worktrees and branches, status `stopped_by_user`; resume aborts the half merge and retries it once, task done |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Race two drives | One wins |
| 2 | Stop | As expected |
| 3 | Resume after half merge | Merge retried |

## TC-026

| Field | Detail |
|---|---|
| Test case ID | TC-026 |
| Requirement reference | FR-014 |
| Use case reference | UC-008 |
| Test type | Unit |
| Priority | High |
| Preconditions | Lock for item `demo` |
| Input | (a) lock file with a dead pid; (b) lock held by a live pid past the 30s wait (wait shortened in the test) |
| Steps | See steps table below |
| Expected outcome | (a) taken over; (b) fails naming the holder pid |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Acquire under (a) and (b) | As expected |

## TC-027

| Field | Detail |
|---|---|
| Test case ID | TC-027 |
| Requirement reference | FR-014 |
| Use case reference | UC-008 |
| Test type | Integration |
| Priority | High |
| Preconditions | Two processes, 50 run-record upserts each on one item |
| Input | Concurrent writes, including a late pid write after a finishing write |
| Steps | See steps table below |
| Expected outcome | All 100 records present; no finished record back at `running` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run both writers and read `.kfw.json` | As expected |

## TC-028

| Field | Detail |
|---|---|
| Test case ID | TC-028 |
| Requirement reference | FR-009 |
| Use case reference | UC-009 |
| Test type | Unit |
| Priority | High |
| Preconditions | Harness configs |
| Input | `verify.task` as `"npm test"`, `[[]]`, `[[""]]`, `[["-rf"]]`, `[["npm","{x}"]]`, valid `[["npm","test"]]`; `parallel: 0`; `kf init` re-run on a valid config |
| Steps | See steps table below |
| Expected outcome | Each invalid value is an error naming the field; the valid one passes; re-init keeps `verify` and limits; getter defaults 3/1/2/30 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Validate each | As expected |
| 2 | Re-run init and read config | Fields preserved |

## TC-029

| Field | Detail |
|---|---|
| Test case ID | TC-029 |
| Requirement reference | FR-011, FR-006 |
| Use case reference | UC-009 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project A: worktree enabled, no `verify.stage`, item in implementation; project B: `verify.stage` set, `worktree.enabled: false`, item in planning; project C: neither verify nor worktree, item in planning |
| Input | `kf drive demo` in A; `kf validate --change demo` in B and C |
| Steps | See steps table below |
| Expected outcome | A: exit 1 naming `harness.verify.stage`; B: WARNING `task_harness_needs_worktree`; C: no such warning |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | As expected |

## TC-030

| Field | Detail |
|---|---|
| Test case ID | TC-030 |
| Requirement reference | FR-016 |
| Use case reference | UC-009 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Drive fixture; `.kf/hooks/drive-stop.sh` writes its env to a file; variant exits 1 |
| Input | A drive reaching `ready`; a drive stopped by `budget` |
| Steps | See steps table below |
| Expected outcome | Env has `KFW_DRIVE_RESULT=ready` / `stopped` and `KFW_DRIVE_REASON` with the reason; a failing hook adds a warning and the result is unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run both | As expected |

## TC-031

| Field | Detail |
|---|---|
| Test case ID | TC-031 |
| Requirement reference | FR-018 |
| Use case reference | UC-009 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Harness with `stages.implementation` assigned and no `verify`; an open item whose plan uses role `designer`; a task worktree with no live drive; a lock file with a dead pid |
| Input | `kf doctor --json`; the same project with `stages: {}` |
| Steps | See steps table below |
| Expected outcome | Four findings: WARNING missing verify.stage, ERROR missing role naming item and task, WARNING stale task worktree and WARNING dead lock each with a cleanup command; with `stages: {}` no verify WARNING |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run doctor twice | As expected |

## TC-032

| Field | Detail |
|---|---|
| Test case ID | TC-032 |
| Requirement reference | FR-008 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; item at review PASS with one clean task worktree and one kept blocked-task branch; second item in implementation with a dirty task worktree |
| Input | `kf archive demo`; `kf cancel other --reason x` |
| Steps | See steps table below |
| Expected outcome | Archive removes the clean task worktree and reports the kept branch; cancel refuses naming the dirty task worktree and changes nothing |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Archive | As expected |
| 2 | Cancel | Refused |

## TC-033

| Field | Detail |
|---|---|
| Test case ID | TC-033 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; TASK-001 and TASK-002 independent; fake runner sleeps 3s |
| Input | `kf run demo --task TASK-001 &`, then `kf run demo --task TASK-002`, `kf run demo --task TASK-001`, `kf run demo` |
| Steps | See steps table below |
| Expected outcome | TASK-002 accepted while TASK-001 runs; a second TASK-001 run refused naming the live run; stage-level `kf run` refused while a task run is live |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Start TASK-001 then the others | Outcomes as listed |

## TC-034

| Field | Detail |
|---|---|
| Test case ID | TC-034 |
| Requirement reference | FR-012 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture; variants: (1) review report says REQUIREMENT_BUG; (2) `.kf/hooks/testing.sh` exits 1; (3) `harness.roles` edited mid-drive; (4) plan edited mid-drive (approval change); (5) `verify.stage` fails after the DAG |
| Input | `kf drive demo` per variant, with a spy on stage transitions |
| Steps | See steps table below |
| Expected outcome | Stop codes (1) `requirement_bug`, (2) `transition_refused`, (3) `config_changed`, (4) `approval_changed`, (5) `verify_failed`; every stop prints one reason and one next command; no transition call ever carries `--force` or `--skip-hooks` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each variant | Codes as listed; spy shows no bypass flags |

## TC-035

| Field | Detail |
|---|---|
| Test case ID | TC-035 |
| Requirement reference | FR-014 |
| Use case reference | UC-008 |
| Test type | Unit |
| Priority | High |
| Preconditions | Run-record store |
| Input | Upserts in order: running → done → (late) running with pid; and failed → running |
| Steps | See steps table below |
| Expected outcome | Final statuses `done` and `failed`; the pid field from the late write is kept without changing status |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Apply the sequences | As expected |

## TC-036

| Field | Detail |
|---|---|
| Test case ID | TC-036 |
| Requirement reference | FR-011 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `transitionItem` with fixtures for a gate failure, a hook failure, a successful move and a rename error |
| Input | Call the function per fixture; also call `kf stage` CLI on the same fixtures |
| Steps | See steps table below |
| Expected outcome | Typed outcomes `refused`, `hook_failed`, `moved`, `error`; CLI stdout, stderr tag and exit code identical to before the refactor (compared with recorded output) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call per fixture | Outcomes as listed |
| 2 | Compare CLI output | Byte-identical |

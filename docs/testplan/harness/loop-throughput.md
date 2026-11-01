---
feature: loop-throughput
context: harness
created: 20261101_1349
status: archived
---
# Test Plan

> **Partly superseded by `parallel-developers`:** test cases asserting one developer seat per worktree or the head/next two-task window no longer describe the loop. Kept for history.

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`. Skill and doc behaviour is pinned by surface tests (Unit); the loop behaviour is also run for real at testing (TC-021, TC-025, TC-028, TC-029, TC-030, TC-032).

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | loop-throughput |
| Context | harness |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`); scratch-repo integration tests; surface tests; scenario runs at testing |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 20 | 20 | overlap rule, ledger parser and stats, usage text, skill/doc surface |
| Integration | 19 | 19 | scratch repos, CLI runs, scenario runs at testing |
| UI / E2E | 0 | 0 | no UI |
| **Total** | **39** | **39** | |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-003, FR-004, FR-007, FR-008, FR-009 | TC-016, TC-017, TC-018, TC-019, TC-020, TC-025, TC-030, TC-039 | 8 | all listed TCs pass |
| UC-002 | FR-006 | TC-013, TC-014, TC-015, TC-021 | 4 | all listed TCs pass |
| UC-003 | FR-001, FR-002, FR-013 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-032, TC-038 | 14 | all listed TCs pass |
| UC-004 | FR-005 | TC-022, TC-028 | 2 | all listed TCs pass |
| UC-005 | FR-010, FR-011, FR-014 | TC-023, TC-024, TC-029, TC-033 | 4 | all listed TCs pass |
| UC-006 | FR-012, FR-015, FR-016, FR-017 | TC-026, TC-027, TC-031, TC-034, TC-035, TC-036 | 6 | all listed TCs pass |
| UC-007 | FR-015 | TC-037 | 1 | all listed TCs pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-003 | TC-004, TC-005, TC-009, TC-012, TC-038 | yes | |
| FR-002 | UC-003 | TC-001, TC-002, TC-003 | yes | |
| FR-003 | UC-001 | TC-020 | yes | |
| FR-004 | UC-001 | TC-016, TC-025 | yes | |
| FR-005 | UC-004 | TC-022, TC-028 | yes | |
| FR-006 | UC-002 | TC-013, TC-014, TC-015, TC-021 | yes | |
| FR-007 | UC-001 | TC-017, TC-030 | yes | |
| FR-008 | UC-001 | TC-018 | yes | |
| FR-009 | UC-001 | TC-019, TC-039 | yes | |
| FR-010 | UC-005 | TC-023 | yes | |
| FR-011 | UC-005 | TC-029, TC-033 | yes | |
| FR-012 | UC-006 | TC-026, TC-027, TC-034 | yes | |
| FR-013 | UC-003 | TC-006, TC-007, TC-008, TC-010, TC-011, TC-032 | yes | |
| FR-014 | UC-005 | TC-024 | yes | |
| FR-015 | UC-006, UC-007 | TC-031, TC-037 | yes | |
| FR-016 | UC-006 | TC-035 | yes | |
| FR-017 | UC-006 | TC-036 | yes | |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch repo with commits a, m, b (m touches another file) (task TASK-001) |
| Input | `review-package --commits a,b out.diff` |
| Steps | See steps table below |
| Expected outcome | Header names commits a,b; `## Diff` holds a's and b's hunks and none of m's; exit 0 and the `wrote …` line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the script | exit 0 |
| 2 | Search out.diff for m's file | absent |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch repo with a merge commit and an empty commit (task TASK-001) |
| Input | `--commits deadbeef`, `--commits <merge>`, `--commits a,a`, `--commits a --untracked`, `--commits <empty commit>` |
| Steps | See steps table below |
| Expected outcome | Exit 2, 2, 2, 2; exit 3 with `empty commit list diff` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each input | exit codes as listed |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch repo; the pre-change script saved as a fixture (task TASK-001) |
| Input | Range mode `BASE HEAD out.diff --untracked -- src/`; a non-descendant; a bad BASE |
| Steps | See steps table below |
| Expected outcome | Output byte-identical to the pre-change script; exits 3 and 2 unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run old and new on the same repo | identical output and exits |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item: TASK-002 Files `src/b.ts`; commit c2 (src/b.ts) then c1 (src/a.ts, TASK-001) (task TASK-003) |
| Input | `kf verify f --task TASK-002 --commits c2`; then `--commits c2,c1` |
| Steps | See steps table below |
| Expected outcome | Exit 0 (c1 not checked); exit 2 listing `src/a.ts` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run with c2 | exit 0 |
| 2 | Run with c2,c1 | exit 2 |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item worktree with a merge commit and a commit on another branch (task TASK-003) |
| Input | `--commits c --base b`; `--commits ""`; `--commits <merge>`; `--commits <other branch>`; `--commits nope`; `--commits c2,c1` with c1 older |
| Steps | See steps table below |
| Expected outcome | Each exits 3 naming the cause; no verify command runs |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | exit 3, cause named |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | `harness.verify.task` fails when an uncommitted `t.fail` exists in its cwd; `t.fail` uncommitted in the item worktree; commit c green (task TASK-003) |
| Input | `--commits c` and `--base c^` |
| Steps | See steps table below |
| Expected outcome | `--commits` exits 0; `--base` exits 1 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run --commits | exit 0 |
| 2 | Run --base | exit 1 |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Verify command variants: passing, failing, not found (task TASK-003) |
| Input | `--commits c` per variant |
| Steps | See steps table below |
| Expected outcome | Exits 0, 1, 1; after each, `git worktree list` has no `kf-verify-` entry and the temp dir is gone |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | exits as listed |
| 2 | List worktrees | no kf-verify- entry |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Temp dir made unwritable (or `git worktree add` forced to fail) (task TASK-003) |
| Input | `--commits c` |
| Steps | See steps table below |
| Expected outcome | Exit 3 `kf verify could not run: …`; no verify command ran; nothing left behind |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run | exit 3, message |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-003) |
| Input | `kf verify f --task TASK-001` with neither `--base` nor `--commits` |
| Steps | See steps table below |
| Expected outcome | Exit 3 naming both options |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run | exit 3 |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-003) |
| Input | `.kf/config.json` |
| Steps | See steps table below |
| Expected outcome | `harness.verify.task` is `[["npm","run","typecheck"],["npm","test"]]` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the config | value as listed |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item worktree with `node_modules/dep/index.js`; verify command `node -e "require('dep')"` (task TASK-003) |
| Input | `--commits c`; then without `node_modules` |
| Steps | See steps table below |
| Expected outcome | Exit 0 through the link; without `node_modules` no link is made and the command's own result is reported |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run with node_modules | exit 0 |
| 2 | Remove and run | no link; exit 1 |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Built CLI (task TASK-003) |
| Input | `kf verify`; `kf -h` |
| Steps | See steps table below |
| Expected outcome | USAGE in `src/cli/commands/verify.ts` and the args help both contain `--commits <sha>[,<sha>…]`; the `kf -h` verify line still matches `/^\s+verify\s+Usage: kf verify/` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run both | as listed |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-002) |
| Input | `firstOverlap(['src/'],['src/a.ts'])`, `(['src/**/*.ts'],['src/x'])`, `(['src/*.ts'],['docs/**'])`, `(['src/a.ts'],['src/b.ts'])` |
| Steps | See steps table below |
| Expected outcome | `['src/','src/a.ts']`, `['src/**/*.ts','src/x']`, `null`, `null`; `filesOverlap` agrees |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call each | as listed |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Plan: TASK-001 `src/a.ts`, TASK-002 `src/b.ts`, TASK-003 `src/`, TASK-004 no Files (task TASK-002) |
| Input | `kf tasks f --json`; `kf tasks f` |
| Steps | See steps table below |
| Expected outcome | Overlap ids: 001 → [003, 004]; 002 → [003, 004]; 003 → [001, 002, 004]; 004 → all; 001's element for 003 has `entries: ['src/a.ts','src/']`; elements with 004 have `entries: null`; text rows unchanged; task-graph.test.ts green |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run --json | as listed |
| 2 | Run text | unchanged |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-005) |
| Input | `skills/kanban-implement/SKILL.md` |
| Steps | See steps table below |
| Expected outcome | Names `overlaps` from `kf tasks <f> --json` as the gate; contains `wave <w>: parallel test-writers` and `wave <w>: sequential … Files overlap <entry> / <entry>` and `— Files unknown`; developers of the wave follow the one-developer rule |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the skill | phrases present |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-005) |
| Input | `SKILL.md`, `references/task-loop.md` |
| Steps | See steps table below |
| Expected outcome | `never two tasks in flight in the same git history` is gone; test-writer X at developer H's start and developer X at H's last task commit (spec commit included) when `overlaps` is empty; `developer waits — Files overlap`; the "fails for the right reason" judgement from developer X's step-3 run when the test-writer's run was advisory; `task-reviewer-brief.md` and `re-review-brief.md` say only the package is graded and other working-tree files are context; loop calls use `kf verify <f> --task TASK-### --commits` and `review-package --commits` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read both | present / absent as listed |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-007 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-005) |
| Input | `skills/kanban-flow/agents/developer.md` step 7, `references/developer-brief.md` |
| Steps | See steps table below |
| Expected outcome | Stage by path; `git diff --cached --name-only` against Files plus handed tests; `BLOCKED` naming stray paths; same rule for fix rounds |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read both | phrases present |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-008 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-005) |
| Input | `SKILL.md` |
| Steps | See steps table below |
| Expected outcome | Names the controller's concurrent steps, the `brief written` and `review package` lines, and forbids waiting on a seat while such a step is pending |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read | phrases present |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-009 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-005) |
| Input | `SKILL.md` |
| Steps | See steps table below |
| Expected outcome | Package built, then `verify started` and `code-reviewer dispatched` before `verify done exit=<n>`; exit 1 joins the findings as one fix round, or goes to the other in-flight task with a `Ruling:` when its Files hold the failing tests; on exit 2 every in-flight seat reports and is ledgered before `kf stage <f> planning`, the review result kept; exit 3 is the controller's error; harness-agents-surface.test.ts :109-113 and task-harness-surface.test.ts :28-43 green |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read; run both surface tests | present; green |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-005) |
| Input | `SKILL.md`, `developer.md` step 6, `developer-brief.md`, `test-writer-brief.md` |
| Steps | See steps table below |
| Expected outcome | At most one developer seat in flight per worktree (spec- and fixed-test commits included); at most two tasks with a seat dispatched — head and next — and no seat of a later task before the head's `complete`; `fix queued — developer TASK-M in flight`; advisory runs, no full suite while another seat is in flight, `not mine: <file>`; the test-writer's run advisory while a developer is in flight |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read all four | phrases present |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Scratch item: one wave, two disjoint tasks and one pair sharing a path (testing stage scenario; behaviour of TASK-005) |
| Input | Controller runs `kanban-implement` |
| Steps | See steps table below |
| Expected outcome | Disjoint pair: `parallel test-writers` line, overlapping test-writer intervals, non-overlapping developer intervals; shared pair: `sequential … Files overlap` line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the scenario | ledger as described |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-005) |
| Input | `SKILL.md` §3.4, `references/re-review-brief.md` |
| Steps | See steps table below |
| Expected outcome | Unconditional cascade after a fix of H committed after developer X's dispatch; `TASK-X: cascade re-review owed — after <sha7> of TASK-H`, answered by `code-reviewer dispatched … cascade=<sha7>` and its `done`; the re-review brief has a slot for H's fix diff; X never marked complete before H or before the answer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read both | phrases present |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-010 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture: the drive-retire ledger rewritten with suffixes, seat lines and commit lists (task TASK-006) |
| Input | `references/task-loop.md`; the original and rewritten fixtures |
| Steps | See steps table below |
| Expected outcome | Each of the nine FR-014 shapes shown with ` @ <ISO>`; other lines suffixed and listed as not parsed for figures; a second suffix forbidden; `fix round`/`complete` use commit lists; no shape other than `fix round <R>/5` contains the phrase `fix round`; `grep -c 'fix round'` on the rewritten fixture equals its number of fix rounds |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read task-loop.md | as listed |
| 2 | Count | equal |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-014 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-006) |
| Input | Every example line in `task-loop.md` § The ledger |
| Steps | See steps table below |
| Expected outcome | Each of the nine example lines parses with `parseLedger` into its own shape; none is `unparsed`; an example of a ruling line is `other-timed` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse the examples | all classified |

## TC-025

| Field | Detail |
|---|---|
| Test case ID | TC-025 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch item: two chained disjoint tasks (testing stage scenario; behaviour of TASK-005) |
| Input | Controller runs `kanban-implement` |
| Steps | See steps table below |
| Expected outcome | `TASK-002: test-writer dispatched` before `TASK-001: developer done`; `TASK-002: developer dispatched` before `TASK-001: code-reviewer done`; no TASK-003 seat before `TASK-001: complete`; no two developer intervals overlap; `brief written` inside TASK-001's developer interval; package, `verify started`, `code-reviewer dispatched` before `verify done`; every line suffixed |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the scenario | ledger as described |

## TC-026

| Field | Detail |
|---|---|
| Test case ID | TC-026 |
| Requirement reference | FR-012 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture ledger with hand-computed figures (two tasks, one fix round, one wait, one cascade, two models) (task TASK-004) |
| Input | `loopStats(parseLedger(fixture))` |
| Steps | See steps table below |
| Expected outcome | Wall, per-seat and verify count/sum/median, seat (verify excluded), busy (union of seat and verify), saved, controller (= wall − busy), waits, rounds (fix round lines), cascades (owed lines), tasks, per-model minutes equal the fixture's expected JSON |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compute | equal to expected |

## TC-027

| Field | Detail |
|---|---|
| Test case ID | TC-027 |
| Requirement reference | FR-012 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixtures: mixed offsets (+07:00 and Z); nested and touching intervals; an orphan `dispatched`; a `done` before its `dispatched`; a malformed timed line; untimed lines (task TASK-004) |
| Input | `loopStats` |
| Steps | See steps table below |
| Expected outcome | Intervals in UTC, none negative; union counts each minute once; in orphan → re-dispatch → done, the done pairs with the re-dispatch and the orphan is listed; a done with no earlier dispatched and a `TASK-001: developer dispatchd …` (shape keyword, no match) listed as unparsed with line numbers; a timed ruling line counted as other-timed; untimed counted; a mid-loop fixture reports wall to the last timestamped line with `in progress` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compute each fixture | as listed |

## TC-028

| Field | Detail |
|---|---|
| Test case ID | TC-028 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch item: two chained disjoint tasks; TASK-001's reviewer gets a seeded MEDIUM finding (testing stage scenario; behaviour of TASK-005) |
| Input | Controller runs `kanban-implement` |
| Steps | See steps table below |
| Expected outcome | `TASK-001: fix queued` while developer 2 runs; after the fix commit, `TASK-002: cascade re-review owed — after <sha7> of TASK-001` answered by a `cascade=<sha7>` re-review whose brief holds the fix diff; `TASK-002: complete` after `TASK-001: complete` and the answer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the scenario | lines and report present |

## TC-029

| Field | Detail |
|---|---|
| Test case ID | TC-029 |
| Requirement reference | FR-011 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | The TC-025 scenario (three chained tasks; TASK-002 and TASK-003 disjoint, TASK-002 overlapping nothing) stopped at seven points in turn: (1) TASK-002 test-writer done, no developer dispatched, TASK-001's task commit not yet landed; (2) `verify started` without `done`; (3) `cascade re-review owed` unanswered; (4) a `fix queued`; (5) TASK-001's re-review `done status=findings` after `fix round 1/5`; (6) TASK-001's reviewer and TASK-002's developer open; (7) TASK-001 with every open finding parked at round 5 (testing stage scenario; behaviour of TASK-006) |
| Input | A fresh session runs `kanban-implement` |
| Steps | See steps table below |
| Expected outcome | Each stop resumes at its first unmet step: (1) TASK-002's developer waits for TASK-001's task commit, (2) verify re-run, (3) re-review dispatch, (4) fix after the in-flight developer, (5) fix round 2, (6) the two open seats, (7) TASK-001 completes; TASK-003 gets no seat while TASK-001 is incomplete; no double suffix |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Start the fresh session | two re-dispatches only |

## TC-030

| Field | Detail |
|---|---|
| Test case ID | TC-030 |
| Requirement reference | FR-007 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch item: a file outside TASK-001's Files staged before developer 1 commits (testing stage scenario; behaviour of TASK-005) |
| Input | Controller runs `kanban-implement` |
| Steps | See steps table below |
| Expected outcome | Developer 1 reports `BLOCKED` naming the path; no task commit contains it |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the scenario | BLOCKED; git log clean |

## TC-031

| Field | Detail |
|---|---|
| Test case ID | TC-031 |
| Requirement reference | FR-015 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch project with a complete timestamped item, an incomplete one, and a history file with an old header (task TASK-004) |
| Input | `kf loop-stats f --record` twice; `kf loop-stats g --record`; `--record` against the old-header file |
| Steps | See steps table below |
| Expected outcome | Row header `date · feature · tasks · wall · busy · controller · saved · waits · test-writer · developer · automation-writer · code-reviewer · verify · rounds · cascades · untimed`, integer minutes; one row for f after two runs; g exits 1 naming the incomplete tasks; the old header exits 1 naming the file, other rows untouched |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | as listed |

## TC-032

| Field | Detail |
|---|---|
| Test case ID | TC-032 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | This repository's item worktree after TASK-003 (testing stage run; behaviour of TASK-003) |
| Input | `kf verify loop-throughput --task TASK-003 --commits <its commits>` |
| Steps | See steps table below |
| Expected outcome | Exit 0: `harness.verify.task` from the main checkout's `.kf/config.json` runs in a detached worktree at the task's newest commit through the `node_modules` link; no `kf-verify-` worktree left (the item's `npm test` addition applies after merge; the full suite in a detached worktree is evidenced by the 2026-11-01 probe, 1131/1131) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run | exit 0 |

## TC-033

| Field | Detail |
|---|---|
| Test case ID | TC-033 |
| Requirement reference | FR-011 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-006) |
| Input | `SKILL.md`, `skills/travel/SKILL.md` |
| Steps | See steps table below |
| Expected outcome | Resume covers only the head and next task, in FR-011's eleven-step order; step 3 applies FR-004's gates; step 8 dispatches round R+1 after a re-review with findings and goes to the breaker at the cap; `complete` never re-dispatched; the old `last line is a fix round` rule and any "all seats done → completion" shortcut are gone; travel's resume text names per-task state |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read both | present / absent |

## TC-034

| Field | Detail |
|---|---|
| Test case ID | TC-034 |
| Requirement reference | FR-012 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch project (task TASK-004) |
| Input | `kf loop-stats f`, `--json`, on a mid-loop ledger, on a missing ledger, on an untimed ledger, `kf loop-stats` with no feature |
| Steps | See steps table below |
| Expected outcome | Exit 0 with the report and the same figures as JSON; mid-loop report says `in progress`; exit 1 `no ledger` / `ledger is untimed`; exit 3 usage |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | as listed |

## TC-035

| Field | Detail |
|---|---|
| Test case ID | TC-035 |
| Requirement reference | FR-016 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-006) |
| Input | `SKILL.md` §4 |
| Steps | See steps table below |
| Expected outcome | Runs `kf loop-stats <f> --record` and `kf loop-stats --all` after the last task and prints the report and `largest:` beside "Rulings I made" |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read | phrases present |

## TC-036

| Field | Detail |
|---|---|
| Test case ID | TC-036 |
| Requirement reference | FR-017 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-006) |
| Input | `skills/travel/SKILL.md`, `references/estimation.md` |
| Steps | See steps table below |
| Expected outcome | `measure` takes implementation `--work` (seat minutes, verify excluded) and `--review` (code-reviewer minutes) from `kf loop-stats <f> --json` when timestamped, notifications otherwise; estimation.md's work/review rows say which; travel-surface.test.ts green |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read; run the test | present; green |

## TC-037

| Field | Detail |
|---|---|
| Test case ID | TC-037 |
| Requirement reference | FR-015 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | High |
| Preconditions | History file with two rows of known values; no history file (task TASK-004) |
| Input | `kf loop-stats --all`, `--json`; then without the file |
| Steps | See steps table below |
| Expected outcome | Column medians, the median minutes per task of controller, test-writer, developer, code-reviewer, verify and waits, and `largest: <bucket> <n> min/task` equal hand-computed values; JSON matches; no file → exit 1 `no loop measured yet` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run each | as listed |

## TC-038

| Field | Detail |
|---|---|
| Test case ID | TC-038 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | - (task TASK-007) |
| Input | Every file under the spec's Affected surfaces |
| Steps | See steps table below |
| Expected outcome | Each file naming `kf verify … --base` or `review-package BASE HEAD` also names `--commits`; cli-reference.md documents `kf loop-stats` and `overlaps`; open-source-surface.test.ts green |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Grep the surfaces | paired; documented |
## TC-039

| Field | Detail |
|---|---|
| Test case ID | TC-039 |
| Requirement reference | FR-009 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | - (task TASK-005) |
| Input | `skills/kanban-implement/SKILL.md` |
| Steps | See steps table below |
| Expected outcome | States the evidence rule: a verify exit 1 of H failing tests in X's Files waits for any running verify of X, then stays with H when X's latest verify on a tree without H's fix passed them, else goes to X with a `Ruling:` naming tests and evidence; H stays unverified until X's next verify passes; X's `BLOCKED` naming H's Files returns it to H as a fix round; X parking the routed failure at its cap lets H complete with the parked failure named; the FR-005 completion check (clean review or all findings parked at the cap) is written out |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the skill | phrases present |

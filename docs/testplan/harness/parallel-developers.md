---
feature: parallel-developers
context: harness
created: 20261101_2158
status: archived
---
# Test Plan

> **Partly superseded by `adaptive-developer-cap`:** the fixed developer cap of 4 no longer holds — the loop runs a live developer cap that starts at min(2, ceiling), steps up by one after each clean parallel wave and halves on a contention-shaped verify failure, ceiling `harness.developers.max` (default 6); the wait line reads `<N> developers in flight`. Kept for history.

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`. Skill and doc behaviour is pinned by surface tests (Unit). The concurrency itself is run for real once at testing (TC-027).

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | parallel-developers |
| Context | harness |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`); scratch-repo tests for `commit-task.mjs`; scratch-dir tsc runs for `buildDist`; `kf tasks`/`kf loop-stats` fixtures; surface tests; one scenario run at testing |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 17 | 17 | graph and loop-stats computations, skill/doc surface |
| Integration | 13 | 13 | real tsc, scratch repos, CLI runs, scenario run |
| UI / E2E | 0 | 0 | no UI |
| **Total** | **30** | **30** | |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-004, FR-005, FR-010 | TC-018, TC-019, TC-020, TC-027 | 4 | all listed TCs pass |
| UC-002 | FR-004 | TC-029 | 1 | all listed TCs pass |
| UC-003 | FR-002, FR-003, FR-013 | TC-004, TC-005, TC-006, TC-007, TC-025 | 5 | all listed TCs pass |
| UC-004 | FR-001, FR-006 | TC-001, TC-002, TC-003, TC-021, TC-030 | 5 | all listed TCs pass |
| UC-005 | FR-007 | TC-022 | 1 | all listed TCs pass |
| UC-006 | FR-008 | TC-023 | 1 | all listed TCs pass |
| UC-007 | FR-009, FR-010 | TC-013, TC-014, TC-017, TC-026 | 4 | all listed TCs pass |
| UC-008 | FR-011, FR-012 | TC-015, TC-016, TC-024, TC-028 | 4 | all listed TCs pass |
| UC-009 | FR-014 | TC-008, TC-009, TC-010, TC-011, TC-012 | 5 | all listed TCs pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-004 | TC-001, TC-002, TC-003, TC-030 | yes | |
| FR-002 | UC-003 | TC-004, TC-005, TC-007 | yes | |
| FR-003 | UC-003 | TC-006 | yes | |
| FR-004 | UC-001, UC-002 | TC-018, TC-027, TC-029 | yes | |
| FR-005 | UC-001 | TC-020 | yes | |
| FR-006 | UC-004 | TC-021 | yes | |
| FR-007 | UC-005 | TC-022 | yes | |
| FR-008 | UC-006 | TC-023 | yes | |
| FR-009 | UC-007 | TC-013, TC-014, TC-017 | yes | |
| FR-010 | UC-001, UC-007 | TC-019, TC-026 | yes | |
| FR-011 | UC-008 | TC-024 | yes | |
| FR-012 | UC-008 | TC-015, TC-016, TC-028 | yes | |
| FR-013 | UC-003 | TC-025 | yes | |
| FR-014 | UC-009 | TC-008, TC-009, TC-010, TC-011, TC-012 | yes | |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch dir with a minimal `tsconfig.build.json` and one type-correct `.ts` file (task TASK-001) |
| Input | `buildDist(<scratch>)` |
| Steps | See steps table below |
| Expected outcome | Returns; the `.js` is emitted; stderr has no `build setup:` line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call buildDist | returns without throwing |
| 2 | Check stderr and outDir | no `build setup:` line; `.js` present |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch dir as TC-001 but the `.ts` file has `const x: number = "s"` (task TASK-001) |
| Input | `buildDist(<scratch>)` |
| Steps | See steps table below |
| Expected outcome | No throw; stderr carries `build setup: tsc exited 2 — type errors, dist emitted, continuing`; tsc's TS2322 diagnostic is printed; the `.js` is emitted |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call buildDist | returns without throwing |
| 2 | Check stderr | the exact warning line |
| 3 | Check outDir | `.js` present |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch dir with no `tsconfig.build.json` (tsc exit 1, probed 2026-11-01); a second scratch dir with `noEmitOnError: true` and a type error (exit 1, probed) (task TASK-001) |
| Input | `buildDist(<scratch>)` on each |
| Steps | See steps table below |
| Expected outcome | Each throws `Error` whose message is `build setup: tsc exited 1`; no continuing warning on stderr |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call buildDist on the dir without config | throws, status 1 |
| 2 | Call buildDist on the noEmitOnError dir | throws, status 1 |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch repo; `other.txt` modified and staged; `mine.txt` modified (task TASK-004) |
| Input | `node commit-task.mjs -m msg --allow mine.txt -- mine.txt` |
| Steps | See steps table below |
| Expected outcome | Exit 0, prints the new sha; the commit contains only `mine.txt`; `other.txt` is still staged (`git diff --cached --name-only` lists it) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the script | exit 0, sha printed |
| 2 | `git show --name-only HEAD` | only `mine.txt` |
| 3 | `git diff --cached --name-only` | `other.txt` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch repo; `outside.txt` modified (task TASK-004) |
| Input | `node commit-task.mjs -m msg --allow src -- outside.txt` |
| Steps | See steps table below |
| Expected outcome | Exit 4; stdout/stderr has `BLOCKED: outside.txt is outside the allowlist`; HEAD unchanged; index unchanged. Also exit 4 with `BLOCKED` on stderr, before any git call, for an absolute path, a `..` segment, a leading `:`, a backslash, and an `--allow` value that normalises to empty; the script's verdict equals `src/workflow/allowlist.ts` `pathAllowed` on a shared table; a copy of the script with no `dist/` beside it still runs (amended at review FINDING-001, FINDING-002) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the script | exit 4 and the BLOCKED line |
| 2 | Compare HEAD and `git diff --cached` | both unchanged |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch repo; `.git/index.lock` created by the test and held; `mine.txt` modified; test timeout 40 s (task TASK-004) |
| Input | `node commit-task.mjs -m msg --allow mine.txt -- mine.txt` |
| Steps | See steps table below |
| Expected outcome | Exactly 4 `attempt <n>` lines (1 + 3 retries, about 5 s apart), then `BLOCKED: index.lock held` with git's message; exit 5; `.git/index.lock` still exists; no commit; index unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the script (≈15 s) | exit 5 |
| 2 | Count `attempt` lines | 4 |
| 3 | Check the lock | file still present |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Scratch repo; a new untracked file `src/new.ts`; also a run with no `-m` (task TASK-004) |
| Input | `node commit-task.mjs -m msg --allow src -- src/new.ts`; `node commit-task.mjs --allow x -- x` |
| Steps | See steps table below |
| Expected outcome | The new file is added and committed under the bare directory entry (exit 0); the run with no `-m` prints usage on stderr and exits 2 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run with the new file | exit 0, file in HEAD |
| 2 | Run without -m | exit 2, usage |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-014 |
| Use case reference | UC-009 |
| Test type | Integration |
| Priority | High |
| Preconditions | Fixture plan: TASK-001→TASK-002→TASK-003 chain, TASK-004, TASK-005, TASK-006 independent with Files disjoint from each other and from the chain (task TASK-002) |
| Input | `kf tasks <f> --graph` |
| Steps | See steps table below |
| Expected outcome | `critical path: TASK-001 → TASK-002 → TASK-003 (length 3)`; `max width: 4 (TASK-001, TASK-004, TASK-005, TASK-006)`; `earliest start:` gives 1,2,3 for the chain and 1 for the others; exit 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the command | exit 0 |
| 2 | Compare the three lines | exact text |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-014 |
| Use case reference | UC-009 |
| Test type | Unit |
| Priority | High |
| Preconditions | Rows: TASK-001 and TASK-002 disjoint, TASK-003 with `files: null`, no dependencies (task TASK-002) |
| Input | `taskGraphSummary(rows)` |
| Steps | See steps table below |
| Expected outcome | `maxWidth` 2 with `widthSet` [TASK-001, TASK-002]; TASK-003 is in no set larger than 1 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call the function | maxWidth 2 |
| 2 | Check widthSet | excludes TASK-003 |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-014 |
| Use case reference | UC-009 |
| Test type | Unit |
| Priority | High |
| Preconditions | Rows: A→B→C (C depends on B, B on A), A and C disjoint, D independent and disjoint (task TASK-002) |
| Input | `taskGraphSummary(rows)` |
| Steps | See steps table below |
| Expected outcome | A and C never share the width set; `maxWidth` 2; `criticalPath` [A, B, C] |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call the function | maxWidth 2, critical path A,B,C |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-014 |
| Use case reference | UC-009 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | The TC-008 fixture; a plan with zero tasks; a plan of 30 disjoint tasks and one of 31 (task TASK-002) |
| Input | `kf tasks <f> --graph --json`; `kf tasks <f> --json`; `kf tasks <empty> --graph` |
| Steps | See steps table below |
| Expected outcome | `--graph --json` has keys feature, criticalPath, length, maxWidth, maxWidthExact, widthSet, earliestStart (maxWidthExact amended at review FINDING-003); above 30 tasks the text prints `max width: ≥N` and maxWidthExact is false; `--json` alone is byte-identical to the pre-change output; zero tasks prints `critical path: none (length 0)` and `max width: 0` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run --graph --json | the seven keys, maxWidthExact true |
| 2 | Run --json | byte-identical |
| 3 | Run on the empty plan | the two zero lines |
| 4 | Run --graph and --graph --json on the 30-task plan | exact `max width: 30`, maxWidthExact true |
| 5 | Run --graph and --graph --json on the 31-task plan | `max width: ≥N (ids)`, maxWidthExact false, no two ids in the set conflict |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-014 |
| Use case reference | UC-009 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `skills/kanban-plan/SKILL.md` and `docs/workflow/cli-reference.md` (task TASK-006) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | kanban-plan § 3 approval summary names `kf tasks <feature> --graph`; cli-reference names `--graph`, critical path and max width |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | phrases present |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-009 |
| Use case reference | UC-007 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture ledger `three-developers` with 3 overlapping developer intervals (hand-computed in its header comment) (task TASK-003) |
| Input | `loopStats(parseLedger(text), deps)` |
| Steps | See steps table below |
| Expected outcome | `developersPeak` 3 and `developerOverlapMinutes` equal to the hand-computed values |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compute | both figures equal the fixture's expected.json |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-009 |
| Use case reference | UC-007 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Ledger with developer A ending at 10:20 and developer B dispatched at 10:20 (task TASK-003) |
| Input | `loopStats(...)` |
| Steps | See steps table below |
| Expected outcome | `developersPeak` 1; `developerOverlapMinutes` 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compute | peak 1, overlap 0 |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-012 |
| Use case reference | UC-008 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture `three-developers`: a dispatch gated by `test-writer done`, one by a dependency's `developer done`, one by `TASK-MMM: complete` after a `Files overlap … (TASK-MMM)` wait, one by the first `developer done` after a `4 developers in flight` wait (task TASK-003) |
| Input | `loopStats(parsed, deps)` |
| Steps | See steps table below |
| Expected outcome | `dispatchLag.developer` median, max and n equal the hand-computed values; each lag uses the latest gate line before the dispatch; a dispatch with `round=` is not counted |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compute | developer lag equals expected |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-012 |
| Use case reference | UC-008 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture: one code-reviewer gated by `developer done`, one by a later `automation-writer done`, one with `round=`; and a ledger with no code-reviewer dispatch (task TASK-003) |
| Input | `loopStats(...)` |
| Steps | See steps table below |
| Expected outcome | `dispatchLag.codeReviewer` uses the latest of the two gate lines and skips `round=`/`cascade=`; with no dispatch `{ median: null, max: null, n: 0 }` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Compute both ledgers | values equal expected |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-009 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch `.works` item with the `three-developers` ledger; an existing `.works/loop-metrics.md` (task TASK-003) |
| Input | `kf loop-stats <f>`; `kf loop-stats <f> --json`; `kf loop-stats <f> --record` |
| Steps | See steps table below |
| Expected outcome | Text has `developers peak: 3`, `developer overlap: <x.x> min` and `dispatch lag: developer median … code-reviewer median …`; JSON carries `developersPeak`, `developerOverlapMinutes`, `dispatchLag`; the history header is byte-identical to `HEADER` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run text | three lines |
| 2 | Run --json | three keys |
| 3 | Run --record and read the file | header unchanged |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/kanban-implement/SKILL.md` and `references/task-loop.md` (task TASK-005) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | They state the cap of 4 counting fix-round and resume-commit developers; the three dispatch conditions; the open-task definition (a `test-writer dispatched` or `developer dispatched` line and no `complete` line); the tie-break (a test-written task does not hold back an earlier task's developer; a task whose test-writer is in flight holds back every overlapping task; amended at review FINDING-005); unknown Files overlap everything; both wait lines verbatim: `TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)` and `TASK-NNN: developer waits — 4 developers in flight` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | each phrase present |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-010 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Every file under `skills/`, `README.md`, `docs/workflow/`, `.github/pages/index.html` (task TASK-005) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | None states `one developer seat in flight per worktree`, `at most two tasks in flight` or `no seat of a later task is dispatched until H is complete` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Scan | no match |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `SKILL.md`, `references/test-writer-brief.md` (task TASK-005) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | Test-writers may run for the next 4 tasks without `test-writer done`; a test-writer never writes inside another open task's Files; its runs are advisory while a developer is in flight |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | phrases present |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-006 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | `references/developer-brief.md`, `skills/kanban-flow/agents/developer.md` (task TASK-005) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | While another developer is in flight: focused tests only, never the full suite; `not mine: <file>`; the build setup's exit-2 warning is expected; `kf verify --task … --commits` is the authoritative check |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | phrases present |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-007 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | `SKILL.md`, `references/task-loop.md` (task TASK-005) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | Completion: own gates plus dependencies complete, no plan-order barrier, independent tasks complete in any order; `TASK-X: cascade re-review owed — after <sha7> of TASK-H` only when X depends on H directly or transitively; the stage gate's full build and suite named as backstop |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | phrases present |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-008 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | `SKILL.md` § Resume (task TASK-005) |
| Input | Read the file |
| Steps | See steps table below |
| Expected outcome | Resume re-dispatches every `dispatched` with no `done` of any seat (developers up to the cap) and re-runs every `verify started` without `verify done`, before any new developer; a fix round found at the cap writes `developer waits — 4 developers in flight`; the numbered per-task resume list applies to every open task |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | phrases present; numbered list intact |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-011 |
| Use case reference | UC-008 |
| Test type | Unit |
| Priority | High |
| Preconditions | `SKILL.md` (task TASK-005) |
| Input | Read the file |
| Steps | See steps table below |
| Expected outcome | The five-item ordered work list in this order: dispatch every ready seat; start verify and package for newly committed tasks; write the next brief; run later scouts; write owed ledger lines and reports. Verify, full suite and build run with the runtime's background option; the turn ends only when no item applies and a seat or background command is running |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | items in order; both rules present |

## TC-025

| Field | Detail |
|---|---|
| Test case ID | TC-025 |
| Requirement reference | FR-013 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | `references/developer-brief.md`, `skills/kanban-flow/agents/developer.md` (task TASK-005) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | Commit via `node <skills dir>/kanban-implement/scripts/commit-task.mjs` with the allowlist; exit 4/5 reported as `BLOCKED`; allowed commands `git add -- <paths>` and `git commit -m <msg> -- <paths>`; each forbidden command named: `checkout`, `switch`, `reset`, `restore --staged`, `stash`, `rebase`, `merge`, `cherry-pick`, `commit` without a pathspec, `commit -a`, `add -A`, `add .`, `clean`, `GIT_INDEX_FILE`; the old `git diff --cached --name-only` check absent |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | each phrase present, old check absent |

## TC-026

| Field | Detail |
|---|---|
| Test case ID | TC-026 |
| Requirement reference | FR-010 |
| Use case reference | UC-007 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `README.md`, `docs/workflow/harness.md`, `lifecycle.md`, `cli-reference.md`, `.github/pages/index.html`, `CHANGELOG.md` (task TASK-006) |
| Input | Read the files |
| Steps | See steps table below |
| Expected outcome | They describe concurrent developers in one worktree, the cap of 4, both wait lines, the controller work list, the build setup's exit-2 rule, `commit-task.mjs`, `kf tasks --graph`, `developers peak` and `dispatch lag`; `one developer at a time per worktree` (README.md:249) and `one developer seat at a time` (harness.md:42) are absent; the Unreleased section still contains the needles pinned at open-source-surface.test.ts:403-409 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert | phrases present |

## TC-027

| Field | Detail |
|---|---|
| Test case ID | TC-027 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | At testing: a scratch item in a scratch repo with 3 ready tasks with disjoint Files and a 4th overlapping one of them; the worktree's kanban-implement text; real developer seats (task TASK-005) |
| Input | Run the loop for that item |
| Steps | See steps table below |
| Expected outcome | The ledger shows overlapping developer intervals for the 3 (`kf loop-stats` `developers peak` ≥ 3), a `developer waits — Files overlap` line for the 4th, and `dispatch lag` developer `max` ≤ 1.0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the scenario | 3 developers overlap |
| 2 | Read the ledger | the wait line for the 4th |
| 3 | `kf loop-stats --json` | developersPeak ≥ 3, dispatchLag.developer.max ≤ 1.0 |

## TC-028

| Field | Detail |
|---|---|
| Test case ID | TC-028 |
| Requirement reference | FR-012 |
| Use case reference | UC-008 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Scratch `.works` item whose plan has TASK-002 depending on TASK-001, and a ledger where TASK-002's developer dispatch follows TASK-001's `developer done` (task TASK-003) |
| Input | `kf loop-stats <f> --json` |
| Steps | See steps table below |
| Expected outcome | The developer lag of TASK-002 is measured from TASK-001's `developer done` (the CLI passes `taskView` dependencies) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run | lag equals the dependency gap |

## TC-029

| Field | Detail |
|---|---|
| Test case ID | TC-029 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `references/task-loop.md` § The ledger examples (task TASK-005) |
| Input | Parse each example with `parseLedger` |
| Steps | See steps table below |
| Expected outcome | The two new wait-line examples parse as the `developerWaits` shape; the legacy `fix queued` shape is still listed and parses |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse examples | expected shapes |

## TC-030

| Field | Detail |
|---|---|
| Test case ID | TC-030 |
| Requirement reference | FR-001 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Scratch dir with a `vitest.config` whose `globalSetup` is this repo's `src/tests/setup/build.ts`, a `tsconfig.build.json`, one `.ts` with a type error and one passing test file (task TASK-001) |
| Input | `npx vitest run` in the scratch dir (subprocess, output captured) |
| Steps | See steps table below |
| Expected outcome | The scratch test runs and passes; the captured output carries tsc's TS2322 diagnostic and `build setup: tsc exited 2 — type errors, dist emitted, continuing`; exit 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Spawn vitest | exit 0, test passed |
| 2 | Search the output | TS2322 and the warning line |

---
feature: loop-throughput
context: harness
created: 20261101_1349
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Pipeline two neighbouring tasks in one worktree |
| Requirement reference | FR-003, FR-004, FR-007, FR-008, FR-009 (uses FR-001, FR-002, FR-013) |
| Goal | Overlap test-writer N+1 with developer N, and code-reviewer N plus verify N with developer N+1, with one developer and at most two tasks in flight |
| Primary actor | Controller |

## Supporting Actors
- test-writer, developer, code-reviewer seats
- `kf tasks --json`, `kf verify --commits`, `review-package --commits`

## Preconditions
- The item is in implementation with an approved plan
- Task N is the head (earliest incomplete task) and N+1 the next task; no other task has a seat dispatched

## Trigger
Developer N is dispatched.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Reads `kf tasks <f> --json`; task N+1's `overlaps` does not name task N | Pipelining allowed |
| 2 | Controller | Dispatches test-writer N+1 (`TASK-N+1: test-writer dispatched model=… @ <ts>`) while developer N runs; writes the next brief and hashes meanwhile (`TASK-N+1: brief written`) | Two seats in flight, one developer |
| 3 | Developer N | Stages by path, checks `git diff --cached --name-only` against its Files and handed tests, commits the task (a UI task's spec commit follows before step 4) | N's last task commit lands |
| 4 | Controller | Builds `review-package --commits <N's commits>`, then starts `kf verify <f> --task TASK-N --commits <N's commits>` and dispatches code-reviewer N (`review package`, `verify started`, `code-reviewer dispatched` lines) | Verify and review run |
| 5 | Controller | Dispatches developer N+1 at once (developer N has reported); takes the "fails for the right reason" judgement for N+1's tests from developer N+1's step-3 run when test-writer N+1's run was advisory | Developer N+1 runs beside reviewer N and verify N |
| 6 | Controller | On `verify done exit=0` and a clean review, writes `TASK-N: complete (commits …)`; N+1 becomes the head and test-writer N+2 may start | Task N complete while N+1 is still developing |

## Alternative Flows
### A1
- Trigger: Task N+1's `overlaps` names task N at step 1

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Controller dispatches neither test-writer N+1 nor developer N+1 until `TASK-N: complete`, ledgering `TASK-N+1: developer waits — Files overlap <entry> / <entry>` | Rejoins at step 6, sequential |

### A2
- Trigger: Reviewer N returns a HIGH/MEDIUM finding, or verify N exits 1, while developer N+1 runs

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Controller ledgers `TASK-N: fix queued — developer TASK-N+1 in flight` | Fix waits |
| A2.2 | When developer N+1 reports, the controller resumes developer N with the findings (and the verify output as one fix round) | Continues in UC-004 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A path outside the developer's Files and handed tests is staged | Developer reports `BLOCKED` naming the paths and does not commit | Controller rules on the stray paths |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf verify` exits 2 for task N | Controller waits for every in-flight seat to report and ledgers them, keeps the reviewer's result, then `kf stage <f> planning` | Human re-approves |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf verify` exits 3 | Controller fixes its call and re-runs it; never a fix round | Verify re-run |

### E4

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Test-writer N+1 needs an interface N has not committed | It reports `NEEDS_CONTEXT`; controller re-dispatches after N's commit | No guessing |

## Postconditions
- Each task's commits, review package and verify cover exactly that task's commits
- At no moment were two developer seats in flight

## Business Rules
- One developer per worktree (FR-003)
- No seat of a third task is dispatched while the head is incomplete (FR-003)
- Verify exit 1 whose failing tests belong to N+1's Files stays with N when N+1's latest verify on a tree without N's fix passed them (waiting for a running one first), else goes to N+1 with a `Ruling:`; N stays unverified until N+1's next verify passes (FR-009)
- The code-reviewer grades the package; other files in the working tree are context only (FR-004)
- Developer runs while another seat is in flight are advisory; failures in files it neither wrote nor was handed are reported `not mine: <file>`
- The controller never waits on a seat while a brief, hash, package or ledger step is pending (FR-008)

## Data
- Ledger lines in the FR-014 grammar with ` @ <ts>`
- `overlaps` from `kf tasks --json`

## Acceptance Criteria
- [ ] Ledger shows test-writer N+1 dispatched before developer N done, and developer N+1 dispatched before code-reviewer N done (FR-004)
- [ ] No seat of task N+2 is dispatched before `TASK-N: complete` (FR-003)
- [ ] No two developer intervals overlap; a fix due during another developer shows `fix queued` (FR-003)
- [ ] A stray staged path ends in `BLOCKED` naming it (FR-007)
- [ ] `brief written` for N+1 falls inside developer N's interval (FR-008)
- [ ] `verify started` and `code-reviewer dispatched` precede `verify done exit=<n>` (FR-009)

---
feature: parallel-developers
context: harness
created: 20261101_2201
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Run focused tests while other developers edit |
| Requirement reference | FR-001, FR-006 |
| Goal | Run focused tests while other developers edit (build setup exit-2 rule, not mine) |
| Primary actor | Developer |

## Supporting Actors
- Controller: dispatched this developer while other developer seats are in flight in the same worktree.
- Other developers: editing files outside this developer's Files, possibly leaving type errors in `src/`.
- `buildDist` in `src/tests/setup/build.ts` (vitest global setup, `tsc -p tsconfig.build.json`).

## Preconditions
- The worktree is shared; at least one other developer seat is in flight (UC-001).
- The task's test-writer is done and its tests are ledgered.
- The developer knows its [FILES] and [TEST_FILES] from the brief.

## Trigger
The developer finishes an edit and needs test feedback before it commits (step 6 of the developer brief), while another developer is in flight.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Developer | Runs only its focused tests, for example `npx vitest run <its test files>`; never the full suite while another developer is in flight | One vitest run starts |
| 2 | `buildDist` | Runs `tsc -p tsconfig.build.json` with `stdio: "inherit"` via `spawnSync`, so diagnostics pass through unchanged | tsc exits 0 |
| 3 | `buildDist` | Status 0 returns with no message | `dist/` is fresh; the suite runs |
| 4 | Developer | Reads the focused results | All focused tests pass |
| 5 | Developer | Continues to the commit step (UC-003); `kf verify --task ... --commits <its commits>` stays the authoritative check | Task is ready to commit |

## Alternative Flows
### A1
- Trigger: another developer's half-done edit has a type error, so tsc exits 2 (type errors, JavaScript still emitted).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `buildDist` leaves tsc's diagnostics on screen and writes `build setup: tsc exited 2 — type errors, dist emitted, continuing` to stderr; it does not throw | The suite runs |
| A1.2 | Developer treats the warning as expected and ignores diagnostics for files outside its own Files | Returns to main flow step 4 |

### A2
- Trigger: a focused test fails in a file outside the developer's Files and test files.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Developer reports `not mine: <file>` and treats the failure as advisory | No edit to the other file |
| A2.2 | Developer continues; `kf verify --task ... --commits` decides | Returns to main flow step 5 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| tsc exits with any non-zero status other than 2 (1, 3, 4), a `null` status, or a spawn error such as tsc not runnable | `buildDist` throws `Error("build setup: tsc exited <status>")`, with the spawn error as `cause` when there is one | Vitest fails before any test runs; `dist/` is missing or stale, so continuing would test old code |
| Another developer's file throws at module load (syntax error) during a spawned-CLI test | The exit-2 rule cannot help; the developer reports `not mine: <file>` | Advisory failure; `kf verify` decides |

## Postconditions
- Focused tests of the task ran without being blocked by another developer's type errors.
- No full suite was run by the developer while another developer was in flight.
- Any failure outside the developer's files is reported as `not mine: <file>`, not fixed or hidden.
- No environment variable was needed or set.

## Business Rules
- Exit 0: unchanged. Exit 2: warn on stderr and continue. Any other non-zero exit, `null` status or spawn error: throw (FR-001).
- Type errors are not swallowed: tsc diagnostics pass through; `npm run typecheck` runs in `harness.verify.task` after each task commit and in the required CI `lint` job; `harness.verify.stage` runs the strict `npm run build`.
- A plain local `npm test` going green no longer implies a clean typecheck; the stderr warning and the gates above cover this.
- While another developer is in flight, only focused tests run (FR-006); the full suite and build belong to the stage gate.
- `buildDist` is the single code path; `setup()` calls `buildDist(process.cwd())` and takes no parameter.

## Data
- tsc exit status: 0, 2 or other; determines continue, warn-and-continue or throw.
- stderr line: `build setup: tsc exited 2 — type errors, dist emitted, continuing`.
- Error message: `build setup: tsc exited <status>`.
- Developer report line: `not mine: <file>`.
- Files: [FILES] and [TEST_FILES] from the developer brief.

## Acceptance Criteria
- [ ] With a type error planted in one `src/` file, `npx vitest run <an unrelated test file>` runs that file's tests and prints the warning plus the diagnostics. (FR-001)
- [ ] With tsc made to exit with another non-zero code (for example a broken `tsconfig.build.json`), the run fails before any test runs and the message names the status. (FR-001)
- [ ] `buildDist` on a clean scratch dir writes no stderr line and does not throw. (FR-001)
- [ ] The developer and test-writer brief prose state the focused-test rule, the advisory rule and `not mine: <file>`. (FR-006)
- [ ] `kf verify --task ... --commits` remains the authoritative check after focused tests. (FR-006)

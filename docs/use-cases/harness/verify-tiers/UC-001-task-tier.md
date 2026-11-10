---
feature: verify-tiers
context: harness
created: 20261109_1700
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Verify a task on its related tests |
| Requirement reference | FR-001, FR-002 |
| Goal | After a task commit, prove the task with typecheck plus only the tests related to the files it changed, instead of the full suite |
| Primary actor | Agent session |

## Supporting Actors
- kf CLI: validates the config, derives the changed files, runs argv without a shell, writes the task log.
- Human (project owner): pins `harness.verify.related` in `.kf/config.json`; kf never writes it.

## Preconditions
- `harness.verify.task` is pinned, and `harness.verify.related` is a valid argv (this repository: `["npx","vitest","related","--run"]`).
- The task has at least one commit; the plan gives its Files allowlist (a bug task has none).

## Trigger
The session runs `kf verify <f> --task TASK-NNN --commits <shas>` (or `--base <ref>`) after the task's commit.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf CLI | Loads `.kf/config.json` and validates `harness.verify.related` like a `harness.verify.task` entry | Config accepted; a bad shape stops here (E1) |
| 2 | kf CLI | Checks the changed files against the task's Files allowlist | Unchanged check, exit 2 on a file outside Files |
| 3 | kf CLI | Checks out the commits in a detached worktree and runs every `harness.verify.task` command | Typecheck passes |
| 4 | kf CLI | Takes the union of the commits' changed files against their parents, drops deleted files, sorts them, repo-relative | Sorted list of existing files |
| 5 | kf CLI | Runs `harness.verify.related` with those files appended as further argv elements | Related tests pass |
| 6 | kf CLI | Appends every argv it ran to `loop/task-NNN-verify.log`, removes the worktree, exits 0 | Session records `verify done exit=0` |

## Alternative Flows
### A1
- Trigger: the session passes `--base <ref>` instead of `--commits`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf runs the task commands, then the related argv in the working tree, with the files of `base..HEAD` | Same appended, sorted, repo-relative list; returns to step 6 |

### A2
- Trigger: the task is a bug task (no Files allowlist).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | kf derives the same changed files and appends them | Related runs as for a feature task; returns to step 6 |

### A3
- Trigger: `harness.verify.related` is not set, or a changed file was renamed.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Not set: kf runs only `harness.verify.task` | Behaviour and log exactly as today; ends at step 6 |
| A3.2 | Renamed: kf passes the new path and drops the old one | Related receives the new path only; returns to step 5 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The task only deleted files, so no changed file exists in the tree it runs in | kf runs no related command and prints `No related tests: the task changed no file that exists at <sha7>.` | Exit comes from the task commands alone; the line is in the log |
| The related command exits non-zero | kf stops, logs the failure, removes the worktree | Exit 1; the session records `verify done exit=1` and repairs |
| A changed file is outside the task's Files | The allowlist check fails before any command runs | Exit 2 as today; no related command |
| `harness.verify.related` is an empty array, a non-array, has `""`, a leading `-` or a `{…}` placeholder | Config validation throws | Config error naming `harness.verify.related`; nothing runs |

## Postconditions
- `loop/task-NNN-verify.log` names every argv that ran, typecheck first, then `<related> <files>`.
- The detached worktree is removed on every exit path; no stage record is written by the task tier.

## Business Rules
- Task tier = `harness.verify.task`, then `harness.verify.related` plus the task's existing changed files; the project's pinned command decides which tests are related.
- Commands come only from the human-pinned config, run without a shell; files are argv elements, never interpolated.
- Related selection may miss dynamic dependencies; the wave tier is the backstop (UC-002).
- An argv too long for the OS is a spawn failure (`not-started`, exit 1); no chunking.

## Data
- `harness.verify.related`: one non-empty string array in `.kf/config.json`.
- Changed files: union of the task commits against their parents (or `base..HEAD`), deletions dropped, sorted, repo-relative.
- `loop/task-NNN-verify.log`: per-task log of every argv run and its output.

## Acceptance Criteria
- [ ] A valid `harness.verify.related` loads; an empty array, a non-array, an argv with `{…}`, an empty string or a leading `-` is refused naming `harness.verify.related` (TC-001).
- [ ] With `--commits`, task commands run first, then the related argv with the task's existing changed files appended, sorted and repo-relative (TC-002).
- [ ] With `--base`, the same sequence runs over `base..HEAD` (TC-003).
- [ ] A task that only deleted files runs no related command and prints the `No related tests` line; a renamed file is passed by its new path only (TC-004).
- [ ] Without `harness.verify.related` the run and the log equal today's (TC-005).
- [ ] A failing related command exits 1; a file outside Files exits 2 before any command runs (TC-006).
- [ ] A bug task gets the same changed files appended (TC-007).

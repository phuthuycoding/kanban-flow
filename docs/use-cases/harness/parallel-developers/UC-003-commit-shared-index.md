---
feature: parallel-developers
context: harness
created: 20261101_2204
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Commit a task with a shared index |
| Requirement reference | FR-002, FR-003, FR-013 |
| Goal | Commit a task with a shared index (commit-task.mjs helper, lock retry, allowed/forbidden git commands) |
| Primary actor | Developer |

## Supporting Actors
- Other developer, test-writer and code-reviewer seats working in the same worktree, whose staged or unstaged paths sit in the shared index.
- The controller, which reads the developer's report (`DONE` or `BLOCKED`).
- `kf verify --task … --commits`, the authoritative Files check after the commit.

## Preconditions
- The developer was dispatched for a task with known [FILES] and [TEST_FILES] ([SPEC_FILES] for the spec commit).
- The developer has changed or been handed the paths to commit, and its focused tests pass.
- The worktree is shared: another seat may have paths staged and may be writing the index at the same moment.
- `skills/kanban-implement/scripts/commit-task.mjs` exists; it is standalone, with the allowlist matcher inlined, so it needs no built `dist/` (amended at review FINDING-001). It runs with `node`, because installs do not set the exec bit.

## Trigger
The developer reaches its commit step (developer.md step 7) and runs `commit-task.mjs -m <message> --allow <[FILES],[TEST_FILES]> -- <paths>`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Developer | Runs `node <skills dir>/kanban-implement/scripts/commit-task.mjs -m <message> --allow <entry> [--allow <entry>…] -- <path>…`, naming exactly the paths it changed or was handed | The helper starts |
| 2 | commit-task.mjs | Checks every `<path>` with `pathAllowed` (the matcher `kf verify` uses: exact path, directory prefix or glob) | All paths are inside the allowlist |
| 3 | commit-task.mjs | Runs `git add -- <path>…` (needed for new files; it takes `.git/index.lock`) | The named paths are staged; other seats' staged paths are untouched |
| 4 | commit-task.mjs | Runs `git commit -m <message> -- <path>…` | One commit holds only the named paths; other staged entries stay in the index |
| 5 | commit-task.mjs | Prints the new commit's sha | Exit 0 |
| 6 | Developer | Reports `DONE` with the sha; the controller runs `kf verify --task … --commits <its commits>` | The commit is checked against the task's Files |

## Alternative Flows
### A1
- Trigger: another path is already staged in the index by a different seat.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `git diff --cached --name-only` is not used; the foreign path is ignored | No false `BLOCKED`; returns to step 3 |
| A1.2 | The pathspec after `--` limits the commit | The foreign path stays staged after the commit; rejoin at step 5 |

### A2
- Trigger: `git add` or `git commit` fails with `index.lock` in stderr, then the lock clears within the retry window.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | commit-task.mjs retries that command, up to 3 retries, 5 s apart (4 attempts in all), printing `attempt <n>` on stderr | A later attempt succeeds; returns to the step that failed |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A named path is outside the allowlist | commit-task.mjs stops before any git command | `BLOCKED: <path> is outside the allowlist`, exit 4, no commit, index unchanged; the developer reports `BLOCKED` naming the path |
| `index.lock` still held after the 4th attempt | commit-task.mjs stops, never removes the lock | `BLOCKED: index.lock held` plus git's message, exit 5; lock file still present; paths already added stay staged; the developer reports `BLOCKED: index.lock held` and a human clears a stale lock |
| A path is absolute, has a `..` segment, starts with `:` or contains a backslash, or an `--allow` value normalises to empty | commit-task.mjs refuses before any git call | `BLOCKED: <path> <reason>` on stderr, exit 4, nothing changed (amended at review FINDING-002) |
| A path is `.` or an existing directory | commit-task.mjs refuses before any git call | `BLOCKED: <path> is a directory; name each file` on stderr, exit 4, nothing changed (amended at review 64dc74be FINDING-002) |
| The script is run from a subdirectory of the repository | commit-task.mjs refuses before any git call | `BLOCKED: run from the repository root (cwd is <prefix>)` on stderr, exit 4, nothing changed (amended at review 33aa4464 FINDING-001) |
| The commit succeeded but its sha cannot be read from `git log -1 -- <paths>` | commit-task.mjs stops | `BLOCKED: commit made but its sha could not be read; check git log` on stderr, exit 4; the commit exists; the developer reports `BLOCKED` with the sha from `git log` and never commits those paths again, and the controller adds that sha to the task's commit list (amended at review 64dc74be FINDING-001, 80ba98b3 FINDING-002) |
| No `<path>`, no `--allow` or no `-m` | Usage on stderr | Exit 2, nothing changed |
| Any other git failure | commit-task.mjs passes git's message and exit code through | Developer reports `BLOCKED` with that message |
| The developer needs a forbidden command (FR-013) | It does not run it | `BLOCKED` report naming the command |

## Postconditions
- Success: one new commit contains exactly the named paths; every other seat's staged or unstaged changes are intact; HEAD moved only by that commit.
- Failure: no commit exists, except after `BLOCKED: commit made …`, where the one commit exists and is reported by sha; `.git/index.lock` is never deleted, and the developer's report names the cause.

## Business Rules
- Commit rule (FR-002): `git commit -m <message> -- <paths>`; every path must be in [FILES] plus [TEST_FILES] (plus [SPEC_FILES] for the spec commit). This replaces the `git diff --cached --name-only` check.
- Retry rule (FR-003): one attempt plus up to 3 retries, 5 s apart, for `git add` and `git commit` each, only when stderr contains `index.lock`. Stale locks are reported, never removed.
- While another seat is in flight (FR-013) the developer runs only `git add -- <paths>` (inside its allowlist) and `git commit -m <msg> -- <paths>`.
- Forbidden: `checkout`/`switch`, `reset`, `restore --staged` on another seat's paths, `stash`, `rebase`, `merge`, `cherry-pick`, `commit` without a pathspec, `commit -a`, `add -A`/`add .`, `clean`, `GIT_INDEX_FILE`.
- Paths are passed as argv after `--`, never through a shell string. The glob match is slightly wider than `kf verify`; `kf verify --commits` stays authoritative.

## Data
- Allowlist: the `--allow` entries built from [FILES], [TEST_FILES] and, for the spec commit, [SPEC_FILES].
- Shared index: `.git/index` and `.git/index.lock` in the item's single worktree.
- Exit codes: 0 success (the printed sha is the latest commit on the named paths), 2 usage, 4 refused (outside allowlist, bad path, `.` or directory, subdirectory cwd) or `commit made` with the sha unread, 5 lock held, otherwise git's own status (amended at review 80ba98b3 FINDING-002).
- Script path: the absolute path of `kanban-implement/scripts/commit-task.mjs`, filled by the controller into the brief's `[COMMIT_SCRIPT]` (amended at review 80ba98b3 FINDING-001).
- Developer report: `DONE` with sha, or `BLOCKED` with the path, command or `index.lock held`.

## Acceptance Criteria
- [ ] With another path staged, the developer's commit contains only its named paths and the other path stays staged. (FR-002)
- [ ] A named path outside the allowlist gives `BLOCKED: <path> is outside the allowlist`, exit 4, no commit. (FR-002)
- [ ] A held `index.lock` gives 4 attempts, then `BLOCKED: index.lock held`, exit 5, and the lock file still exists. (FR-003)
- [ ] A new file is added and committed in one `commit-task.mjs` run. (FR-002)
- [ ] developer.md and the developer brief list the allowed and forbidden git commands, and surface tests pin each forbidden one. (FR-013)

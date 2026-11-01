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
| ID | UC-003 |
| Name | Verify a task by its commit list in a clean checkout |
| Requirement reference | FR-001, FR-002, FR-013 |
| Goal | Check and package exactly one task's commits, and run its verify commands against committed files only |
| Primary actor | Controller |

## Supporting Actors
- `kf verify`
- `review-package`
- git

## Preconditions
- The task's commits are on the item branch
- `harness.verify.task` is configured

## Trigger
A developer's task commit (or fix commit) lands.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Controller | Builds `review-package --commits <a>,<b> <out>`, then runs `kf verify <f> --task TASK-### --commits <a>,<b>` (history order) beside the code-reviewer | Package exists before verify and review start |
| 2 | `kf verify` | Validates every sha (commit, ancestor of the item HEAD, one parent, in order) and that `--base` is absent | Valid list |
| 3 | `kf verify` | Checks the union of each commit's files against the task's Files | Allowlist result |
| 4 | `kf verify` | Creates a detached worktree `kf-verify-*` at the newest sha, links `node_modules` from the item dir when present, runs `harness.verify.task` there | Commands run on committed files only |
| 5 | `kf verify` | Removes the worktree in a `finally` and exits 0 | No worktree left |

## Alternative Flows
### A1
- Trigger: The item dir has no `node_modules`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | No link is created; commands run as they are | Exit per the commands |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A sha is unknown, a merge, a non-ancestor, out of order; the list is empty; `--base` is also given | Exit 3 naming the cause; nothing runs | Controller fixes its call |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A changed file is outside the task's Files | Exit 2 listing the files | Plan change |

### E3

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A verify command fails or is not found | Exit 1 with the command and output tail; worktree removed | Fix round |

### E4

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The detached worktree cannot be created | Exit 3 `kf verify could not run: …`; nothing ran; nothing left | Reported |

### E5

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `review-package --commits` gets a merge, unknown or repeated sha, or `--untracked` | Exit 2 | Controller fixes its call |

### E6

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `review-package --commits` diff is empty | Exit 3 `empty commit list diff` | Developer committed nothing |

## Postconditions
- The item worktree is unchanged
- `kf verify` reads `harness.verify.task` from the main checkout's `.kf/config.json`
- No `kf-verify-*` worktree remains

## Business Rules
- `--base` and `BASE HEAD` keep today's behaviour
- This repository's `harness.verify.task` is typecheck then `npm test`

## Data
- Commit list: comma-separated shas in history order

## Acceptance Criteria
- [ ] `--commits <TASK-002 sha>` exits 0 although a later TASK-001 commit touches a file outside TASK-002's Files; listing that commit exits 2 (FR-001)
- [ ] Each refusal case exits 3 (FR-001)
- [ ] With an uncommitted failing test in the item worktree, `--commits` exits 0 and `--base` exits 1 (FR-013)
- [ ] `review-package --commits a,b` holds a's and b's hunks and none of a commit between them; range mode unchanged (FR-002)

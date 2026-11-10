---
feature: verify-evidence
context: harness
created: 20261109_1326
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Record a stage verify run |
| Requirement reference | FR-001 |
| Goal | Every `kf verify <f> --stage` run that ran at least one command leaves one record in the item folder that kf alone wrote. |
| Primary actor | Agent session |

## Supporting Actors
- kf CLI: runs the pinned commands, reads HEAD and the tree state, writes the record.

## Preconditions
- The item exists and its directory (worktree, else the project root) exists.
- `harness.verify.stage` holds one or more argv lists.

## Trigger
The agent session runs `kf verify <f> --stage`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent session | Runs `kf verify <f> --stage` | kf resolves the item and its directory |
| 2 | kf CLI | Runs each pinned argv in order, without a shell, in that directory | Every command exits 0 |
| 3 | kf CLI | Reads HEAD (`git rev-parse HEAD`) and the tracked-tree state (`git status --porcelain --untracked-files=no`) | Full sha and `clean` flag known |
| 4 | kf CLI | Appends one JSON line to `loop/stage-verify.jsonl` under the item lock | The record holds `at`, `sha`, `clean`, `commands`, per-command `outcomes`, `outputSha256`, `exit: 0` |
| 5 | kf CLI | Prints the verdict and exits 0 | The output tail still goes to the terminal |

## Alternative Flows
### A1
- Trigger: a command fails (non-zero exit or signal), or the first command is not found.
| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | A command exits non-zero or dies by signal; later ones are skipped | Failing command: `exit N` or `signal <name>`; each later command: `not-run` |
| A1.2 | The first command cannot start (e.g. ENOENT) | First command: `not-started` (with `error`); every later command: `not-run` |
| A1.3 | kf appends the record as in main step 4 with `exit: 1` | Rejoins at step 5; kf prints the failure and exits 1 |

## Exception Flows
### E1
| Trigger | Handling | Resulting state / message |
|---|---|---|
| E1.1 Item directory (worktree) is missing | `verifyStage` returns before any command runs | Exit 3, no record, message names the missing directory |
| E1.2 `harness.verify.stage` absent or empty | No command runs | Exit 0, "No stage verify configured", no record |
| E1.3 The append fails (disk, permission) | Caught at the command boundary; the verdict of the commands that ran is kept | Same exit code as without the failure; stderr `warning: could not write the stage verify record: <cause>` |

## Postconditions
- A run that ran at least one command has added exactly one line to `loop/stage-verify.jsonl`; earlier lines are unchanged.
- A run that ran nothing (E1.1, E1.2) has added no line; `kf next` and loop-stats do not read the file as a task log.

## Business Rules
- The commands come from `.kf/config.json` only, never from an artifact; the record lists the full configured argv list.
- Append-only: the gate reads the latest line; old lines stay as history.
- Concurrent runs on one item must not interleave a line (append under `withLock`).
- The record stores a sha256 of the combined output, not the output.
- The overall `exit` is 0 only if every command exited 0, else 1.

## Data
- File: `<item>/loop/stage-verify.jsonl`, one JSON object per line ending in `\n`.
- `at`: ISO-8601 time of the run.
- `sha`: full 40-character HEAD sha of the item directory.
- `clean`: true when `git status --porcelain --untracked-files=no` is empty; untracked files do not make it false.
- `commands`: the configured argv list, order preserved (`string[][]`).
- `outcomes`: one entry per command, same order: exit code, signal name, `not-started` (with `error`), or `not-run`.
- `outputSha256`: sha256 hex (`node:crypto`) of the combined output of the commands that ran.
- `exit`: overall code, 0 or 1.

## Acceptance Criteria
- [ ] A passing run with two commands appends one parsable line with a 40-char `sha` equal to HEAD, `clean: true`, `commands` equal to the config, two `exit 0` outcomes, a 64-hex `outputSha256` and `exit: 0`.
- [ ] A run whose second command exits 1 appends one line with outcomes `[exit 0, exit 1, not run]` for three commands and `exit: 1`; the CLI exit code is 1.
- [ ] A run whose first command is not found appends one line with `not-started` (with `error`) first, `not-run` for the rest, `exit: 1`.
- [ ] A modified tracked file gives `clean: false`; only an untracked file gives `clean: true`.
- [ ] A missing item directory exits 3 and `loop/stage-verify.jsonl` is unchanged or absent.
- [ ] With no `harness.verify.stage` the run exits 0 and writes no line.
- [ ] Two runs append two lines; the first is byte-identical afterwards.
- [ ] When the append throws, the exit code equals the commands' verdict and stderr carries a warning.
- [ ] `readLoopInputs` ignores `loop/stage-verify.jsonl`; `runVerify` still returns `string | null` for its callers.

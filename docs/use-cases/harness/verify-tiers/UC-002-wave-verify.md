---
feature: verify-tiers
context: harness
created: 20261109_1701
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Verify a wave with the full suite |
| Requirement reference | FR-003, FR-004, FR-007 |
| Goal | Once every task of a wave is complete, the full `harness.verify.stage` suite runs once at the wave's HEAD in a clean detached worktree, leaves a stage record tagged with the wave, and its minutes are measurable |
| Primary actor | Agent session |

## Supporting Actors
- kf CLI (`kf next`, `kf record`, `kf verify`, `kf loop-stats`)

## Preconditions
- `harness.verify.stage` is pinned in `.kf/config.json`.
- Every task of wave `<w>` has a `complete` line in the ledger.
- No passing record in `<item>/loop/stage-verify.jsonl` (any wave tag, or a plain `--stage` record) contains every commit of a wave-`<w>` task and is newer than the latest failing record tagged `wave: <w>`.

## Trigger
`kf next` prints `verify wave <w>: kf verify <f> --wave <w>`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent session | Runs `kf record <f> wave-verify-started <w>` | Ledger gains `wave <w>: verify started` |
| 2 | Agent session | Runs `kf verify <f> --wave <w>` in the background | Run starts; session keeps dispatching test-writers of later waves |
| 3 | kf CLI | Creates a temporary detached worktree at the HEAD of the item directory (worktree, else project root), links the item's `node_modules` | Clean checkout without the next wave's failing tests |
| 4 | kf CLI | Runs each `harness.verify.stage` command without a shell | Output streams to the run |
| 5 | kf CLI | Appends a stage record to `<item>/loop/stage-verify.jsonl` (`sha` = HEAD, `clean: true`, `wave: <w>`) and the output to `<item>/loop/wave-<w>-verify.log` | Record and log written |
| 6 | kf CLI | Removes the worktree and exits 0 | No worktree left behind |
| 7 | Agent session | Runs `kf record <f> wave-verify-done <w> --exit 0` | Ledger gains `wave <w>: verify done exit=0`; `kf next` stops printing the wave verify |
| 8 | Agent session | Runs `kf loop-stats` | Reports `wave verify` (count, median, sum of minutes) |

## Alternative Flows
### A1
- Trigger: The item has no recorded worktree.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | kf resolves the item directory as `--stage` does and checks out the project root HEAD | Returns to main flow step 4 |

### A2
- Trigger: A `harness.verify.stage` command fails.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | kf records the failing run, writes the log, removes the worktree, exits 1 | Stage record carries the failing exit |
| A2.2 | Session records `wave-verify-done <w> --exit 1` | `kf next` prints the Wave verify decide (UC-004) |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `--wave` names a wave no task of the plan has, is not a positive integer, is combined with `--task`/`--stage`/`--base`/`--commits`, or the recorded worktree path is missing | Refuse before running anything | Exit 3; nothing run, no record, no log |
| No `harness.verify.stage` pinned | Say so | Exit 0; nothing written; `kf next` prints no wave verify and no hold |
| `kf record` is given a wave number or `--exit` value it cannot accept | Refuse | Nothing appended to the ledger |
| `kf loop-stats --record` meets `wave <w>: verify done exit=<n>` that `wave-<w>-verify.log` does not back within 15 minutes | Refuse the line | Line not recorded, as for task verify lines |
| Session compacted with `started` and no `done` line | `kf next --resume` lists the wave verify | Session re-runs it (main flow step 1 or 2) |

## Postconditions
- `<item>/loop/stage-verify.jsonl` holds a record with `wave: <w>`, the run's exit, `sha` = HEAD and `clean: true`; `<item>/loop/wave-<w>-verify.log` holds the output.
- The ledger holds `wave <w>: verify started` and `wave <w>: verify done exit=<n>`.
- No temporary worktree remains, on any exit path.
- A later commit of a wave-`<w>` task makes `kf next` owe the wave verify again.

## Business Rules
- Commands come from the human-pinned config and run without a shell; kf never writes `harness.verify`.
- The wave record is a #145 stage record plus the optional `wave` field; its format and the gate states are unchanged.
- Wave `<w>` is verified when there is a passing record (tagged `wave: <w>`, tagged another wave, or a plain `--stage` record) in `<item>/loop/stage-verify.jsonl` whose `sha` contains every commit of wave `<w>`'s tasks (`git merge-base --is-ancestor`) and that is newer than the latest failing record tagged `wave: <w>`.
- A wave whose tasks are all inline still gets one wave verify.

## Data
- Stage record: one line of `<item>/loop/stage-verify.jsonl` with `sha`, `clean`, exit and `wave`.
- Wave log: `<item>/loop/wave-<w>-verify.log`.
- Ledger lines: `wave <w>: verify started`, `wave <w>: verify done exit=<n>`.

## Acceptance Criteria
- [ ] `kf verify <f> --wave <w>` runs the stage commands in a detached worktree at HEAD, appends a stage record with `wave` and `clean: true`, writes `loop/wave-<w>-verify.log`, removes the worktree and exits 0 (TC-008)
- [ ] A failing stage command exits 1 with the failing exit recorded and the worktree removed (TC-008, TC-010)
- [ ] Bad input (unknown wave, non-integer, combined mode flag, missing recorded worktree) exits 3 and writes no record and no log; no `harness.verify.stage` exits 0 and writes nothing (TC-009)
- [ ] With no item worktree the run uses the project root HEAD (TC-010)
- [ ] The stage-record reader returns the latest record per wave and `kf next` uses it for the verified check, owing the verify again after a later wave-`<w>` commit (TC-011)
- [ ] `kf record` accepts `wave-verify-started <w>` and `wave-verify-done <w> --exit <n>`, writes the exact ledger lines, and refuses invalid input (TC-012)
- [ ] `kf next --resume` lists a wave verify with a `started` and no `done` line (TC-017)
- [ ] `kf loop-stats` reports `wave verify` (count, median, sum) and `--record` refuses an unbacked `wave <w>: verify done` line (TC-013)

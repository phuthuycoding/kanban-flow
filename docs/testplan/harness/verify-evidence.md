---
feature: verify-evidence
context: harness
created: 20261109_1326
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | verify-evidence |
| Context | harness |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`npm test`, `src/tests/*.test.ts`), real temporary git repositories |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 6 | 6 | Outcomes, record reader, metadata, validator, surface text |
| Integration | 17 | 17 | `cmdVerify` / `cmdStage` / `cmdStatus` on temp git repos |
| UI / E2E | 0 | 0 | No UI (Test Level unit+integration) |
| **Total** | **23** | **23** | |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001 | TC-001, TC-002, TC-003, TC-004, TC-021, TC-022, TC-023 | 7 | Every run that ran commands leaves one exact record; nothing else does |
| UC-002 | FR-002, FR-005 | TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-018, TC-020 | 10 | Moves only on a valid record, refuses each cause by code, force records a bypass |
| UC-003 | FR-003 | TC-013, TC-014, TC-015, TC-016 | 4 | Not-configured refusal, waiver write/refusals, waiver ignored once pinned |
| UC-004 | FR-004, FR-006 | TC-017, TC-019 | 2 | Status line and JSON per state; agent-facing text names record and waiver |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002, TC-003, TC-004, TC-021, TC-022, TC-023 | Yes | - |
| FR-002 | UC-002 | TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-020 | Yes | - |
| FR-003 | UC-003 | TC-013, TC-014, TC-015, TC-016 | Yes | - |
| FR-004 | UC-004 | TC-017 | Yes | - |
| FR-005 | UC-002 | TC-018 | Yes | - |
| FR-006 | UC-004 | TC-019 | Yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `runVerifySteps` with a temp dir |
| Input | [[node,-e,exit(0)]], [[node,-e,exit(2)],[node,-e,0]], [[no-such-cmd-xyz],[node,-e,0]], [[node,-e,process.kill(process.pid,'SIGTERM')]] |
| Steps | See steps table below |
| Expected outcome | Outcomes: `exit 0`; `exit 2` then `not-run`; `not-started` (error names the command) then `not-run`; `signal SIGTERM`. `runVerify` returns the same strings as before for each case |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: `runVerifySteps` with a temp dir | Setup holds |
| 2 | Run: [[node,-e,exit(0)]], [[node,-e,exit(2)],[node,-e,0]], [[no-such-cmd-xyz],[node,-e,0]], [[node,-e,process.kill(process.pid,'SIGTERM')]] | Outcomes: `exit 0`; `exit 2` then `not-run`; `not-started` (error names the command) then `not-run`; `signal SIGTERM`. `runVerify` returns the same strings as before for each case |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Temp git repo, committed tree, `harness.verify.stage` = two passing commands, item in testing without worktree |
| Input | `kf verify <f> --stage` |
| Steps | See steps table below |
| Expected outcome | Exit 0; `loop/stage-verify.jsonl` has exactly one new line whose JSON has `sha` = `git rev-parse HEAD`, `clean: true`, both argv lists in order with `exit 0`, a 64-hex `outputSha256`, `exit: 0`, an ISO `at` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Temp git repo, committed tree, `harness.verify.stage` = two passing commands, item in testing without worktree | Setup holds |
| 2 | Run: `kf verify <f> --stage` | Exit 0; `loop/stage-verify.jsonl` has exactly one new line whose JSON has `sha` = `git rev-parse HEAD`, `clean: true`, both argv lists in order with `exit 0`, a 64-hex `outputSha256`, `exit: 0`, an ISO `at` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | As TC-002 with the second command failing; separately a missing worktree path; separately no `harness.verify.stage` |
| Input | `kf verify <f> --stage` in each setup |
| Steps | See steps table below |
| Expected outcome | Failing: exit 1 and one new record with `exit: 1`. Missing worktree: exit 3 and no file/line written. No config: exit 0, prints `No stage verify configured`, no line written |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: As TC-002 with the second command failing; separately a missing worktree path; separately no `harness.verify.stage` | Setup holds |
| 2 | Run: `kf verify <f> --stage` in each setup | Failing: exit 1 and one new record with `exit: 1`. Missing worktree: exit 3 and no file/line written. No config: exit 0, prints `No stage verify configured`, no line written |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | As TC-002 |
| Input | Modify a tracked file then run; revert, add an untracked file then run |
| Steps | See steps table below |
| Expected outcome | First record `clean: false`; second record `clean: true` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: As TC-002 | Setup holds |
| 2 | Run: Modify a tracked file then run; revert, add an untracked file then run | First record `clean: false`; second record `clean: true` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Record files written by hand |
| Input | Absent file; empty file; last line `{bad`; earlier valid pass then invalid last line; valid last line |
| Steps | See steps table below |
| Expected outcome | `readLatestStageRecord` returns `none`, `none`, `invalid`, `invalid` (never the earlier pass), `record` with the last line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Record files written by hand | Setup holds |
| 2 | Run: Absent file; empty file; last line `{bad`; earlier valid pass then invalid last line; valid last line | `readLatestStageRecord` returns `none`, `none`, `invalid`, `invalid` (never the earlier pass), `record` with the last line |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item in testing with a PASS testing report whose Commands table has a row with exit `1`; stage command appends a byte to a marker file; one passing record at HEAD; an untracked file in the tree |
| Input | `kf stage <f> review` |
| Steps | See steps table below |
| Expected outcome | Exit 0, item in review; the marker file is unchanged (no command ran at the gate); neither the old table row nor the untracked file refuses the move |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item in testing with a PASS testing report whose Commands table has a row with exit `1`; stage command appends a byte to a marker file; one passing record at HEAD; an untracked file in the tree | Setup holds |
| 2 | Run: `kf stage <f> review` | Exit 0, item in review; the marker file is unchanged (no command ran at the gate); neither the old table row nor the untracked file refuses the move |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | As TC-006, then a new commit on the item branch |
| Input | `kf stage <f> review` |
| Steps | See steps table below |
| Expected outcome | Refused, code `verify_record_stale`; the message names the record sha, HEAD and `kf verify <f> --stage` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: As TC-006, then a new commit on the item branch | Setup holds |
| 2 | Run: `kf stage <f> review` | Refused, code `verify_record_stale`; the message names the record sha, HEAD and `kf verify <f> --stage` |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Two records at HEAD: pass then fail |
| Input | `kf stage <f> review` |
| Steps | See steps table below |
| Expected outcome | Refused, `verify_record_failed` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Two records at HEAD: pass then fail | Setup holds |
| 2 | Run: `kf stage <f> review` | Refused, `verify_record_failed` |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | (a) latest record has `clean: false`; (b) record clean but a tracked file modified now |
| Input | `kf stage <f> review` in each |
| Steps | See steps table below |
| Expected outcome | Both refused, `verify_tree_dirty`; message says whether the record or the tree now is dirty |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: (a) latest record has `clean: false`; (b) record clean but a tracked file modified now | Setup holds |
| 2 | Run: `kf stage <f> review` in each | Both refused, `verify_tree_dirty`; message says whether the record or the tree now is dirty |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Passing record at HEAD, then `harness.verify.stage` reordered; separately a command added; separately a command removed |
| Input | `kf stage <f> review` in each |
| Steps | See steps table below |
| Expected outcome | Both refused, `verify_config_changed` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Passing record at HEAD, then `harness.verify.stage` reordered; separately a command added; separately a command removed | Setup holds |
| 2 | Run: `kf stage <f> review` in each | Both refused, `verify_config_changed` |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | (a) no record file; (b) unparsable last line; (c) item worktree path deleted |
| Input | `kf stage <f> review` in each |
| Steps | See steps table below |
| Expected outcome | Refused with `verify_record_missing`, `verify_record_invalid`, `verify_dir_missing` respectively |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: (a) no record file; (b) unparsable last line; (c) item worktree path deleted | Setup holds |
| 2 | Run: `kf stage <f> review` in each | Refused with `verify_record_missing`, `verify_record_invalid`, `verify_dir_missing` respectively |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | As TC-011 (a) |
| Input | `kf stage <f> review --force`; separately on a stale record (TC-007 setup) |
| Steps | See steps table below |
| Expected outcome | Exit 0, item in review; `.kfw.json` `bypasses` has a `force` entry listing `verify_record_missing` (resp. `verify_record_stale`) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: As TC-011 (a) | Setup holds |
| 2 | Run: `kf stage <f> review --force` | Exit 0, item in review; `.kfw.json` `bypasses` has a `force` entry listing `verify_record_missing` (resp. `verify_record_stale`) |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | No `harness.verify.stage` (absent, and separately `[]`); PASS testing report |
| Input | `kf stage <f> review`; then `kf verify <f> --stage --waive "no suite yet"`; then `kf stage <f> review` |
| Steps | See steps table below |
| Expected outcome | First refused `verify_not_configured`, message names `harness.verify.stage` and `--waive`; waiver exit 0; second move exit 0. Same for `[]` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: No `harness.verify.stage` (absent, and separately `[]`); PASS testing report | Setup holds |
| 2 | Run: `kf stage <f> review`; then `kf verify <f> --stage --waive "no suite yet"`; then `kf stage <f> review` | First refused `verify_not_configured`, message names `harness.verify.stage` and `--waive`; waiver exit 0; second move exit 0. Same for `[]` |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item in testing |
| Input | `--waive "  "`; `--waive x` without `--stage`; `--waive x` with stage commands configured; `--waive a` then `--waive b` |
| Steps | See steps table below |
| Expected outcome | First three exit 3 and `.kfw.json` unchanged; last leaves `verifyWaiver.reason` = `b` with `at` ISO and `by` = configured reviewer |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item in testing | Setup holds |
| 2 | Run: `--waive "  "`; `--waive x` without `--stage`; `--waive x` with stage commands configured; `--waive a` then `--waive b` | First three exit 3 and `.kfw.json` unchanged; last leaves `verifyWaiver.reason` = `b` with `at` ISO and `by` = configured reviewer |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `.kfw.json` fixtures |
| Input | Valid `verifyWaiver`; `verifyWaiver: "x"`; `verifyWaiver: {reason: 1}` |
| Steps | See steps table below |
| Expected outcome | `readFeatureMeta` loads the first; throws `Invalid feature metadata` for the others |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: `.kfw.json` fixtures | Setup holds |
| 2 | Run: Valid `verifyWaiver`; `verifyWaiver: "x"`; `verifyWaiver: {reason: 1}` | `readFeatureMeta` loads the first; throws `Invalid feature metadata` for the others |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item with a waiver; then `harness.verify.stage` pinned, no record |
| Input | `kf stage <f> review` |
| Steps | See steps table below |
| Expected outcome | Refused, `verify_record_missing`; the waiver does not pass the gate |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item with a waiver; then `harness.verify.stage` pinned, no record | Setup holds |
| 2 | Run: `kf stage <f> review` | Refused, `verify_record_missing`; the waiver does not pass the gate |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item in testing with: a passing record at HEAD; a failing record at HEAD; a stale record; a waiver; nothing. Separately an item in planning and a done item |
| Input | `kf status --change <f>` and `--json` |
| Steps | See steps table below |
| Expected outcome | Text line `Stage verify: PASS <sha7> at HEAD, <age> ago` / `FAIL <sha7> at HEAD (exit 1)` / `stale (record <sha7>, HEAD <sha7>)` / `waived — <reason> (<by>, <date>)` / `none — run kf verify <f> --stage`; JSON `stageVerify.state` = `pass`/`fail`/`stale`/`waived`/`none` with `matchesHead`; the planning and done items print no line and `stageVerify: null` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item in testing with: a passing record at HEAD; a failing record at HEAD; a stale record; a waiver; nothing. Separately an item in planning and a done item | Setup holds |
| 2 | Run: `kf status --change <f>` and `--json` | Text line `Stage verify: PASS <sha7> at HEAD, <age> ago` / `FAIL <sha7> at HEAD (exit 1)` / `stale (record <sha7>, HEAD <sha7>)` / `waived — <reason> (<by>, <date>)` / `none — run kf verify <f> --stage`; JSON `stageVerify.state` = `pass`/`fail`/`stale`/`waived`/`none` with `matchesHead`; the planning and done items print no line and `stageVerify: null` |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-005 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item in testing with a PASS report whose Commands table has a row with exit `1`, and one with no table |
| Input | `validateFeature` |
| Steps | See steps table below |
| Expected outcome | No `testing_exit_code` finding; `commandExitCodes` no longer exported (`grep` finds no reference in `src/`) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item in testing with a PASS report whose Commands table has a row with exit `1`, and one with no table | Setup holds |
| 2 | Run: `validateFeature` | No `testing_exit_code` finding; `commandExitCodes` no longer exported (`grep` finds no reference in `src/`) |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-006 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository files |
| Input | Read skills/{implement,test,review,flow}/SKILL.md, the review report template, `kf verify -h`, `kf stage -h` |
| Steps | See steps table below |
| Expected outcome | Each skill names the stage record as the gate; implement and flow name `--waive` and that it is used only on the human's word; review names the `Stage verify` line; the template's Delivery table has a `verify` row; both help texts name the record/waiver |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Repository files | Setup holds |
| 2 | Run: Read skills/{implement,test,review,flow}/SKILL.md, the review report template, `kf verify -h`, `kf stage -h` | Each skill names the stage record as the gate; implement and flow name `--waive` and that it is used only on the human's word; review names the `Stage verify` line; the template's Delivery table has a `verify` row; both help texts name the record/waiver |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Bug item, `worktree.enabled` false, passing record at the project root's HEAD |
| Input | `kf stage <f> review` |
| Steps | See steps table below |
| Expected outcome | Exit 0; the record's `sha` equals the project root HEAD |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Bug item, `worktree.enabled` false, passing record at the project root's HEAD | Setup holds |
| 2 | Run: `kf stage <f> review` | Exit 0; the record's `sha` equals the project root HEAD |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Low |
| Preconditions | Item `loop/` with `progress.md`, a task verify log and `stage-verify.jsonl` |
| Input | `readLoopInputs` and `kf loop-stats` |
| Steps | See steps table below |
| Expected outcome | The stage file is not read as a task log; results equal those without the file |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item `loop/` with `progress.md`, a task verify log and `stage-verify.jsonl` | Setup holds |
| 2 | Run: `readLoopInputs` and `kf loop-stats` | The stage file is not read as a task log; results equal those without the file |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | As TC-002 with `loop/` made unwritable (a file named `loop` in the item folder) |
| Input | `kf verify <f> --stage` with passing commands, then with a failing command |
| Steps | See steps table below |
| Expected outcome | Exit 0 and exit 1 respectively (the commands' verdict), stderr carries `could not write the stage verify record`, no record exists |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: As TC-002 with `loop/` made unwritable (a file named `loop` in the item folder) | Setup holds |
| 2 | Run: `kf verify <f> --stage` with passing commands, then with a failing command | Exit 0 and exit 1 respectively (the commands' verdict), stderr carries `could not write the stage verify record`, no record exists |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | As TC-002 |
| Input | `kf verify <f> --stage` twice |
| Steps | See steps table below |
| Expected outcome | Two lines; the first line is byte-identical after the second run; `readLatestStageRecord` returns the second |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: As TC-002 | Setup holds |
| 2 | Run: `kf verify <f> --stage` twice | Two lines; the first line is byte-identical after the second run; `readLatestStageRecord` returns the second |

---
feature: verify-tiers
context: harness
created: 20261109_1700
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | verify-tiers |
| Context | harness |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`npm test`), real temporary git repositories, ledger fixtures under src/tests/fixtures/kf-next/waves |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 7 | 7 | config, ledger grammar, record reader, liveness exploration, config pin, surfaces |
| Integration | 17 | 17 | kf verify --task/--wave, kf next fixtures, kf loop-stats, kf stage |
| UI / E2E | 0 | 0 | CLI only |
| **Total** | **24** | **24** | |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007 | 7 | every listed case passes |
| UC-002 | FR-003, FR-004, FR-007 | TC-008, TC-009, TC-010, TC-011, TC-012, TC-013 | 6 | every listed case passes |
| UC-003 | FR-004 | TC-014, TC-015, TC-016, TC-017, TC-018 | 5 | every listed case passes |
| UC-004 | FR-005 | TC-019, TC-020 | 2 | every listed case passes |
| UC-005 | FR-006, FR-008, FR-009 | TC-021, TC-022, TC-023, TC-024 | 4 | every listed case passes |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001 | Yes | - |
| FR-002 | UC-001 | TC-002, TC-003, TC-004, TC-005, TC-006, TC-007 | Yes | - |
| FR-003 | UC-002 | TC-008, TC-009, TC-010, TC-011 | Yes | - |
| FR-004 | UC-002, UC-003 | TC-012, TC-014, TC-015, TC-016, TC-017, TC-018 | Yes | - |
| FR-005 | UC-004 | TC-019, TC-020 | Yes | - |
| FR-006 | UC-005 | TC-021 | Yes | - |
| FR-007 | UC-002 | TC-013 | Yes | - |
| FR-008 | UC-005 | TC-022 | Yes | - |
| FR-009 | UC-005 | TC-023, TC-024 | Yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | validateHarness with harness.verify.related |
| Input | valid ["npx","vitest","related","--run"]; [], "x", [["a"]], [""], ["-x"], `["a","{f}"]` |
| Steps | See steps table below |
| Expected outcome | valid loads; each other shape throws an error naming harness.verify.related |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: validateHarness with harness.verify.related | Setup holds |
| 2 | Run: valid ["npx","vitest","related","--run"]; [], "x", [["a"]], [""], ["-x"], `["a","{f}"]` | valid loads; each other shape throws an error naming harness.verify.related |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | temp repo, item with a worktree, task with Files, harness.verify.task = [[node,-e,log t]], related = [node, <script that prints its argv>]; a commit changing b.ts and a.ts |
| Input | kf verify <f> --task TASK-001 --commits <sha> |
| Steps | See steps table below |
| Expected outcome | exit 0; the task log shows the task command, then the related argv with `a.ts b.ts` appended in that order (sorted, repo-relative) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: temp repo, item with a worktree, task with Files, harness.verify.task = [[node,-e,log t]], related = [node, <script that prints its argv>]; a commit changing b.ts and a.ts | Setup holds |
| 2 | Run: kf verify <f> --task TASK-001 --commits <sha> | exit 0; the task log shows the task command, then the related argv with `a.ts b.ts` appended in that order (sorted, repo-relative) |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | as TC-002 |
| Input | kf verify <f> --task TASK-001 --base <sha before> |
| Steps | See steps table below |
| Expected outcome | exit 0; related ran with the same sorted files |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-002 | Setup holds |
| 2 | Run: kf verify <f> --task TASK-001 --base <sha before> | exit 0; related ran with the same sorted files |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | as TC-002; commit A deletes x.ts only; commit B renames old.ts to new.ts |
| Input | --commits A; then --commits B |
| Steps | See steps table below |
| Expected outcome | A: no related command, output says the task changed no file that exists; exit 0. B: related receives new.ts, not old.ts |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-002; commit A deletes x.ts only; commit B renames old.ts to new.ts | Setup holds |
| 2 | Run: --commits A; then --commits B | A: no related command, output says the task changed no file that exists; exit 0. B: related receives new.ts, not old.ts |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | as TC-002 without harness.verify.related |
| Input | kf verify <f> --task TASK-001 --commits <sha> |
| Steps | See steps table below |
| Expected outcome | only the task commands run; output equals the run before this change |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-002 without harness.verify.related | Setup holds |
| 2 | Run: kf verify <f> --task TASK-001 --commits <sha> | only the task commands run; output equals the run before this change |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | as TC-002 with a related command that exits 1; separately a commit touching a file outside Files |
| Input | kf verify --task … in each |
| Steps | See steps table below |
| Expected outcome | related failure → exit 1 naming the related argv; outside Files → exit 2 as today and no command runs |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-002 with a related command that exits 1; separately a commit touching a file outside Files | Setup holds |
| 2 | Run: kf verify --task … in each | related failure → exit 1 naming the related argv; outside Files → exit 2 as today and no command runs |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | bug item, tasks.md with TASK-001, related set, a commit changing c.ts |
| Input | kf verify <f> --task TASK-001 --commits <sha> |
| Steps | See steps table below |
| Expected outcome | related receives c.ts; no Files check |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: bug item, tasks.md with TASK-001, related set, a commit changing c.ts | Setup holds |
| 2 | Run: kf verify <f> --task TASK-001 --commits <sha> | related receives c.ts; no Files check |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | item with a worktree; plan with waves 1 and 2; stage = [[node,-e,log]]; an uncommitted failing test file in the item worktree |
| Input | kf verify <f> --wave 1; then with a failing stage command |
| Steps | See steps table below |
| Expected outcome | pass: exit 0, a stage-verify.jsonl line with wave 1, clean true, sha = worktree HEAD, loop/wave-1-verify.log with a `## kf verify <ISO> exit=0` header, temp worktree removed, the uncommitted file not seen; fail: exit 1 and a record with exit 1 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: item with a worktree; plan with waves 1 and 2; stage = [[node,-e,log]]; an uncommitted failing test file in the item worktree | Setup holds |
| 2 | Run: kf verify <f> --wave 1; then with a failing stage command | pass: exit 0, a stage-verify.jsonl line with wave 1, clean true, sha = worktree HEAD, loop/wave-1-verify.log with a `## kf verify <ISO> exit=0` header, temp worktree removed, the uncommitted file not seen; fail: exit 1 and a record with exit 1 |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | as TC-008 |
| Input | --wave 9; --wave x; --wave 1 --task TASK-001; --wave 1 --stage; --wave 1 --base <sha>; --wave 1 --commits <sha>; worktree path deleted; separately no harness.verify.stage; separately a bug item with --wave 1 and --wave 2 |
| Steps | See steps table below |
| Expected outcome | exit 3 with nothing run or written for the first seven; no stage config → exit 0, says so, nothing written; bug item: --wave 1 runs, --wave 2 exits 3 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-008 | Setup holds |
| 2 | Run: --wave 9; --wave x; --wave 1 --task TASK-001; --wave 1 --stage; --wave 1 --base <sha>; --wave 1 --commits <sha>; worktree path deleted; separately no harness.verify.stage; separately a bug item with --wave 1 and --wave 2 | exit 3 with nothing run or written for the first seven; no stage config → exit 0, says so, nothing written; bug item: --wave 1 runs, --wave 2 exits 3 |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | item without a worktree (worktree.enabled false), stage pinned |
| Input | kf verify <f> --wave 1 |
| Steps | See steps table below |
| Expected outcome | exit 0; record sha = project root HEAD |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: item without a worktree (worktree.enabled false), stage pinned | Setup holds |
| 2 | Run: kf verify <f> --wave 1 | exit 0; record sha = project root HEAD |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | stage-verify.jsonl with a --stage record, a wave-1 record, a wave-2 record |
| Input | readStageRecords; readLatestStageRecord; evaluateStageEvidence |
| Steps | See steps table below |
| Expected outcome | all three in order with their wave; latest = the wave-2 record; the gate evaluates it like any record |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: stage-verify.jsonl with a --stage record, a wave-1 record, a wave-2 record | Setup holds |
| 2 | Run: readStageRecords; readLatestStageRecord; evaluateStageEvidence | all three in order with their wave; latest = the wave-2 record; the gate evaluates it like any record |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | ledger text with `wave 1: verify started`, `wave 1: verify done exit=0`, `Note TASK-002: reopened — wave 1`, `Note wave 1: decided — flaky` |
| Input | readLedgerState; kf record wave-verify-started 1, wave-verify-done 1 --exit 0, a second start while one is open (accepted, supersedes), a done with no start, wave-verify-started x, `line -- "wave 1: verify done exit=0"` |
| Steps | See steps table below |
| Expected outcome | typed events (none of type other), the ledger is not refused; record writes the shapes; the second start is written; the last three calls are refused with the file unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: ledger text with `wave 1: verify started`, `wave 1: verify done exit=0`, `Note TASK-002: reopened — wave 1`, `Note wave 1: decided — flaky` | Setup holds |
| 2 | Run: readLedgerState; kf record wave-verify-started 1, wave-verify-done 1 --exit 0, a second start while one is open (accepted, supersedes), a done with no start, wave-verify-started x, `line -- "wave 1: verify done exit=0"` | typed events (none of type other), the ledger is not refused; record writes the shapes; the second start is written; the last three calls are refused with the file unchanged |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-007 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | ledger with two wave verify pairs and their wave logs; another ledger whose wave done line has no log run |
| Input | kf loop-stats <f> --json; kf loop-stats <f> --record |
| Steps | See steps table below |
| Expected outcome | wave verify count 2 with minutes; task verify column unchanged; --record refuses the unbacked line |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: ledger with two wave verify pairs and their wave logs; another ledger whose wave done line has no log run | Setup holds |
| 2 | Run: kf loop-stats <f> --json; kf loop-stats <f> --record | wave verify count 2 with minutes; task verify column unchanged; --record refuses the unbacked line |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | fixture: plan waves 1 (TASK-001, TASK-002) and 2 (TASK-003), stageCommands pinned, both wave-1 tasks complete, TASK-003 test hashes written |
| Input | kf next |
| Steps | See steps table below |
| Expected outcome | prints `verify wave 1: kf verify <f> --wave 1` and `wait TASK-003: wave 1 verify`; a wave-2 test-writer is still dispatched when owed |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: fixture: plan waves 1 (TASK-001, TASK-002) and 2 (TASK-003), stageCommands pinned, both wave-1 tasks complete, TASK-003 test hashes written | Setup holds |
| 2 | Run: kf next | prints `verify wave 1: kf verify <f> --wave 1` and `wait TASK-003: wave 1 verify`; a wave-2 test-writer is still dispatched when owed |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | as TC-014 plus a passing wave-1 record whose sha contains both wave-1 commits; then a later fix commit on TASK-001 named in the ledger |
| Input | kf next before and after the fix commit |
| Steps | See steps table below |
| Expected outcome | before: TASK-003 developer dispatched; after: the wave-1 verify is owed again and new wave-2 developer dispatches wait, in-flight ones stay |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-014 plus a passing wave-1 record whose sha contains both wave-1 commits; then a later fix commit on TASK-001 named in the ledger | Setup holds |
| 2 | Run: kf next before and after the fix commit | before: TASK-003 developer dispatched; after: the wave-1 verify is owed again and new wave-2 developer dispatches wait, in-flight ones stay |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | every existing fixture under src/tests/fixtures/kf-next and the explorer plans (stageCommands empty) |
| Input | kf next / the explorer |
| Steps | See steps table below |
| Expected outcome | outputs identical to their expected.json; no wave action, no wave wait |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: every existing fixture under src/tests/fixtures/kf-next and the explorer plans (stageCommands empty) | Setup holds |
| 2 | Run: kf next / the explorer | outputs identical to their expected.json; no wave action, no wave wait |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | as TC-014 with `wave 1: verify started` and no done line |
| Input | kf next --resume |
| Steps | See steps table below |
| Expected outcome | lists the wave-1 verify for a re-run |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-014 with `wave 1: verify started` and no done line | Setup holds |
| 2 | Run: kf next --resume | lists the wave-1 verify for a re-run |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | explorer plan with two waves and stageCommands pinned |
| Input | bounded exploration |
| Steps | See steps table below |
| Expected outcome | no state where a task waiting on a wave lacks a witness; no `no rule` stop |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: explorer plan with two waves and stageCommands pinned | Setup holds |
| 2 | Run: bounded exploration | no state where a task waiting on a wave lacks a witness; no `no rule` stop |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | as TC-014 with `wave 1: verify done exit=1` |
| Input | kf next; then record `Note TASK-002: reopened — wave 1`; then TASK-002 fix round, review, new complete |
| Steps | See steps table below |
| Expected outcome | decide (Wave verify) printed and wave-2 developers held; after the reopen TASK-002 owes a developer round; after its new complete the wave-1 verify is owed again |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-014 with `wave 1: verify done exit=1` | Setup holds |
| 2 | Run: kf next; then record `Note TASK-002: reopened — wave 1`; then TASK-002 fix round, review, new complete | decide (Wave verify) printed and wave-2 developers held; after the reopen TASK-002 owes a developer round; after its new complete the wave-1 verify is owed again |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | as TC-019; separately a wave verify done exit=3 |
| Input | record `Note wave 1: decided — flaky`; for exit 3 record a new `wave 1: verify started` |
| Steps | See steps table below |
| Expected outcome | decided note closes the decide and owes a new wave verify; exit 3 decide closes on the new start |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: as TC-019; separately a wave verify done exit=3 | Setup holds |
| 2 | Run: record `Note wave 1: decided — flaky`; for exit 3 record a new `wave 1: verify started` | decided note closes the decide and owes a new wave verify; exit 3 decide closes on the new start |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-006 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | item in testing, stage pinned with a marker-writing command, last record = passing wave record at HEAD, clean tree |
| Input | kf stage <f> review |
| Steps | See steps table below |
| Expected outcome | exit 0, moved; the marker file unchanged (no run) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: item in testing, stage pinned with a marker-writing command, last record = passing wave record at HEAD, clean tree | Setup holds |
| 2 | Run: kf stage <f> review | exit 0, moved; the marker file unchanged (no run) |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-008 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | this repository's .kf/config.json; `relatedArgv` from src/workflow/verify.ts |
| Input | read config; relatedArgv(config.harness.verify.related, ["src/a.ts"]) |
| Steps | See steps table below |
| Expected outcome | task = [[npm,run,typecheck]], related = [npx,vitest,related,--run], stage = [[npm,run,build],[npm,test]]; relatedArgv returns ["npx","vitest","related","--run","src/a.ts"] |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: this repository's .kf/config.json; a temp item of this shape | Setup holds |
| 2 | Run: read config; kf verify --task on a task changing a src file | task = [[npm,run,typecheck]], related = [npx,vitest,related,--run], stage = [[npm,run,build],[npm,test]]; relatedArgv returns ["npx","vitest","related","--run","src/a.ts"] |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-009 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | skills/implement/SKILL.md, references/task-loop.md, skills/test/SKILL.md, skills/flow/SKILL.md, kf verify -h, kf record -h |
| Input | read |
| Steps | See steps table below |
| Expected outcome | each names the tiers: harness.verify.related, `kf verify <f> --wave <w>`, the wave ledger lines, the Wave verify decide, and the rule to run `kf verify <f> --stage` only when kf status does not show PASS at HEAD; the #145 pinned sentences remain |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: skills/implement/SKILL.md, references/task-loop.md, skills/test/SKILL.md, skills/flow/SKILL.md, README.md, docs/workflow/harness.md, CHANGELOG.md, kf verify -h, kf record -h | Setup holds |
| 2 | Run: read | each names the tiers: harness.verify.related, `kf verify <f> --wave <w>`, the wave ledger lines, the Wave verify decide, and the rule to run `kf verify <f> --stage` only when kf status does not show PASS at HEAD; the #145 pinned sentences remain |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-009 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | README.md, .github/pages/index.html, docs/workflow/harness.md, docs/workflow/cli-reference.md, CHANGELOG.md |
| Input | read |
| Steps | See steps table below |
| Expected outcome | each names harness.verify.related, `kf verify <f> --wave <w>`, the next wave waiting for the wave suite, and the gate reusing the last wave's record; CHANGELOG has an Unreleased entry |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: README.md, .github/pages/index.html, docs/workflow/harness.md, docs/workflow/cli-reference.md, CHANGELOG.md | Setup holds |
| 2 | Run: read | each names harness.verify.related, `kf verify <f> --wave <w>`, the next wave waiting for the wave suite, and the gate reusing the last wave's record; CHANGELOG has an Unreleased entry |

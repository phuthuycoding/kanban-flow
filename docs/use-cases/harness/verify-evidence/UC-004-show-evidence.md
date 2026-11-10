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
| ID | UC-004 |
| Name | See the record or waiver in status and review |
| Requirement reference | FR-004, FR-006 |
| Goal | Anyone looking at the item (`kf status` text and `--json`, the review pack, the review report) sees the latest stage record or the waiver, so review never takes the evidence on trust. |
| Primary actor | Reviewer (kf:code-reviewer via kf:review) |

## Supporting Actors
- Agent session: runs `kf verify <f> --stage` at the final HEAD and reads `kf status`.
- Human: reads the pack and report; the only source of a waiver.

## Preconditions
- The item is in implementation, testing or review.
- `evaluateStageEvidence` (TASK-003) is available to status.

## Trigger
The reviewer, agent session or human runs `kf status --change <f>` (text or `--json`), or kf:review assembles the review pack.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Reviewer | Runs `kf status --change <f>` | Status evaluates the stage evidence for the item |
| 2 | kf CLI | Prints, after the Bypasses line, `Stage verify: PASS <sha7> at HEAD, <age> ago` | The latest record passed and its sha equals HEAD |
| 3 | kf CLI | With `--json`, adds `stageVerify {state, sha, head, matchesHead, at, exit, reason, by}` | Same facts, machine readable; `matchesHead` is true |
| 4 | kf:review | Copies the `Stage verify:` line into the review pack | The code-reviewer sees the evidence without re-running it |
| 5 | kf:review | Fills the `verify` row of the review report `## Delivery` table with the same line | The report carries the record or waiver |

## Alternative Flows
### A1 FAIL
- Trigger: the latest record has a non-zero `exit`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Status prints `Stage verify: FAIL <sha7> ...`; JSON `state` is `fail`, `exit` non-zero | Review shows the failure; no main-flow step 4 PASS claim is possible |

### A2 Stale
- Trigger: the latest record's sha differs from HEAD.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Status prints `Stage verify: stale (record <sha7>, HEAD <sha7>)`; JSON `matchesHead: false`, both `sha` and `head` set | Returns to step 4 with the stale line shown as is |

### A3 Waived
- Trigger: the item metadata holds a waiver.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Status prints `Stage verify: waived — <reason> (<by>, <date>)`; JSON `state: "waived"` with `reason`, `by`, `at` | Returns to step 4; the report `verify` row names the waiver |

### A4 None
- Trigger: no record and no waiver exist.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | Status prints `Stage verify: none — run kf verify <f> --stage`; JSON `state: "none"`, `sha` null | Returns to step 4; the reviewer sees the gap and the command to close it |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The item is outside implementation, testing and review (planning, backlog, done, cancelled, ...) | Status skips the evaluation | No `Stage verify:` line; JSON `stageVerify: null` |

## Postconditions
- Status prints exactly one `Stage verify:` line, or none for an out-of-scope stage.
- The review pack and report carry the same line the status printed.
- Status wrote nothing: no record, no metadata change.

## Business Rules
- The line and JSON come from `evaluateStageEvidence`; status adds no second reading of the record.
- Other states (dirty-at-record, config-changed, invalid, not-configured) render one line each and one JSON object.
- Skills say the record is the gate into review and exit codes are never hand-copied as proof (FR-006).

## Data
- Stage record (`loop/stage-verify.jsonl`, latest line): `at`, `sha`, `exit`, `clean`.
- Waiver (item metadata): `reason`, `by`, `at`.
- `stageVerify` JSON: `{state, sha, head, matchesHead, at, exit, reason, by}` or `null`.

## Acceptance Criteria
- [ ] Item in testing with a passing record at HEAD: text has `Stage verify: PASS <sha7> at HEAD, <age> ago`; JSON has `state: "pass"`, `matchesHead: true`, `exit: 0`.
- [ ] A failing record renders `FAIL` and JSON `state: "fail"`.
- [ ] A record for an older commit renders `stale (record <sha7>, HEAD <sha7>)` and `matchesHead: false`.
- [ ] A waiver renders `waived — <reason> (<by>, <date>)` and JSON carries `reason` and `by`.
- [ ] No record and no waiver renders `none — run kf verify <f> --stage`.
- [ ] An item in planning or done prints no `Stage verify:` line and JSON `stageVerify` is `null`.
- [ ] `skills/review` tells kf:review to copy the line into the pack, and the review report template has a `verify` row in `## Delivery`.
- [ ] `skills/implement`, `skills/test`, `skills/flow` state that `kf verify <f> --stage` at the final HEAD is the gate and exit codes are never hand-copied as proof (pinned by `verify-evidence-surface.test.ts`).

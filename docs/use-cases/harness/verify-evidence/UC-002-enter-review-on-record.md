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
| ID | UC-002 |
| Name | Enter review on a passing record at HEAD |
| Requirement reference | FR-002, FR-005 |
| Goal | `kf stage <f> review` from testing moves the item only on a passing stage record taken at the item's current HEAD on a clean tracked tree with the commands now pinned in `harness.verify.stage`, reading the record without running any command; the Markdown exit-code table no longer gates. |
| Primary actor | Agent session |

## Supporting Actors
- kf CLI: evaluates the latest record (`evaluateStageEvidence`) and enforces the gate in `runTransition`.
- Human (project owner): pinned `harness.verify.stage`; the only one who may approve `--force`.
- git: answers `git rev-parse HEAD` and `git status --porcelain --untracked-files=no` in the item directory.

## Preconditions
- The item is in testing, a feature or a bug, and `harness.verify.stage` lists at least one argv.
- `kf verify <f> --stage` ran commands at least once (UC-001), so `<item>/loop/stage-verify.jsonl` may hold records.

## Trigger
The agent session runs `kf stage <f> review` after the testing report is PASS.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent session | Runs `kf stage <f> review` | The transition testing to review is requested |
| 2 | kf CLI | Checks the testing report status (existing `testing_not_pass`) | PASS is accepted; the Commands table rows are not inspected |
| 3 | kf CLI | Resolves the item directory (worktree, else project root) and reads HEAD and the tracked-tree state | HEAD sha and clean-now flag known |
| 4 | kf CLI | Reads the latest record only | It parses, has overall exit 0, names HEAD, was taken clean |
| 5 | kf CLI | Compares the record's argv lists with `harness.verify.stage`, in order | Identical lists |
| 6 | kf CLI | Moves the item to review | No verify command ran; no finding; no bypass recorded |

## Alternative Flows
### A1
- Trigger: Step 4 or 5 fails and the human explicitly told the agent to use `--force`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf stage <f> review --force` evaluates the same evidence | Every failing finding code (below) becomes a forced code |
| A1.2 | The transition proceeds and `recordBypasses` writes a `force` bypass with those codes | The item moves to review; returns to Main Flow step 6 |

## Exception Flows
Every refusal exits non-zero, leaves the item in testing, is an ERROR finding whose message names the cause, and prints `kf verify <f> --stage`.

### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| No record exists (file missing or empty) | Refuse | `verify_record_missing`: no stage record; run `kf verify <f> --stage` |
| Latest record has overall exit 1, even if an earlier line passed at HEAD | Refuse; never fall back to an earlier line | `verify_record_failed`: latest stage verify failed; run `kf verify <f> --stage` |
| Record sha differs from current HEAD (new commit, amend, rebase) | Refuse | `verify_record_stale`: record `<sha7>`, HEAD `<sha7>`; run `kf verify <f> --stage` |
| Record was taken on a dirty tracked tree, or the tracked tree is dirty now | Refuse; untracked files do not count | `verify_tree_dirty`: names whether at record time or now; run `kf verify <f> --stage` |
| Argv lists in the record differ from `harness.verify.stage`, including a reorder | Refuse | `verify_config_changed`: pinned commands differ from the record; run `kf verify <f> --stage` |
| Latest line is unparsable, truncated or torn | Refuse; an unparsable line never counts as a pass | `verify_record_invalid`: latest record cannot be read; run `kf verify <f> --stage` |
| The item directory (deleted worktree) does not exist | Refuse; HEAD cannot be read | `verify_dir_missing`: names the missing directory; run `kf verify <f> --stage` |

## Postconditions
- On the main flow the item is in review, no command ran, and `.kfw.json` gains no bypass for this gate.
- On a refusal the item stays in testing and no file changed.
- On A1 the item is in review and the bypass lists the finding codes forced.

## Business Rules
- Only the latest appended record counts; an earlier pass never rescues a later failure or an unparsable line.
- An item with no worktree (`worktree.enabled` false) uses the project root's HEAD for the record and the gate.
- A PASS testing report is not refused for its `## Commands and Evidence` table; `testing_exit_code` and `commandExitCodes` are removed, and the table stays descriptive.
- The gate runs only for testing to review, and only reads one file plus `git rev-parse HEAD` and `git status --porcelain --untracked-files=no`.
- When `harness.verify.stage` is absent or empty, UC-003 applies, not this flow.

## Data
- Stage record: latest line of `<item>/loop/stage-verify.jsonl` (sha, clean flag, argv list, outcomes, overall exit).
- `harness.verify.stage`: the human-pinned argv lists in `.kf/config.json`; read, never written.
- Bypass entry: `meta.bypasses` in `.kfw.json`, flag `force`, finding codes de-duplicated.

## Acceptance Criteria
- [ ] With a passing record at HEAD, a clean tracked tree and unchanged config, `kf stage <f> review` exits 0, the item is in review, and no verify command ran (a pinned command that would leave a marker file leaves none).
- [ ] After a new commit following the record, `kf stage <f> review` refuses with `verify_record_stale` and prints `kf verify <f> --stage`.
- [ ] With a latest record of exit 1 and an earlier passing line at HEAD, it refuses with `verify_record_failed`.
- [ ] A record taken on a dirty tracked tree, and a tracked file modified after a clean record, each refuse with `verify_tree_dirty`; an untracked file alone does not refuse.
- [ ] Changing `harness.verify.stage` by adding, removing or reordering an argv refuses with `verify_config_changed`.
- [ ] No record, an unparsable latest line, and a deleted item directory refuse with `verify_record_missing`, `verify_record_invalid` and `verify_dir_missing`; each message names the cause.
- [ ] `--force` on each refusal moves the item and records a `force` bypass holding that finding code.
- [ ] A PASS testing report whose Commands table has a non-zero or missing exit code is not refused by `kf validate` or `kf stage`, and `src/` no longer references `commandExitCodes` or `testing_exit_code`.
- [ ] An item with no worktree and a record at the project root's HEAD moves; a bug item behaves the same.

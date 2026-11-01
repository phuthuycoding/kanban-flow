---
feature: drive-retire
context: harness
created: 20261101_1211
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Clean leftover drive config and state with kf doctor |
| Requirement reference | FR-005, FR-006, FR-010 |
| Goal | After upgrading, a project that still has removed harness keys in `.kf/config.json` and run/drive meta in work items keeps working. `kf doctor` reports each leftover, `kf doctor --fix` removes them and keeps everything else, and the docs describe only the in-session path. |
| Primary actor | Human operator |

## Supporting Actors
- kf CLI (`kf doctor`, `kf doctor --fix`, and every other command that reads the config or a work item)
- Project files: `.kf/config.json` and each work item's `.kfw.json`

## Preconditions
- kanban-flow was upgraded to the version without `kf drive`, `kf run`, `kf runs` and `kf harness`.
- The project's `.kf/config.json` may still hold any of `harness.main`, `harness.roles`, `harness.stages`, `harness.runners`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget`, alongside kept keys such as `harness.verify.task` and `harness.verify.stage`.
- One or more work items may still have `drive`, `runs`, `sessions` or `tasks` in their `.kfw.json`.

## Trigger
The human operator runs `kf doctor` after upgrading (or notices a doctor warning during routine use).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Human operator | Runs any kf command in the upgraded project. | The config loads even though it still has removed keys. The removed keys are ignored. No command fails with "Invalid project config". |
| 2 | Human operator | Runs `kf doctor`. | Doctor prints one `harness_legacy_key` warning for each removed `harness.*` key present, each with the remedy `kf doctor --fix`. |
| 3 | kf CLI | Scans every work item's `.kfw.json`. | Doctor prints one `meta_legacy_run_state` warning per item that has `drive`, `runs`, `sessions` or `tasks`, with the remedy `kf doctor --fix`. |
| 4 | Human operator | Runs `kf doctor --fix`. | The removed `harness.*` keys are deleted from `.kf/config.json`. Every other key keeps its value as JSON. |
| 5 | kf CLI | Strips `drive`, `runs`, `sessions` and `tasks` from each affected `.kfw.json`. | Every other field of the item meta is unchanged. |
| 6 | Human operator | Runs `kf doctor` again. | No legacy warning remains. `harness.verify` is still configured and `kf verify` still uses it. |
| 7 | Human operator | Reads README, Pages site and `docs/workflow/*`. | They describe only the in-session path. The removed commands appear only as removal notes, in CHANGELOG history or in archived snapshots (FR-010). |

## Alternative Flows
### A1
- Trigger: A legacy key has the wrong type, for example `harness.roles: "x"` or `harness.budget: []`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Any kf command loads the config. | The config still loads. The legacy value is not validated and never produces "Invalid project config". |
| A1.2 | `kf doctor` runs. | It warns about that key like any other legacy key. Return to main flow step 4. |
| A1.3 | `kf doctor --fix` runs. | The wrongly typed key is removed together with the other legacy keys. |

### A2
- Trigger: The operator runs `kf init` (or bootstrap) before `kf doctor --fix`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf init` runs on a config holding legacy keys. | It does not seed a harness block. It writes the existing config back with the legacy keys still in place. |
| A2.2 | The operator runs `kf doctor`. | The warnings are still reported. Return to main flow step 4. Only `kf doctor --fix` removes them. |

### A3
- Trigger: The config has only `harness.verify` and no legacy keys, and no work item has leftover meta.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | `kf doctor` runs. | No legacy warning is printed. |
| A3.2 | `kf doctor --fix` runs. | It changes nothing in the config or the items. The use case ends. |

### A4
- Trigger: A work item's `.kfw.json` still has a drive block or run records and the operator runs another command first.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A4.1 | The operator runs `kf archive`, `kf status`, `kf approve` or any other command on that item. | The command acts normally. No `run-in-progress` or drive-live guard exists, so nothing refuses because of the leftover record. |
| A4.2 | The command writes the item meta. | The leftover keys pass through the write untouched. Return to main flow step 3; only `kf doctor --fix` removes them. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A leftover `drive.supervisorPid` or a `runs[].pid` looks live (the process still exists). | Doctor includes the pid in the `meta_legacy_run_state` warning for that item and says "stop this process yourself". kf never signals or kills the process, and `--fix` only strips the meta. | The operator stops the process manually. The item's meta is cleaned on the next `kf doctor --fix`. Closing the item before the process is stopped can tear down its worktree under it, so the operator stops the process first. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| A `.kfw.json` or `.kf/config.json` cannot be parsed or written during `--fix`. | Doctor reports the file and the error with its cause, does not rewrite that file partially, and does not hide the failure. It does not stop the other files from being checked. | The unfixable file is named in the output and left unchanged. The operator repairs it and re-runs `kf doctor --fix`. |

## Postconditions
- `.kf/config.json` has none of the eight removed `harness.*` keys. Every other key, including `harness.verify.task` and `harness.verify.stage`, keeps its value.
- No work item `.kfw.json` has `drive`, `runs`, `sessions` or `tasks`. Every other meta field is unchanged.
- `kf doctor` reports no legacy warning.
- No process was killed by kf.
- Docs, Pages site and skills describe only the in-session path.

## Business Rules
- Removed config keys: `harness.main`, `harness.roles`, `harness.stages`, `harness.runners`, `harness.parallel`, `harness.retries`, `harness.maxLoops`, `harness.budget`. Kept: `harness.verify.task`, `harness.verify.stage`.
- Leftover meta keys: `drive`, `runs`, `sessions`, `tasks`.
- Only `kf doctor --fix` removes the legacy config keys or the leftover meta. There is no write-time migration; `kf init`, bootstrap and every other write leave them in place.
- Legacy keys are ignored on load and never validated, so a wrong type never blocks a command.
- No command refuses to act because of a leftover record.
- `kf doctor` without `--fix` is read-only.
- kf never kills a pre-upgrade process; it only names the pid and tells the operator to stop it.
- Historical snapshots (`docs/requirement|use-cases|testplan`) and CHANGELOG history are not rewritten (FR-010 exception).

## Data
- `.kf/config.json` `harness`: holds the kept `verify.task` and `verify.stage` argv lists, plus any of the eight legacy keys until `--fix`.
- Work item `.kfw.json`: item meta whose `drive`, `runs`, `sessions` and `tasks` keys are leftovers. `drive.supervisorPid` and `runs[].pid` identify processes that may still be live.
- Doctor warning codes: `harness_legacy_key` (one per legacy config key) and `meta_legacy_run_state` (one per affected item).

## Acceptance Criteria
- [ ] A config with `harness.roles` loads, `kf doctor` warns once per legacy key present with the remedy `kf doctor --fix`, and `kf doctor --fix` removes them and keeps `harness.verify`.
- [ ] A legacy key of the wrong type (for example `harness.roles: "x"`) still loads without "Invalid project config", is reported by `kf doctor`, and is removed by `--fix`.
- [ ] After `--fix`, every other config key keeps its value as JSON.
- [ ] `kf init` on a config with `harness.roles` keeps the key until `kf doctor --fix`, and does not seed a harness block.
- [ ] A config with only `harness.verify` produces no doctor warning.
- [ ] A work item `.kfw.json` with a drive block is reported once by `kf doctor`, and loses `drive`, `runs`, `sessions` and `tasks` after `--fix` with its other fields unchanged.
- [ ] `kf archive` and `kf status` act normally on an item whose `.kfw.json` still has a live-looking `drive` block, and do not refuse.
- [ ] A live-looking `drive.supervisorPid` or `runs[].pid` is named in the doctor report with "stop this process yourself", and kf never kills or signals it.
- [ ] `kf doctor` without `--fix` changes no file.
- [ ] A file that cannot be parsed during `--fix` is named with its error and left unchanged, and the other files are still processed.
- [ ] `grep -rnE "kf (drive|run|runs|harness)\b"` over README.md, .github/pages/ and docs/workflow/ returns only lines that say the commands were removed.

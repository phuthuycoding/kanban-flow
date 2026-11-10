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
| ID | UC-003 |
| Name | Enter review with a waiver when no stage verify is pinned |
| Requirement reference | FR-003 |
| Goal | A project with no `harness.verify.stage` is stopped at testing -> review until the item carries a waiver the human gave with a reason; the waiver is recorded in the item metadata and visible. |
| Primary actor | Human (project owner) |

## Supporting Actors
- Agent session: runs `kf verify <f> --stage --waive` only on the human's explicit word (the same rule as `--force`).
- kf CLI: refuses, validates the reason, writes `verifyWaiver` to `.kfw.json`, and reads it at the gate.

## Preconditions
- The item is in testing and its testing report is PASS.
- `harness.verify.stage` in `.kf/config.json` is absent or `[]`.

## Trigger
`kf stage <f> review` is run and the stage-evidence gate refuses with `verify_not_configured`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent session | Runs `kf stage <f> review` | kf refuses with `verify_not_configured`; the message names both ways out: pin `harness.verify.stage` in `.kf/config.json`, or record a waiver with `kf verify <f> --stage --waive "<reason>"`. Nothing moves. |
| 2 | Agent session | Reports the refusal to the human and asks which way out | No waiver is written without an answer. |
| 3 | Human | Chooses to waive and gives a reason in words | The explicit word that lets the agent run the command. |
| 4 | kf CLI | `kf verify <f> --stage --waive "<reason>"` validates the reason, the flag pairing and the config | `meta.verifyWaiver = { reason, at, by }` is written through `updateFeatureMeta` under the item lock; `by` is the configured reviewer, then `detectReviewer`. |
| 5 | Agent session | Runs `kf stage <f> review` again | The gate state is `waived`; the item moves to review. |

## Alternative Flows
### A1
- Trigger: the item already carries a waiver and the human gives a new reason.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf verify <f> --stage --waive "<new reason>"` | `verifyWaiver` is replaced whole (reason, at, by); no history is kept. Return to step 5. |

### A2
- Trigger: `harness.verify.stage` is `[]` (configured but empty).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | `kf stage <f> review`, then `--waive` | Empty counts as not configured: the gate refuses with `verify_not_configured` and the waiver is accepted. Return to step 5. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Reason is empty or blank | Exit 3 before any write | No `verifyWaiver` written; message says a reason is required. |
| `--waive` without `--stage` | Exit 3 before any write | No `verifyWaiver` written; message says `--waive` needs `--stage`. |
| `harness.verify.stage` has at least one command | Exit 3 before any write | No `verifyWaiver` written; message says to run `kf verify <f> --stage` instead. |

## Postconditions
- `.kfw.json` of the item holds `verifyWaiver` `{ reason, at, by }` and `kf stage <f> review` moves the item (success path).
- After any exception flow `.kfw.json` is byte-identical to before the command.

## Business Rules
- The waiver is per item, never per project, and is given by the human; an agent records one only on the human's explicit word.
- A waiver on an item whose project later pins `harness.verify.stage` is ignored: the gate requires a passing record at HEAD (FR-002 applies whenever commands are configured). The waiver stays on the item but never satisfies the gate.
- The refusal always names both ways out; `--force` still bypasses the gate and records a bypass.
- A malformed `verifyWaiver` is rejected by `readFeatureMeta` the same way `bypasses` is.

## Data
- `verifyWaiver` in `.kfw.json`: `{ reason: string, at: timestamp, by: string }`, optional on `FeatureMeta`.
- `harness.verify.stage` in `.kf/config.json`: human-pinned argv list; read, never written, by kf.

## Acceptance Criteria
- [ ] With `harness.verify.stage` absent and no waiver, `kf stage <f> review` refuses with `verify_not_configured` and the message names pinning `harness.verify.stage` and `--waive`. (TC-013)
- [ ] With `harness.verify.stage` absent or `[]`, `kf verify <f> --stage --waive "<reason>"` exits 0 and `.kfw.json` holds `verifyWaiver` with that reason, an `at` time and a non-empty `by`. (TC-013, TC-014)
- [ ] After that, `kf stage <f> review` moves the item to review without running any command. (TC-013)
- [ ] A second waiver replaces the first: one `verifyWaiver` with the new reason.
- [ ] An empty or whitespace reason, `--waive` without `--stage`, and `--waive` with stage commands configured each exit 3 and leave `.kfw.json` unchanged. (TC-014)
- [ ] A waived item whose project then pins `harness.verify.stage` is refused by `kf stage <f> review` (record required), and `verifyWaiver` is still present. (TC-016)
- [ ] A `verifyWaiver` that lacks `reason`, `at` or `by` as strings makes `readFeatureMeta` throw. (TC-015)

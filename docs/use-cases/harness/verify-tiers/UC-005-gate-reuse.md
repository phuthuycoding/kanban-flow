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
| ID | UC-005 |
| Name | Reuse the last wave's record at the gates |
| Requirement reference | FR-006, FR-008, FR-009 |
| Goal | The build gate of `/kf:implement`, the stage run of `/kf:test` and the move to review use the last wave's passing stage record when it already covers HEAD, so the full suite is not run again. |
| Primary actor | Agent session |

## Supporting Actors
- kf CLI: `kf status --change <f>`, `kf verify <f> --stage`, `kf stage <f> review`; the #145 evaluation reads the latest line of `<item>/loop/stage-verify.jsonl`.
- Human (project owner): pins `harness.verify` in `.kf/config.json`; FR-008 is the approval of this repository's values.

## Preconditions
- `harness.verify.stage` is pinned, so the wave tier ran and the last wave's `kf verify <f> --wave <w>` left a stage record with `wave: <w>`, `clean: true` and exit 0.
- Every task of the item is complete and the item is at the implementation build gate or in testing.

## Trigger
The Agent session reaches the build gate of `/kf:implement` (after the last wave is verified), or starts the stage run of `/kf:test`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent session | Runs `kf status --change <f>`. | The Delivery section shows `Stage verify: PASS <sha7> at HEAD, <age> ago`: the last wave's record is at HEAD and nothing was committed after it. |
| 2 | Agent session | At the `/kf:implement` build gate, skips `kf verify <f> --stage` because status shows PASS at HEAD. | No second full-suite run; the build gate is satisfied by the wave record. |
| 3 | Agent session | In `/kf:test`, skips the stage run for the same reason. | The testing stage records its result against the wave record's evidence; no new run. |
| 4 | Agent session | Runs `kf stage <f> review`. | The review gate (#145) reads the latest stage record, a wave record is a stage record, the evaluation is `pass`, and the item moves to review with no new run. |

## Alternative Flows
### A1
- Trigger: A commit landed after the last wave's record (a fix round, a review reopen), so `kf status --change <f>` shows `Stage verify: stale (record <sha7>, HEAD <sha7>)`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The session runs `kf verify <f> --stage`. | A new stage record is written at HEAD. |
| A1.2 | The session re-reads `kf status --change <f>`. | PASS at HEAD; return to main flow step 2 (or 3 in testing). |

### A2
- Trigger: The latest record is any other non-PASS state (`none`, `fail`, `dirty-now`, `config-changed`, `waived`, `not-configured`).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The session follows the state's own message from `kf status`; it runs `kf verify <f> --stage` only where the message says to. | Unchanged #145 behaviour; no gate reuse is claimed without PASS at HEAD. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The last wave's `kf verify <f> --wave <w>` failed (exit 1). | Not a gate matter: the Wave verify decide of UC-004 applies first. | `Stage verify: FAIL <sha7> at HEAD (exit <n>)`; the build gate is not satisfied until a later pass. |

## Postconditions
- The item enters review on the wave record with no extra full-suite run, or on a fresh `--stage` record when HEAD moved.
- `kf verify <f> --stage` runs only when `kf status` does not show PASS at HEAD.

## Business Rules
- The skills (`/kf:implement` build gate, `/kf:test`, `/kf:flow`) say: run `kf verify <f> --stage` only when `kf status --change <f>` does not show `Stage verify: PASS <sha7> at HEAD`; `kf stage <f> review` moves on the wave record.
- The review gate needs no change; the stage record format and gate states are unchanged except the optional `wave` field.
- The existing pinned sentences stay verbatim: "the stage record is the gate into review" and "`kf verify <f> --stage`" in implement, test and flow.
- `harness.verify` is set only by a human; kf never writes it. This repository pins `harness.verify.task` = `[["npm","run","typecheck"]]` and `harness.verify.related` = `["npx","vitest","related","--run"]`; `harness.verify.stage` stays `[["npm","run","build"],["npm","test"]]`.
- Skill text is the agent contract; the CLI enforces the gate.

## Data
- Stage record: a line of `<item>/loop/stage-verify.jsonl` (`sha`, `clean`, `exit`, optional `wave`); the gate reads the latest line.
- `.kf/config.json` `harness.verify`: `task`, `related`, `stage` as pinned above.
- Documentation surfaces: skills/implement/SKILL.md, skills/implement/references/task-loop.md, skills/test/SKILL.md, skills/flow/SKILL.md, docs/workflow, README.md, .github/pages/index.html, CHANGELOG.md, `kf verify -h`, `kf record -h`.

## Acceptance Criteria
- [ ] With the last wave's passing record at HEAD and no later commit, `kf status --change <f>` shows `Stage verify: PASS <sha7> at HEAD` and `kf stage <f> review` moves the item with no new run. (TC-021)
- [ ] After a commit following the last wave record, `kf status --change <f>` shows `stale` and the skills direct a `kf verify <f> --stage` run. (TC-021)
- [ ] `.kf/config.json` pins task = `[["npm","run","typecheck"]]`, related = `["npx","vitest","related","--run"]` and stage = `[["npm","run","build"],["npm","test"]]`. (TC-022)
- [ ] `/kf:implement`, `/kf:test` and `/kf:flow` name the rule "run `kf verify <f> --stage` only when `kf status` does not show PASS at HEAD" and keep every pinned sentence. (TC-023, TC-024)
- [ ] The implement skill and task-loop reference describe the tiers (task, wave verify, the wave decide, gate reuse); docs/workflow, README, the Pages site, CHANGELOG and the `kf verify` / `kf record` help do too. (TC-023, TC-024)

---
feature: verify-evidence
context: harness
created: 20261109_1307
kind: feature
status: archived
issue: 145
epic: 144
---
# Spec Requirement

## Feature
verify-evidence

## Objective
The gate into review reads evidence kf produced itself: `kf verify <f> --stage` records each run (commit, commands, exit codes, output hash), and `kf stage <f> review` moves only on a passing record taken at the item's HEAD with the commands currently pinned, or on a waiver a human gave with a reason that review shows.

## Problem Statement
`kf verify --stage` runs the commands a human pinned in `harness.verify.stage` (`src/workflow/verify.ts` `verifyStage`), prints the verdict and forgets it: unlike `--task`, it writes no log. No transition reads it — `transitionItem` (`src/workflow/transition.ts`) never calls verify, and `checkDirectionGate` (`src/workflow/direction.ts`) lets `testing → review` through on the report's `status: PASS` alone. The only evidence check is `testing_exit_code` (`src/workflow/validate-reports.ts` `commandExitCodes`), which parses exit codes the agent typed into the `## Commands and Evidence` Markdown table. `BACKLOG.md` (P1 — Trust & evidence) records that those reports are taken on trust, and the table parser has needed repeated fixes (#136, #138). A project with no `harness.verify.stage` gets `No stage verify configured` and exit 0, so nothing at all stands behind its PASS.

First Principles, condensed:
- Truths: only a command kf ran itself is evidence kf can stand behind; evidence is about one tree, so it must name the commit; the commands must be the human-pinned ones (argv in `.kf/config.json`, never read from an artifact — the BACKLOG privilege-escalation rule).
- Questioned assumption: "the testing report must prove the run." It cannot — it is agent-written text. The report keeps describing what was tested; the record proves the suite passed.
- Rebuilt: kf writes a record on every stage run; the gate compares record ↔ HEAD ↔ config; the Markdown table stops being a gate.

## Scope
### In Scope
- `kf verify <f> --stage` writes a record of every run that ran commands (pass or fail).
- `kf stage <f> review` (from testing) requires the latest record to pass, to match the item's HEAD, to have been taken on a clean tree, and to list the commands now pinned in `harness.verify.stage`.
- A project with no `harness.verify.stage` is stopped at that gate unless the item carries a waiver with a reason; the waiver is recorded and shown wherever review and status look.
- `kf status` shows the latest stage record (or the waiver) of an item.
- The review report template carries a verify-evidence line (record or waiver).
- Retire the `testing_exit_code` check and its table parser; the Commands table stays as descriptive evidence.
- Skills (`kf:implement`, `kf:test`, `kf:review`, `kf:flow`) and docs say where the record is written and read.
- Applies to features and bugs alike (both pass `testing → review`).

### Out of Scope
- What runs at task level and the full suite per wave — #146 (verify-tiers). This item does not change `--task`.
- The content of the test stage and who owns tests — #147 (testing-slim).
- Detecting a hand-forged record file: the record lives in the item folder, which the agent can write. This item removes mistaken, stale and typed-in evidence; it does not defend against a deliberately falsified file (see Assumptions).
- Gates other than `testing → review` (review → done keeps its CI/landing checks; CI is unchanged).
- Running the stage commands inside `kf stage`: the gate reads the record, it never re-runs (epic acceptance: no re-run at the gate for the same sha).

## Affected surfaces
- README.md
- .github/pages/index.html
- CHANGELOG.md
- kf verify -h
- kf stage -h
- skills/implement/SKILL.md
- skills/test/SKILL.md
- skills/review/SKILL.md
- skills/flow/SKILL.md
- review report template
- docs/workflow

## Actors
- Agent session (controller) — runs `kf verify --stage`, moves the item with `kf stage`.
- Human (project owner) — pins `harness.verify.stage`, grants a waiver when the project has none.
- kf CLI — writes the record, enforces the gate.
- Reviewer (`kf:code-reviewer` via `kf:review`) — sees the record or the waiver in the review pack.

## Functional Requirements
### FR-001
- Requirement: `kf verify <f> --stage` appends one record per run that ran at least one command, in the item folder, carrying: the time, the full commit sha of the item's HEAD (worktree when the item has one, else the project root), whether the tracked tree was clean, the full configured argv list, and for each command in order its outcome — exit code, signal, `not started: <error>` (e.g. command not found), or `not run` when an earlier command failed — a sha256 hash of the combined output, and the overall exit code (0 or 1). A run that ran nothing (exit 3, or no `harness.verify.stage` configured) writes no record.
- Priority: must
- Notes: The record is append-only history; the gate reads the latest one. The file name and format are fixed in planning (the `--task` log lives at `<item>/loop/<task>-verify.log`). A failed write must not change the verdict of commands that ran; it prints a warning, as `--task` does today.

### FR-002
- Requirement: `kf stage <f> review` from testing refuses unless the item directory exists, the latest stage record exists and parses, has overall exit 0, names the item's current HEAD sha, was taken on a clean tracked tree, the tracked tree is still clean now, and the record lists exactly the argv lists now in `harness.verify.stage`. The refusal names which condition failed and prints the command to run (`kf verify <f> --stage`).
- Priority: must
- Notes: A refusal is a gate refusal: `--force` still passes it and records a bypass, as every gate does today. Order of argv matters (a reordered config is a different run).

### FR-003
- Requirement: When `harness.verify.stage` is absent or empty, `kf stage <f> review` refuses unless the item carries a waiver; the refusal says to pin `harness.verify.stage` in `.kf/config.json` or to record a waiver. A waiver is written by `kf verify <f> --stage --waive "<reason>"`, refuses an empty reason, refuses while `harness.verify.stage` is configured, and is stored in the item metadata with the reason, the time and the git user.
- Priority: must
- Notes: The command name is a planning detail; the behaviour is fixed here. Skills state that an agent records a waiver only on the human's explicit word (the same rule as `--force`).

### FR-004
- Requirement: `kf status --change <f>` (text and `--json`) shows the latest stage record — pass/fail, short sha, whether it matches HEAD, age — or the waiver with its reason, or that neither exists.
- Priority: must
- Notes: This is the surface review and travel read; `kf:review` copies it into the review pack and the review report.

### FR-005
- Requirement: The `testing_exit_code` validation and the `commandExitCodes` table parser are removed; a PASS testing report is no longer refused for its `## Commands and Evidence` rows. The table stays in the template as descriptive evidence.
- Priority: must
- Notes: Retired only together with FR-002/FR-003, so no release has neither check. Existing tests of the parser are removed with it.

### FR-006
- Requirement: `kf:implement`, `kf:test`, `kf:review` and `kf:flow` say that the stage record is the gate into review: run `kf verify <f> --stage` at the final HEAD (after the last commit of testing), never hand-copy its exit codes as proof, and show the record or waiver in the review pack and report.
- Priority: must
- Notes: The skill text is the agent-facing contract; the CLI is the enforcement.

## Non-Functional Requirements
- No new runtime dependency; sha256 from `node:crypto`.
- The gate adds no command run: it reads one file and runs `git rev-parse HEAD` and `git status --porcelain --untracked-files=no` in the item directory.
- Commands still run without a shell, from the config only — never from an artifact.
- Output hash, not output: the record stays small; the output tail is still printed to the terminal.

## Main Use Cases
- UC-001 Record a stage verify run
- UC-002 Enter review on a passing record at HEAD
- UC-003 Enter review with a waiver when no stage verify is pinned
- UC-004 See the record or waiver in status and review

## Constraints
- `harness.verify` is set only by a human in `.kf/config.json` (`src/project/harness-config.ts`); kf never writes it.
- Every bypass of a failing gate is recorded in `.kfw.json` (existing `recordBypasses`).
- Items already past testing (review, done) are not re-gated.

## Assumptions
- Threat model: the record protects against stale, mistaken and typed-in evidence, not against an agent hand-editing the record file. Signing or storing records outside the item folder is out of scope; the human-pinned commands remain the trust anchor.
- A dirty tree is a tracked file with uncommitted changes (`git status --porcelain --untracked-files=no` non-empty); untracked files do not make a record unclean.
- "Latest record" is the last one appended; an earlier pass at the same sha does not rescue a later failure (a flaky pass followed by a fail stops the gate).
- A waiver is per item, not per project, and stays on the item when the project later pins `harness.verify.stage`; from then on the gate requires a record again (FR-002 applies whenever commands are configured).
- An item in testing when this ships must run `kf verify <f> --stage` (or get a waiver) before review; that is the intended migration.

## Acceptance Criteria
- [ ] After a `kf verify <f> --stage` run that ran commands (exit 0 or 1), the item folder holds a new record with the sha of HEAD, the clean flag, each argv with its outcome (exit code, signal, not started, not run), an output hash and the overall code; after exit 3, or with no `harness.verify.stage`, it holds no new record.
- [ ] With a passing record at HEAD on a clean tree and unchanged config, `kf stage <f> review` moves the item without running any verify command.
- [ ] A new commit after the record, a failing latest record, a record taken on a dirty tree, a tracked tree dirty now, an unparsable latest record, a missing item directory, or a changed `harness.verify.stage` each make `kf stage <f> review` refuse with a message naming the cause.
- [ ] With no `harness.verify.stage`, `kf stage <f> review` refuses without a waiver and moves with one; the waiver command refuses an empty reason and refuses while stage commands are configured.
- [ ] `kf status --change <f>` and `--json` show the record (pass/fail, short sha, matches HEAD, age) or the waiver reason.
- [ ] A PASS testing report whose Commands table has a non-zero or missing exit code is no longer refused by `kf validate`.
- [ ] `--force` still passes the new gate and records a bypass.
- [ ] The review report template has a verify-evidence line, and `kf:review` fills it from `kf status` with the record (sha, pass) or the waiver reason.
- [ ] README, the Pages site, CHANGELOG, `kf verify -h`, `kf stage -h`, `docs/workflow` and the four skills describe the record and the waiver.

## Edge Cases
- Item with no worktree (`worktree.enabled` false): record and gate use the project root's HEAD.
- Worktree directory deleted: `kf verify --stage` exits 3 (as today) and writes nothing; the gate refuses naming the missing directory.
- Record file missing, empty, truncated or with an unparsable line: the gate treats it as "no valid record" and refuses; an unparsable line never counts as a pass.
- Commands killed by a signal: recorded as a failure with the signal name.
- HEAD rewritten (amend, rebase) to a different sha with identical content: the sha differs, so a new run is required.
- Two `kf verify --stage` runs at once on one item: appends must not interleave into a corrupt record (planning picks the lock or atomic append).
- A bug item: same gate, same record.
- Loop back FAIL → implementation → testing again: old records stay as history; only the latest counts.

## Open Questions
- None blocking. Record file name/format, the waiver command shape and whether `kf validate` also warns in testing when no valid record exists are planning decisions inside FR-001/003.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`npm test`, `src/tests/*.test.ts`), with real temporary git repositories for the HEAD/clean checks and the `kf stage` gate
- Coverage Target: 80%

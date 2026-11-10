---
feature: verify-tiers
context: harness
created: 20261109_1645
kind: feature
status: archived
issue: 146
epic: 144
---
# Spec Requirement

## Feature
verify-tiers

## Objective
Run each check where it pays: per task, typecheck plus the tests related to the files the task changed; per wave, one full suite at the wave's HEAD that the next wave waits for; at the gates, reuse the last wave's stage record when it already covers HEAD instead of running the suite again.

## Problem Statement
In this repository `harness.verify.task` is `npm run typecheck` plus the full `npm test`, run by `kf verify --task` after every task commit (`src/workflow/verify.ts` `verifyTaskCommits`); the full suite then runs again at the build gate (`kf verify --stage`), in testing, and in CI. Concurrent full suites in one worktree are the reason the loop carries the contention signatures, the step-down and the held re-run (`src/workflow/next/cap.ts`). Nothing in `kf next` runs a wave-level suite (the only wave step is the cap step-up), and a later wave's developer may start once each dependency has a commit (`arbiter.ts`). There is no way to hand a task's changed files to a pinned command: `harness.verify` rejects `{…}` placeholders (`src/project/harness-config.ts`).

First Principles, condensed:
- Truths: a task's own tests are the cheapest proof of the task; only a full suite proves the absence of a cross-task break; commands stay human-pinned argv run without a shell, never read from an artifact; the review gate (#145) trusts only a stage record kf wrote at HEAD.
- Questioned assumption: "every task needs the full suite." It needs the tests that can see its change; the full suite is owed once per set of tasks that can interact — a wave — and before the next wave builds on it.
- Rebuilt: task tier = `harness.verify.task` + `harness.verify.related` with the changed files appended; wave tier = `harness.verify.stage` in a clean detached worktree at HEAD, written as a stage record; the gate reads the latest stage record, so the last wave's record is the gate's evidence when nothing changed since.

User decisions (brainstorm, 2026-11-09): the related command receives the changed files appended to its argv (a new `harness.verify.related` key); the next wave waits for the previous wave's full suite.

Research: reviews/research-related-tests.md (vitest `related`, jest `--findRelatedTests`, lint-staged argv append). Probed in this repository (Vitest 2.1.9): `npx vitest related --run src/workflow/stage-record.ts` ran 48 test files, a test file passed directly ran that file, and `README.md` or a missing path printed "No test files found, exiting with code 0".

## Scope
### In Scope
- `harness.verify.related`: one argv, validated like the other verify lists; `kf verify --task` appends the task's changed files to it.
- Task tier in `kf verify --task` (both `--base` and `--commits`): `harness.verify.task`, then `harness.verify.related` + changed files.
- Wave tier: `kf verify <f> --wave <w>` runs `harness.verify.stage` in a temporary detached worktree at the item's HEAD and appends a stage record tagged with the wave.
- `kf next` and `kf record`: a wave verify action once every task of the wave is complete; later-wave developers wait for it to pass; a failed wave verify is a decide that reopens the task(s) it is traced to.
- Gate reuse: the build gate and the testing stage run `kf verify --stage` only when the latest stage record does not already pass at HEAD.
- `kf loop-stats` reads the wave verify lines and checks them against the wave log.
- This repository's `.kf/config.json`: task = typecheck, related = `npx vitest related --run`.
- Skills (implement, test, flow), task-loop reference, docs and help.

### Out of Scope
- Removing or changing the live cap, contention signatures or step-down — measured after this lands (issue #146 Out).
- Pipelined waves (the user chose "next wave waits").
- Selecting related tests by kf itself (import graphs): the project's pinned command decides.
- Changing CI, the review gate's states (#145) or the test stage's content (#147).
- Chunking very long file lists (see Assumptions).

## Affected surfaces
- README.md
- .github/pages/index.html
- CHANGELOG.md
- kf verify -h
- kf record -h
- kf next
- kf loop-stats -h
- .kf/config.json
- skills/implement/SKILL.md
- skills/implement/references/task-loop.md
- skills/test/SKILL.md
- skills/flow/SKILL.md
- docs/workflow

## Actors
- Agent session (controller) — runs the loop from `kf next`, records with `kf record`.
- Human (project owner) — pins `harness.verify.related`.
- kf CLI — runs the tiers, writes logs and records, schedules waves.

## Functional Requirements
### FR-001
- Requirement: `.kf/config.json` accepts `harness.verify.related` as one non-empty argv (string array), validated with the same rules as each `harness.verify.task` entry (no empty string, no leading `-` in argv[0], no `{…}` placeholder); any other shape is a config error naming the field.
- Priority: must
- Notes: One command, not a list: kf appends files to it.

### FR-002
- Requirement: `kf verify <f> --task …` runs every `harness.verify.task` command, then — when `harness.verify.related` is set and the task changed at least one file that exists in the tree it runs in — `harness.verify.related` with those files appended as further argv elements, repo-relative, in sorted order. With no such file it runs no related command and its output says so. The Files allowlist check, exit codes (0/1/2/3), the detached worktree of `--commits` and the task log are unchanged; the log names every argv it ran.
- Priority: must
- Notes: Changed files = the union of the task's commits against their parents (`--commits`) or `base..HEAD` (`--base`), deleted files dropped. A bug task (no Files) gets the same changed files. Without `harness.verify.related` the behaviour is exactly today's.

### FR-003
- Requirement: `kf verify <f> --wave <w>` runs `harness.verify.stage` in a temporary detached worktree at the HEAD of the item's directory (its worktree, else the project root, as `--stage` resolves it; the item's `node_modules` linked as `--commits` does), appends a stage record to `<item>/loop/stage-verify.jsonl` whose `sha` is that HEAD, `clean` true, and which carries `wave: <w>`, and appends the run's output to `<item>/loop/wave-<w>-verify.log`. Exit 0 pass, 1 a command failed, 3 bad input (a wave no task of the plan has — a bug's tasks are all wave 1 —, not a positive integer, combined with `--task`/`--stage`/`--base`/`--commits`, a recorded worktree whose path is missing) with nothing run or written. With no `harness.verify.stage` it says so, exits 0 and writes nothing.
- Priority: must
- Notes: Detached because the item worktree holds the next wave's failing tests written ahead by test-writers.

### FR-004
- Requirement: When `harness.verify.stage` is pinned and every task of wave `w` is complete, `kf next` prints `verify wave <w>: kf verify <f> --wave <w>` until wave `w` is verified: there is a passing record (tagged `wave: w`, tagged another wave, or a plain `--stage` record) in `<item>/loop/stage-verify.jsonl` whose `sha` contains every commit of wave `w`'s tasks (`git merge-base --is-ancestor`) and that is newer than the latest failing record tagged `wave: w` (kf next gains this file as an input). One passing run at a commit that contains several waves verifies all of them, so waves owed at the same HEAD cost one suite, and an item started before this change counts its passing `--stage` record. Any later commit of a wave-`w` task therefore owes the wave verify again. No developer of a task in a later wave is dispatched until the latest wave verify of every earlier wave passed; its reason prints `wait TASK-NNN: wave <w> verify` . Test-writers of later waves are not held. `kf record` accepts `wave-verify-started <w>` and `wave-verify-done <w> --exit <n>`, written as `wave <w>: verify started` / `wave <w>: verify done exit=<n>`. `kf next --resume` lists a wave verify with a `started` line and no `done` line for a re-run.
- Priority: must
- Notes: With no `harness.verify.stage` there is no wave tier and today's scheduling holds.

### FR-005
- Requirement: A wave verify that exits 1 prints `decide (Wave verify): wave <w> failed — closes with Note TASK-NNN: reopened — wave <w> or Note wave <w>: decided — <what>`; every later-wave developer stays held until wave `w` is verified (FR-004). The ledger grammar gains two lines, both written through `kf record … line`: `Note TASK-NNN: reopened — wave <w>` — a reopen source beside `testing|review|ci` that carries a wave number instead of an execution id; it reopens that task as a review reopen does today (its round count continues, a new `complete` line is owed, `kf loop-stats` reads it as a reopen) — and `Note wave <w>: decided — <what>`, which closes the Wave verify decide and owes a new wave verify run (a flaky or environmental failure). Once every reopened task is complete again the wave verify is owed again. Exit 3 prints a decide naming the call to fix, closed by a new `wave <w>: verify started` or the decided note; exit 2 cannot occur.
- Priority: must
- Notes: The session traces the failure to tasks by the existing evidence rule (failing test files against each task's Files, else a `Ruling:`).

### FR-006
- Requirement: When the latest stage record passes at the item's HEAD (the #145 evaluation is `pass`) — as the last wave's record does when nothing was committed after it — the build gate of `/kf:implement` and the stage run of `/kf:test` are satisfied without running `kf verify --stage`: both skills say to run `kf verify <f> --stage` only when `kf status --change <f>` does not show `Stage verify: PASS <sha7> at HEAD`, and `kf stage <f> review` moves on the wave record.
- Priority: must
- Notes: The review gate needs no change: a wave record is a stage record.

### FR-007
- Requirement: `kf loop-stats` parses the wave verify lines, reports their minutes as `wave verify` (count, median, sum), and `--record` refuses a `wave <w>: verify done exit=<n>` line that `wave-<w>-verify.log` does not back within 15 minutes, as it does for task verify lines.
- Priority: should
- Notes: Needed to measure the change against the issue's baseline.

### FR-008
- Requirement: This repository's `.kf/config.json` pins `harness.verify.task` = `[["npm","run","typecheck"]]` and `harness.verify.related` = `["npx","vitest","related","--run"]`; `harness.verify.stage` stays `[["npm","run","build"],["npm","test"]]`.
- Priority: must
- Notes: A human-owned file: this requirement is the human's approval of the change.

### FR-009
- Requirement: `/kf:implement` (task tier, wave verify, the wave decide, gate reuse), its task-loop reference, `/kf:test` (stage run only when not PASS at HEAD), `/kf:flow`, `docs/workflow`, README, the Pages site, CHANGELOG and the `kf verify` / `kf record` help describe the tiers.
- Priority: must
- Notes: Skill text is the agent contract; the CLI enforces.

## Non-Functional Requirements
- Commands run without a shell from the config only; file paths are argv elements, never interpolated into a string.
- No new runtime dependency.
- A wave verify's detached worktree is removed on every exit path, as `--commits` does today.
- Fewer full-suite runs per item: one per wave plus none at the gates when HEAD is unchanged.

## Main Use Cases
- UC-001 Verify a task on its related tests
- UC-002 Verify a wave with the full suite
- UC-003 Hold the next wave until its predecessor's suite passes
- UC-004 Trace a wave failure back to a task
- UC-005 Reuse the last wave's record at the gates

## Constraints
- `harness.verify` is set only by a human; kf never writes it.
- The #145 stage record format and gate states are unchanged except the optional `wave` field.
- Ledger lines go through `kf record`; travel and `kf loop-stats` keep reading `TASK-NNN:` lines unchanged. The two new Note shapes (FR-005) extend `REOPENED` and add a wave decided shape in `src/workflow/next/ledger-state.ts`; `skills/implement/SKILL.md`'s "no other line shape is written for a repair" gains the wave source.

## Assumptions
- Related selection misses dynamic imports, file reads, child processes and skill text (research); the wave tier is the backstop, so the related command needs no completeness guarantee.
- File lists are short (a task's changed files); no chunking. An argv too long for the OS is a spawn failure recorded as `not-started` (exit 1).
- A wave is the plan's wave (`kf tasks` graph). A wave whose tasks are all inline still gets one wave verify.
- The wave record's `clean` is true by construction (detached checkout); the gate's `dirty-now` check still reads the item directory.
- `vitest related` with only non-source paths exits 0 in this repository (probed); a project whose runner exits non-zero on "no tests" passes its own flag (e.g. `--passWithNoTests`) in the pinned argv.

## Acceptance Criteria
- [ ] A config with `harness.verify.related` as a valid argv loads; an empty array, a non-array, an argv with `{…}` or a leading `-` is refused naming `harness.verify.related`.
- [ ] `kf verify --task` with `related` set runs the task commands, then the related argv with the task's existing changed files appended in sorted order; a task that only deleted files runs no related command and says so; without `related` the run equals today's.
- [ ] `kf verify <f> --wave <w>` runs the stage commands in a detached worktree at HEAD, appends a stage record with `wave` and `clean: true`, writes `loop/wave-<w>-verify.log`, removes the worktree, and exits 0/1; bad input exits 3 writing nothing.
- [ ] `kf next` prints the wave verify once all tasks of the wave are complete, holds every later-wave developer with `wave <w> verify` until a passing wave record contains every wave commit, owes it again after a later wave-`w` commit, does not hold later-wave test-writers, and `--resume` lists an open wave verify.
- [ ] A failed wave verify prints the Wave verify decide; `Note TASK-NNN: reopened — wave <w>` is accepted by `kf record` and `kf next` and reopens that task, the wave verify is owed again after it completes; `Note wave <w>: decided — …` closes the decide and owes a new run.
- [ ] With the last wave's passing record at HEAD, `kf stage <f> review` moves the item without a new run, and the implement and test skills name the rule "run `kf verify <f> --stage` only when `kf status` does not show PASS at HEAD".
- [ ] `kf loop-stats` shows `wave verify` minutes and `--record` refuses an unbacked wave verify line.
- [ ] This repository's `.kf/config.json` pins task, related and stage as FR-008 states, and `kf verify --task` on a task of this repository logs `npm run typecheck` followed by `npx vitest related --run <the task's files>`.
- [ ] The skills, task-loop reference, docs, README, Pages, CHANGELOG and help describe the tiers.

## Edge Cases
- A task that changed only non-code files (docs, skills): related gets those paths; the runner finds no tests (exit 0 here).
- A task's changed file renamed: the new path is passed, the old one is dropped.
- A wave with one task: the task tier and the wave tier both run (cheap related run, one suite).
- Two waves: wave 1 verify fails, wave 2 test-writers have already written failing tests in the worktree — the detached wave run does not see them.
- No `harness.verify.stage`: no wave tier, no wave hold; with a waiver the item still enters review (#145).
- `--resume` after compaction with a wave verify open: `kf next --resume` lists it for a re-run.
- A later commit of a wave-`w` task (a fix round after review, a reopen) lands after a passing wave verify: wave `w` is owed again (FR-004); a commit after the last wave makes the gate see `stale`, and the session runs the stage verify.
- Wave verify passes but a task of a later wave is reopened by review: the final stage record is whatever ran last; the gate reads it.

## Open Questions
- None blocking. Planning decides the exact `kf next` state for "every task of the wave complete", the wave-verify judgement wiring and the loop-stats shape.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`npm test`, `src/tests/*.test.ts`) with real temporary git repositories for `kf verify --task/--wave`, and ledger fixtures for `kf next` and `kf loop-stats`
- Coverage Target: 80%

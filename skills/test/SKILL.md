---
name: test
description: 'Test a kanban feature against its approved test plan or a bug against reproduction and regression scope. Write current-execution results with PASS/FAIL/BLOCKED. Use in testing.'
---

# Kanban Phase 4 — Testing (Autonomous)

Plugin root: `${CLAUDE_PLUGIN_ROOT}` — the reference files of this skill write paths with this placeholder; resolve it to this path.

Argument: `<feature_name>`.

Prove the feature against the plan's test cases. The report's `status:` IS the decision — `kf stage` reads it and blocks the wrong direction.

---

## 1. Move to testing

```bash
kf stage {feature_name} testing
```

(Already there → skip.)

If `kf stage` refuses the move, run `kf validate --change {feature_name}` to see what is missing — unfinished `tasks.md` checkboxes block entry to testing (DoD), so tick them in implementation first.

Every entry to testing creates a new execution id. Keep old reports as evidence, but never reuse them as proof for the current implementation. Read the current id from `kf status --change {feature_name}` or `kf instruct ... --change`.

**Where the code lives:** when the item has a worktree (`kf status --change {feature_name}` shows `Worktree:` with `Domain:` or `Direct:`), run the app and its tests inside the worktree path — that is where implementation landed. For HTTP/browser checks prefer `http://<domain>` (start the project's dev server on the allocated port); When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>` (the JSON outputs still carry `domain`; do not use it then); if the machine's domain infra is not set up, use the `127.0.0.1:<port>` fallback shown in `kf status --change {feature_name}` and say so in the report.

## 2. Read the stage record and map the test cases

Testing runs no full suite, lint, build or typecheck: the loop's last wave verify (or `kf verify <f> --stage`) already ran them at HEAD, and the review board and CI run them again. Read `kf status --change {feature_name}`: the `Stage verify:` line must read PASS at the item's HEAD. When the project pins `harness.verify.stage`, anything else — no record, a failed record, a record older than HEAD — gives `BLOCKED` naming `kf verify <f> --stage`; run nothing in its place. `## Commands and Evidence` cites that record: the sha and the commands it ran.

**No stage commands.** When the project pins no `harness.verify.stage`, the `Stage verify:` line reads `not configured — …` or `waived — …` and there is no record to read. Then kf:test runs the project's test command once, with coverage when the tooling supports it, and cites that run. That run serves the TC mapping and the coverage, so no second, scoped run is made. The waiver itself (`kf verify <f> --stage --waive "<reason>"`) is recorded only on the human's word: the session asks the human for it before `kf stage <f> review` and never writes it on its own.

Testing commits nothing: a commit would move HEAD past the stage record, and the review gate would refuse it. It dispatches no automation-writer either: UI and E2E specs are written and committed in kf:implement's task loop.

### Test cases

Read the Test Strategy from `phase-1-spec-requirement.md` (Test Level / UI Tests / Tools / Coverage Target) — it was committed in the approved plan. Map every approved `TC-###` to the test that covers it: each TC row names the test file and the test name, and cites the stage record (or the no-stage-commands run) as the run. Track TC-by-TC: Status / Expected / Actual / Evidence. A TC with no test or only a skipped test gives `FAIL` naming the TC and the owning task, the task whose Files hold that test or the code the TC exercises. Skipped means `.skip`, `.todo`, `xit`, `it.skip` or the framework's equivalent. Under `Level: full`, an approved UI/E2E TC with no spec in the tree gives `FAIL` routed to its owning task; testing never writes the spec.

For `kind: bug`, the rows are the regression tests the bug report names, with their descriptive test names, instead of a phase-2 test plan; the bug report's reproduction, expected result and acceptance criteria say what the fix must show. Do not require FR/UC/TC artifacts for a bug.

### Coverage

Measure coverage once, with the project's coverage tool, scoped to the item's changed source files: `git diff --name-only <BASE>..HEAD` with `--diff-filter=d`, so deleted and renamed-away files drop out, where `<BASE>` is the `## Baseline` HEAD sha in `tasks.md`, minus tests, docs and config. In this repository, for example: `npx vitest related <files> --run --coverage --coverage.include=<file>...`. That scoped run is a shortcut: `vitest related` follows static imports only, so a file reached only by a test that spawns the built CLI can under-measure; a file below the target under it is re-measured with the project's full test command plus the same `--coverage.include` flags before you write `FAIL`. The metric is line coverage per file against the spec's Coverage Target; `## Coverage` gives each changed file's line %, the target and the command. A file below the target gives `FAIL` naming the files and their owning tasks. A required target that is unmeasurable (no coverage tooling) gives `BLOCKED` naming what is missing. A spec with no target means no run, and an item with no changed source files (docs only) means no run; either way `## Coverage` states the reason. Under the no-stage-commands exception the one run above already measured coverage.

### Behaviour run

**"It builds" is not "it works".** For every changed behaviour the plan or the diff names that no test exercises, run the real code path once and record the command and its real output as a fact: the CLI command with its arguments and exit code, the HTTP request against `http://<domain>` (or the `127.0.0.1:<port>` fallback; When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>`) with the response, the script with its output. Run each `TASK-NNN: unverified — <claim>` line of `<item>/loop/progress.md` the same way. Put each under a `## Behaviour run` heading in the report, next to the TC it stands in for, and name the behaviours you could not run and why. A failing behaviour run gives `FAIL` routed to the owning task. When there is nothing to run, `## Behaviour run` states `none — <why>` and the report can still be `PASS`. The review stage reads the "changed behaviour no test touches" line from this report into the reviewer's pack.

## 3. Write testing-result

```bash
kf instruct testing-result --change {feature_name}
```

Fill `phase-4-testing-result.md`, set frontmatter `status:` to exactly one of:

- `PASS` — every automated TC maps to a passing test and every manual TC to a behaviour run (a behaviour run never replaces a missing test), the coverage target is met (or no run is needed, with the reason) and the stage record is PASS at HEAD (or the no-stage-commands run passed)
- `FAIL` — a TC with no test or only a skipped test, a failing test, coverage below target, or a failing behaviour run
- `BLOCKED` — cannot test: the stage record is not PASS at HEAD while stage commands are pinned, a required coverage target is unmeasurable, or the env/tooling is missing

Always write the report, including `execution:` from the current template. Include per-TC results with the test file and test name, the stage record, coverage per changed file and the behaviour run. Record **counts, not verdicts**: the number of tests the coverage run (or the no-stage-commands run) ran and passed, the test files by name, and — in its own line — the changed behaviour that no test touches; the stage record contributes its sha and the commands it ran, not test counts. A suite that ran nothing is not a pass. The review stage copies these facts into the reviewer's pack as data; a "✅ all green" there invites agreement where numbers let the reviewer judge adequacy. In the "Commands and Evidence" table the Exit code column must be the real numeric exit code of each command you ran, written bare (`0`, not `` `0` `` or `0 ✅`), and a `|` inside a command or evidence cell is written `\|`, or moved into a script: a raw one shifts the columns. The table describes the run; it does not gate it — the stage record is the gate into review: `kf stage <f> review` reads the record kf wrote at HEAD, not the table, so never copy its exit code into the report as proof. `## Behaviour run` entries are not exit-checked; their output is the evidence. Keep status and conclusion consistent. Missing tooling, skipped required tests or unmeasured required coverage cannot count as PASS. Write outcomes here; keep phase-2-test-case.md unchanged.

## 4. The directional gate decides

- `PASS` → `kf stage {feature_name} review`
- `FAIL` → loop to implementation, then enter testing again and write a result for the new execution id:

```bash
kf stage {feature_name} implementation
```

Each failure is repaired on the task that owns it, under kf:implement's "Repairing after the loop": the one fix rule for a testing FAIL, a review FAIL and red CI. A reopened task continues its round count; five rounds is its whole life. Then return here and re-test before attempting review again.

- `BLOCKED` → stop and report the environment/tooling blocker, or the stage record to make with `kf verify <f> --stage`. Do not advance or substitute a known issue for required passing tests.

**What stops you.** The stop list is kf:implement's, word for word: an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree (merge, push to a shared branch, publish, a database write); a reopened task at its round cap, apart from the one minimal fix past the cap (3.4); a plan too broken to act on. Two gate outcomes outside the loop stop you too: a review `REQUIREMENT_BUG`; a testing `BLOCKED`.

---

## Done

Report written with a decisive status. Hand off:

```text
If PASS: kf stage {feature_name} review, then load the kf:review skill (independent reviewer, then the PR and the CI watch).
  With no stage commands pinned, ask the human for the waiver first (kf verify <f> --stage --waive "<reason>"); it is recorded only on the human's word.
If FAIL: kf:implement first (Repairing after the loop, on the owning task), then testing with a new execution id.
If BLOCKED: stop and report the blocker.
```

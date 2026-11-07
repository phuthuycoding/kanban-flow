---
name: test
description: 'Test a kanban feature against its approved test plan or a bug against reproduction and regression scope. Write current-execution results with PASS/FAIL/REJECT/BLOCKED. Use in testing.'
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

## 2. Run against the plan's test cases

Read the Test Strategy from `phase-1-spec-requirement.md` (Test Level / UI Tests / Tools / Coverage Target) — it was committed in the approved plan. Detect the real test tooling from the repo. Execute exactly what the level promises: `unit` → unit suite; `unit+integration` → + integration; `full` → + UI/E2E suite (Playwright/Cypress/...). Under `full`, when the UI/E2E suite is missing or a UI test case has no spec, dispatch `Agent(kf:automation-writer)` with `${CLAUDE_PLUGIN_ROOT}/skills/implement/references/automation-writer-brief.md`: write the brief to `<item>/loop/testing-e2e-brief.md` (Test Strategy, the UI test cases, the worktree and the domain or fallback URL from `kf status --change {feature_name}`), name `<item>/loop/testing-e2e-report.md` as its report and the Playwright `testDir` as the Files allowlist (from the project's Playwright config; the spec paths when it has none), then run what it wrote. The automation-writer never commits: the in-session controller commits the automation-writer's spec files unchanged in one commit on the item branch before writing the testing report, so the review package and the PR carry them. The Playwright MCP is for selector discovery only, one agent at a time; the evidence is the headless run. Put each `npx playwright test` row in `## Commands and Evidence` with its real exit code — a non-zero row means the report is not PASS (`kf validate` rejects it). If the suite is still missing after the run, or the tests are skipped, that's a gap — report it, don't fake coverage.

Track TC-by-TC: Status / Actual / Expected / Tool / Evidence.

**"It builds" is not "it works".** For every changed behaviour the plan or the diff names that no automated test exercises, run the real code path once and record the command and its real output as a fact: the CLI command with its arguments and exit code, the HTTP request against `http://<domain>` (or the `127.0.0.1:<port>` fallback; When `worktree.domains` is `false` in `.kf/config.json`, use `http://127.0.0.1:<port>`) with the response, the script with its output. Run each `TASK-NNN: unverified — <claim>` line of `<item>/loop/progress.md` the same way. Put each under a `## Behaviour run` heading in the report, next to the TC it stands in for, and name the behaviours you could not run and why. A suite that ran nothing, or a suite that never touches the changed path, is not PASS on its own — the review stage reads the "changed behaviour no test touches" line from this report into the reviewer's pack.

For `kind: bug`, use the bug report's reproduction, expected result, acceptance criteria and regression strategy instead of a phase-2 test plan. Verify the defect is fixed and run the affected regression suite; use descriptive test IDs or actual test names in the results table. Do not require FR/UC/TC artifacts for a bug.

## 3. Write testing-result

```bash
kf instruct testing-result --change {feature_name}
```

Fill `phase-4-testing-result.md`, set frontmatter `status:` to exactly one of:

- `PASS` — all tests pass, coverage target met
- `FAIL` — tests failing
- `REJECT` — feature does not meet acceptance criteria
- `BLOCKED` — cannot test (env/tooling)

Always write the report, including `execution:` from the current template. Include per-TC results, actual commands, evidence and coverage against the approved target. Record **counts, not verdicts**: the number of tests each command ran and passed, the test files by name, and — in its own line — the changed behaviour that no test touches. A suite that ran nothing is not a pass. The review stage copies these facts into the reviewer's pack as data; a "✅ all green" there invites agreement where numbers let the reviewer judge adequacy. In the "Commands and Evidence" table the Exit code column must be the real numeric exit code of each command you ran, written bare (`0`, not `` `0` `` or `0 ✅`), and a command cell must not contain a raw `|` (escape it as `\|` or move the pipe into a script); `kf validate` rejects a `PASS` report that has no command row or any exit code other than `0` (`testing_exit_code`). `## Behaviour run` entries are not exit-checked; their output is the evidence. Keep status and conclusion consistent. Missing tooling, skipped required tests or unmeasured required coverage cannot count as PASS. Write outcomes here; keep phase-2-test-case.md unchanged. A `|` inside a table cell is written `\|`: a raw one splits the cell and the gate reads the row as failed.

## 4. The directional gate decides

- `PASS` → `kf stage {feature_name} review`
- `FAIL`/`REJECT` → loop to implementation, apply the fix, then enter testing again and write a result for the new execution id:

```bash
kf stage {feature_name} implementation
```

...then return here and re-test before attempting review again.

- `BLOCKED` → stop and report the environment/tooling blocker. Do not advance or substitute a known issue for required passing tests.

Still failing after one fix cycle → STOP, show failing tests, ask: fix deeper / record as known issue / abort.

---

## Done

Report written with a decisive status. Hand off:

```text
If PASS: kf stage {feature_name} review, then load the kf:review skill (independent reviewer, then the PR and the CI watch).
If FAIL/REJECT: kf:implement first, then testing with a new execution id.
If BLOCKED: stop and report the blocker.
```

---
name: kanban-review
description: 'Review a kanban feature or bug against its approved scope, current testing evidence and layered review rules: establish the facts mechanically, pick the review tier from the diff, dispatch independent code-reviewer agents, verify their evidence, and write PASS/FAIL/REJECT/REQUIREMENT_BUG for the current execution. Use in review.'
---

# Kanban Phase 5 — Review (Autonomous, independent reviewer)

Argument: `<feature_name>`.

Stand on quality, not survivor. The orchestrator produces **facts** and a **pack**; an independent reviewer that did not write the code produces the **findings**; the report's `status:` is the truth `kf` trusts. The orchestrator never writes a finding of its own except the mechanical ones in step 2 — an orchestrator grading the work it supervised is the failure this split exists to remove.

**Invoked through `kf run`?** If your prompt starts with `kf-run:`, you are a worker for this stage only: skip the "move to stage" step below, never run `kf stage` / `kf approve` / `kf archive` / `kf run`, never edit approved contract artifacts, do not commit, and end your final message with two lines exactly: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and `Summary: <one or two sentences>`. The main agent reads them and decides the transition. The reviewer dispatch below still applies to you: a worker reviews through `code-reviewer`, not by reading the diff itself.

**Every step leaves a named line.** `Agent(code-reviewer)` in the transcript is auditable; "I reviewed the diff" is not. A missing line is a skipped step.

---

## 1. Move to review

```bash
kf stage {feature_name} review
```

(Already there → skip. If the move is refused, run `kf validate --change {feature_name}` — a missing, stale or non-PASS testing report blocks this direction; loop back through kanban-test.)

Read `kf status --change {feature_name} --json`: the current `executionId`, `kind`, and the `Worktree:`/`Domain:` block. **Worktree items:** the reviewed changes live on the item branch in that worktree — every command below runs inside it. The worktree teardown on archive refuses while it is dirty, so uncommitted review-relevant changes are a finding, not a footnote.

Create the run folder: `<item>/reviews/<executionId>/`. Every file this review produces goes there; a re-review after a repair loop gets a new execution id and a new folder, so old evidence is never mistaken for current.

## 2. Establish the facts — mechanical, before any reviewer

Facts are what the reviewer judges from; they are never a verdict.

**Baseline.** Read the `## Baseline` section of `tasks.md` (starting HEAD plus pre-existing working-tree changes); under `kf drive`, kf wrote it. `BASE` is that HEAD, else the branch point (`git merge-base origin/<default> HEAD`). The review covers `BASE..HEAD` plus untracked, non-ignored files. Preserve unrelated pre-existing changes; they are not this item's.

**Static checks.** Detect the real tooling from the repository (never assume `npm`), then run lint, build/typecheck and the suite in the worktree, recording each command, its exit code and the counts it printed. A suite that ran nothing is not a pass — report the count. Confirm the testing report is `PASS` for the current execution id.

**Regression tests fail on the baseline (bugs, and any task that fixes behaviour).** A test that is green with the fix removed protects nothing. Run the new or changed test files against `BASE` in a throwaway worktree (`git worktree add <tmp> "$BASE"`, copy the test files in, run them, remove the worktree): they must fail there and pass on `HEAD`. Record `regression on BASE: <N> failed (expected), on HEAD: <N> passed` under `## Verified`; a test that passes on `BASE` is a HIGH finding you record directly.

**Anti-pattern scan on added code lines** (prose files excluded — a skill that documents the scan is not a hit) — each hit is a HIGH finding you record directly, with the line as evidence:

```bash
ADDED_LINES=$(git diff "$BASE" -- . ':(exclude)*.md' | grep '^+' | grep -v '^+++')
printf '%s\n' "$ADDED_LINES" | grep -nE '^\+(<<<<<<<|>>>>>>>)'            # conflict marker
printf '%s\n' "$ADDED_LINES" | grep -nE '\.only\(|fdescribe\(|fit\('         # focused test locks out its siblings
printf '%s\n' "$ADDED_LINES" | grep -nE '(^|[^A-Za-z_])debugger([^A-Za-z_]|$)'
```

A failing build, lint or suite, or a conflict marker, **short-circuits**: write the report with those findings, `status: FAIL`, and skip the reviewer dispatch — no model budget on a tree that does not build.

**Rules.** Resolve rule files per filename in project → user → package order: `{project_root}/.kf/review/rules/*.md`, `~/.kf/review/rules/*.md`, `kanban-flow/review/rules/*.md` beside the installed CLI's package.json. Include general, security and performance plus the project's stack rule when installed (`kf rules` installs the stack packs; they are not auto-loaded from `kanban-flow/review/stacks/`). If no rule source is available, the report says so instead of silently skipping. The rules go into the pack as paths; the reviewer reads them.

## 3. Size the diff and pick the tier

Compute `ADDED` (code lines only — lockfiles, snapshots and build output excluded), `SHARED` and `CRITICAL` as `references/review-tiers.md` shows, then:

```bash
bash <this skill dir>/scripts/select-tier "$ADDED" "$SHARED" "$CRITICAL"   # line 1 = T1|T1C|T2|T3, line 2 = reason
```

Print the tier, the reason, the excluded line count and why `CRITICAL` is 0 or 1 in the report. Over 2000 lines: bundle per `references/review-tiers.md` before dispatching — a report note, never a question to the human.

## 4. Write the review pack

```bash
bash <this skill dir>/scripts/review-package "$BASE" HEAD <item>/reviews/<id>/review-<base7>..<head7>.diff --untracked
```

Then write `<item>/reviews/<id>/pack.md` with the six blocks `references/reviewer-brief.md` describes — Intent (requirement, plan, UC/TC paths; for a bug the report and its sibling entry points), Diff (the package path), Verified (step 2's real commands and output, the test files that ran, **the changed behaviour no test touches**), Rules (paths), Deferred (verbatim `minor (deferred)` and `parked` lines from `<item>/loop/progress.md`, or "no ledger"), Baseline. Paths, not pasted artifacts.

Write `## Verified` as numbers and names, never as "✅ tests pass": a verdict invites agreement; facts let the reviewer ask whether the tests are adequate.

## 5. Dispatch the independent reviewer(s)

Follow `references/reviewer-brief.md` exactly: the doctrine path to read first, the pack path, the schema path, and **the model named on every dispatch**. The reviewer has no write tool: **its reply is its report**, and you save each reply verbatim to `<item>/reviews/<id>/reviewer-<dimension>.md` before reading the next one.

- **T1:** one `Agent(code-reviewer)` on `sonnet`, all dimensions.
- **T1C:** T1 plus one `contracts` reviewer on `sonnet` — two dispatches.
- **T2:** five in **one message** — `bugs`, `security`, `perf`, `contracts`, `intent` — on `sonnet`; `contracts` on `opus` when `SHARED=1`.
- **T3:** the same five, all on `opus`.

Collect each reply **by name**; a reviewer that finishes without one is an incomplete gate — ask it for the report, and if none comes, the review is incomplete, not clean. Never review the diff yourself in parallel "to be safe"; never pre-judge a finding in the brief.

**Stand-ins.** When the runtime has subagents but no `code-reviewer` registered (an upgrade that relinked the skills before `kf install`, or a non-Claude runtime), dispatch a general-purpose subagent whose brief pastes the agent body from `<skills dir>/kanban-flow/agents/code-reviewer.md` verbatim and states that it must not write, edit or run anything; record `stand-in: general-purpose` for that reviewer in the report's `## Reviewer` section, because a stand-in's read-only limit is a request, not a guarantee. **When the runtime has no subagent tool at all, this session cannot complete the review**: a session does not grade its own work. Hand the stage to a runner role (`kf run <feature> --role reviewer`, configured in `harness.stages.review`) or stop and tell the human; a report written without an independent reviewer is never `PASS`.

For `kind: bug`, the brief adds: review against the bug report and existing feature behaviour; check reproduction evidence, regression tests and fix scope; list the sibling entry points and whether the fix covers each; state a claim you tried to break. Do not demand feature planning artifacts for a bug.

## 6. Verify the evidence and merge

```bash
# every reviewer's JSON array concatenated into one file
node <this skill dir>/scripts/verify-findings.mjs <worktree> <item>/reviews/<id>/findings.json > <item>/reviews/<id>/verified.json
```

Dedup by `title + file` keeping the highest severity. A finding whose `evidence` quote is not in the cited file is **refuted**: list it under "refuted at verification" in the report and do not count it. Carry every `Declined:` line and every `Deferred:` verdict into the report.

Do not reopen findings an earlier review verified and do not undo user-chosen scope, libraries or thresholds. A security finding without a reachable attack path is LOW; the reviewer should have threat-modelled it — if it did not, record that as the reason for the downgrade.

## 7. Write review-report

```bash
kf instruct review-report --change {feature_name}
```

Fill `phase-5-review-report.md`. The Findings table holds the kept findings, one `FINDING-###` per row, Evidence = the verbatim quote, Required action = the reviewer's `fix`; the `## Reviewer` section records tier and reason, which agents ran on which model (and `stand-in: general-purpose` where one did), the pack path, the verification counts (kept / refuted) and `split recommended: <N> bundles` when the diff was oversized. Set `execution:` to the current id and keep Review Status / Final Decision consistent with the frontmatter `status:`, exactly one of:

- `PASS` — no open HIGH finding, no `Deferred` item marked must-fix-before-merge, and every MEDIUM assessed against acceptance criteria and the Definition of Done. Do not declare PASS merely because there are no HIGH findings.
- `FAIL` — an open HIGH finding, a failed static check, or broken tests.
- `REJECT` — the change does not meet the DoD or acceptance criteria although it builds and its tests pass.
- `REQUIREMENT_BUG` — an `intent` finding shows the requirement itself is wrong against the real product need. This is the orchestrator's call on the reviewer's evidence; the reviewer does not set it.

For a bug, also record the verified root cause and whether related feature docs need an update — when none, say why.

## 8. The directional gate decides

- `PASS` → ask the human once: **ship or archive directly?** Ship (code item, PR/release wanted) → load kanban-ship and `kf stage <f> shipping`. Nothing to ship (docs/config/research) → load kanban-archive and `kf archive` straight from review.
- `FAIL`/`REJECT` → **structural fix needed**: loop back, re-implement through `kanban-implement` with the kept findings as the repair brief, then the feature must be **re-tested before review again** (kanban-test, new execution id). The orchestrator never fixes findings itself.

```bash
kf stage {feature_name} implementation
```

- `REQUIREMENT_BUG` → **STOP FEATURE.** Do not silently rewrite the requirement — report what the review found and ask how to proceed. `kf stage` blocks all movement here by design.

---

## References

- `references/reviewer-doctrine.md` — pasted at the top of every reviewer brief.
- `references/finding-schema.md` — the one shape every reviewer returns; how findings become report rows.
- `references/review-tiers.md` — `ADDED`/`SHARED`/`CRITICAL`, the tier rule, bundling, why tiers.
- `references/reviewer-brief.md` — the dispatch template and the pack layout.
- `scripts/review-package`, `scripts/select-tier`, `scripts/verify-findings.mjs` — run with `bash`/`node`; installs do not set the exec bit.

## Done

A decisive report written from verified findings. Hand off:

```text
If PASS: ship gate — kanban-ship when there is something to deliver, kanban-archive when there is not.
If FAIL/REJECT: load kanban-implement with the kept findings (then kanban-test before returning here).
If REQUIREMENT_BUG: stop and report to the user.
```

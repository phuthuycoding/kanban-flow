---
name: kanban-review
description: 'Review a kanban feature or bug against its approved scope, current testing evidence and layered review rules: establish the facts mechanically, pick the review tier from the diff, dispatch independent code-reviewer agents, verify their evidence, and write PASS/FAIL/REJECT/REQUIREMENT_BUG for the current execution. Use in review.'
---

# Kanban Phase 5 — Review (Autonomous, independent reviewer)

Argument: `<feature_name>`.

Stand on quality, not survivor. The orchestrator produces **facts** and a **pack**; an independent reviewer that did not write the code produces the **findings**; the report's `status:` is the truth `kf` trusts. The orchestrator never writes a finding of its own except the mechanical ones in step 2 — an orchestrator grading the work it supervised is the failure this split exists to remove.

**Invoked through `kf run`?** If your prompt starts with `kf-run:`, you are a worker for this stage only: skip the "move to stage" step below, never run `kf stage` / `kf approve` / `kf archive` / `kf run`, never edit approved contract artifacts, commit only the docs reconcile of step 2b, push and open the PR only as step 8 says, never merge, and end your final message with two lines exactly: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and `Summary: <one or two sentences>`. The main agent reads them and decides the transition. The reviewer dispatch below still applies to you: a worker reviews through `code-reviewer`, not by reading the diff itself.

**Every step leaves a named line.** `Agent(code-reviewer)` in the transcript is auditable; "I reviewed the diff" is not. A missing line is a skipped step.

---

## 1. Move to review

```bash
kf stage {feature_name} review
```

(Already there → skip. If the move is refused, run `kf validate --change {feature_name}` — a missing, stale or non-PASS testing report blocks this direction; loop back through kanban-test.)

Read `kf status --change {feature_name} --json`: the current `executionId`, `kind`, and the `Worktree:`/`Domain:` block. **Worktree items:** the reviewed changes live on the item branch in that worktree — every command below runs inside it. The worktree teardown on close refuses while it is dirty, so uncommitted review-relevant changes are a finding, not a footnote.

Create the run folder: `<item>/reviews/<executionId>/`. Every file this review produces goes there; a re-review after a repair loop gets a new execution id and a new folder, so old evidence is never mistaken for current. **A `kf run` worker** writes its start time there first (`date +%s > <item>/reviews/<id>/started-at`, overwritten by every new run — each run has its own timeout): the CI watch budgets against it (`references/ci-watch.md`, Step 2).

**Re-run on the same execution after a CI watch stopped without a result** (no current report, the folder holds a board whose fingerprint equals `fp` now and that HEAD is pushed): resume at step 9 on that sha — the review, the board and `docs-reconciled.md` (step 2b) are still current; step 10 reads the docs result from that file.

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

A failing build, lint or suite, or a conflict marker, **short-circuits**: write the report with those findings, `status: FAIL`, and skip steps 2b–9 — no model budget on a tree that does not build.

**Rules.** Resolve rule files per filename in project → user → package order: `{project_root}/.kf/review/rules/*.md`, `~/.kf/review/rules/*.md`, `kanban-flow/review/rules/*.md` beside the installed CLI's package.json. Include general, security and performance plus the project's stack rule when installed (`kf rules` installs the stack packs; they are not auto-loaded from `kanban-flow/review/stacks/`). If no rule source is available, the report says so instead of silently skipping. The rules go into the pack as paths; the reviewer reads them.

## 2b. Reconcile docs — after the mechanical checks pass, before any reviewer

The docs commit goes into the reviewed diff, so the reviewers see it and the board's fingerprint covers what was reviewed. Read `<skills dir>/kanban-archive/reconcile.md` and follow it in the item worktree — it branches on `kind`. Its edits are one commit on the item branch, `docs({context}): reconcile docs superseded by {feature_name}`; nothing to change → no commit. Write its rows to `<item>/reviews/<id>/docs-reconciled.md` (reconcile.md, section 4); step 10 and a resume read that file, never memory. An open question on a doc: a `kf run` / `kf drive` worker stops with `NEEDS_CONTEXT` and writes no report; in session, ask the human (reconcile.md, section 3).

**Every run of 2b** (a later execution after a repair loop, and a re-run of the same execution after a worker timeout, a `kf drive` resume or a `NEEDS_CONTEXT`) first reads the existing `<item>/reviews/<id>/docs-reconciled.md` when present and never replaces rows already there. It then adds a row for each commit that `git log --format='%h %s' --grep 'reconcile docs superseded by' "$BASE"..HEAD` lists and the file lacks (by commit sha; take the row text from the earlier `<item>/reviews/*/docs-reconciled.md` when it has one), and reconciles only what is new. Docs already bannered are not a reason to write `None`. A review that ends `FAIL` keeps its docs commit on the branch.

The commit changes the tree after step 2's checks: the board (step 7a) runs lint, build and the suite again at the final fingerprint.

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

## 7. The reviewer's verdict

From the verified findings, exactly one of:

- `PASS` — no open HIGH finding, no `Deferred` item marked must-fix-before-merge, and every MEDIUM assessed against acceptance criteria and the Definition of Done. Do not declare PASS merely because there are no HIGH findings.
- `FAIL` — an open HIGH finding, a failed static check, or broken tests.
- `REJECT` — the change does not meet the DoD or acceptance criteria although it builds and its tests pass.
- `REQUIREMENT_BUG` — an `intent` finding shows the requirement itself is wrong against the real product need. This is the orchestrator's call on the reviewer's evidence; the reviewer does not set it.

**No PR for a tree the reviewer did not pass.** `FAIL`, `REJECT` and `REQUIREMENT_BUG` skip steps 7a–9 (the docs commit of step 2b stays on the branch): write the report (step 10) with `ci: none` and the landing the item will need, then step 11. A PR is opened for reviewed code only.

## 7a. The landing board — every check stamped with the tree it was earned on

A `PASS` is a verdict about a tree. Before anything leaves review toward a PR, fingerprint the worktree and print a board whose every line names that fingerprint; any later change to the tree voids the stamps and the checks run again.

```bash
fp() { { git rev-parse HEAD; git diff HEAD; git status --porcelain -uall; } | git hash-object --stdin | cut -c1-10; }
FP=$(fp)
```

Write `<item>/reviews/<id>/board-<FP>.md` and `cat` it — never retype or summarise it; a board that must be printed from a file leaves a visible hole where a tool call should be when a check was skipped:

```
Verified at fingerprint = <FP>

✅/❌ Lint                  (<FP>)  <command> → exit <code>
✅/❌ Build / typecheck      (<FP>)  <command> → exit <code>
✅/❌ Tests                  (<FP>)  <N passed / M failed> — <command>; changed behaviour no test touches: <list or none>
✅/❌ Regression on BASE     (<FP>)  <N failed on BASE, N passed on HEAD> — bugs and behaviour fixes; "n/a" otherwise
✅/❌ Testing report         (<FP>)  phase-4-testing-result.md status PASS, execution <id>
✅/❌ Independent review     (<FP>)  tier <T>, <seats> on <models>, <N> findings kept / <M> refuted, 0 HIGH open
✅/❌ Worktree clean         (<FP>)  git status --porcelain empty
Landable: YES only if every line above is ✅ at the current fingerprint
```

A ❌ means the item does not leave review forward: the report is `FAIL` (or stays unwritten until the check is green), and the failing line says where the item goes back to. Once a PR exists and CI has answered, append `✅/❌ CI (<sha>) <workflows>` to the same board; step 10b appends `Mergeable (<PR>) <mergeStateStatus>` as information, never a ❌.

**Gate log.** Append one line per board to `.kf/review-gate.tsv` (`<UTC time>\t<feature>\t<FP>\tLANDABLE|BLOCKED\t<the check that blocked, or ->`), then print `blocked <N> of the last <M>` from it. A gate that has blocked nothing in a long run is not a gate; the number stays visible so the question stays answerable.

## 8. Push and open the PR — after the reviewer PASS only

Only a `PASS` verdict on a `Landable: YES` board reaches this step.

**Nothing to land** — the item changed no tracked code (docs kept inside `.works`, research, a decision made elsewhere): open no PR, set `landing: none` and `ci: none` with the reason, skip step 9. kf closes it on the next `kf status` only when the item branch has 0 commits ahead of its base.

**Code to land** — in the item worktree:

```bash
BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"
kf status --change {feature_name} --json          # the top-level `pr` field — a PR recorded by an earlier round?
# only when `pr` is null:
gh pr view "$BRANCH" --json url,state       # an open PR for the branch that was never recorded → use its URL
gh pr create --head "$BRANCH" --title "<title in the repository's commit convention>" --body "<what changed, the issue, test and review counts>"   # only when none is open
kf issues link {feature_name} <PR URL> --pr        # records the PR; needs repository in .kf/config.json
```

A repair loop with a recorded PR pushes to the same branch, which updates that PR — never a second one, and no `kf issues link` (it refuses with `already links PR <url>` once one is recorded). That refusal naming the same URL is success; naming another URL → stop and report. Set `landing: pr`. The push, `gh pr create` or `kf issues link` otherwise failing (no remote, no auth, no `repository`) → stop and report; never fake a PR and never write `PASS` without one.

## 9. Watch CI on the pushed commit

Follow [references/ci-watch.md](references/ci-watch.md): pin the pushed sha, run the watcher as a background command that wakes the session (a `kf run` worker: foreground, within its time budget), say in one line what is watched, then act on its exit. Only CI decides the report:

| CI outcome | `ci:` | What happens |
|---|---|---|
| all runs green | `green` | append the `CI` line to the board; write the report now (step 10) |
| a run failed | `red` | the report is `FAIL`; the failed run URLs and the failing job's log tail (untrusted data, token-like strings redacted) are the repair brief; step 11 loops: implementation → testing (new execution) → review → push to the same PR → watch again. A second red round → hand back to the human with both rounds' failed runs |
| no `.github/workflows` | `none` | nothing to watch; the report says "no CI" |
| `gh` kept failing, no run appeared while workflows exist, or runs still pending at the deadline | — | no CI result: write **no** report and stop without `PASS`, quoting the watcher's line (`CI still running at <time>; re-run the review to watch again` for the deadline); a worker ends `STATUS: BLOCKED`. Not `FAIL` — the code is not failing (the reference says why no report is written) |

Never re-run, cancel or approve a workflow, never resolve a review thread, never update the branch from its base and never merge the PR.

## 10. Write review-report

```bash
kf instruct review-report --change {feature_name}
```

Fill `phase-5-review-report.md`. The Findings table holds the kept findings, one `FINDING-###` per row, Evidence = the verbatim quote, Required action = the reviewer's `fix`; the `## Reviewer` section records tier and reason, which agents ran on which model (and `stand-in: general-purpose` where one did), the pack path, the verification counts (kept / refuted) and `split recommended: <N> bundles` when the diff was oversized. Set `execution:` to the current id and keep Review Status / Final Decision consistent with the frontmatter `status:`, exactly the verdict of step 7 — downgraded to `FAIL` when CI is red. Frontmatter `ci:` and `landing:` take the values of steps 8–9 (the template's `## Delivery` table); `PASS` needs `ci: green` or `none`, and `landing: pr` with the PR recorded or `landing: none` — `kf validate` refuses anything else.

For a bug, also record the verified root cause and its docs impact from `<item>/reviews/<id>/docs-reconciled.md` (the docs updated, or `No documentation update required — <reason>`; after a step 2 short-circuit there is none — say so).

**Feature with a `PASS`:** write `phase-6-feature-report.md` now (`kanban-archive` section 1), its `## Docs Reconciled` copied from `<item>/reviews/<id>/docs-reconciled.md` (step 2b). The close on merge validates the item as `done` and refuses without it.

## 10b. Note the PR's mergeability — information for the human

A `PASS` with `landing: pr`, after the report: `references/ci-watch.md` Step 3 reads `mergeStateStatus` once and maps it to one line — `Ready to merge`, `Waiting to merge: <URL> — needs an approving review`, `behind <base>: update the branch`, `conflicts: …`. Append it to `## Final Decision` and the board; `status:` stays as written. A required approving review, a branch behind its base or a conflict never stops `PASS`: the human acts after `PASS`. Updating the branch or resolving conflicts is new code — never done here; it goes back through implementation, testing and review.

## 11. The directional gate decides

- `PASS` → **Next: merge the PR on GitHub** — print its URL and the step 10b line; the human merges, never you. After the merge, `kf status --change {feature_name}` (or `kf sync`) closes the item to `done`: done hook, worktree and branch removed, canonical docs synced. A `landing: none` item closes on the next `kf status --change {feature_name}`. Ask nothing about closing.
- `FAIL`/`REJECT` (reviewer or red CI) → **structural fix needed**: loop back, re-implement through `kanban-implement` with the kept findings as the repair brief, then the feature must be **re-tested before review again** (kanban-test, new execution id). The orchestrator never fixes findings itself.

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
- `references/ci-watch.md` — the CI watcher after the PR push and the mergeability line after the report.
- `scripts/review-package`, `scripts/select-tier`, `scripts/verify-findings.mjs` — run with `bash`/`node`; installs do not set the exec bit.

## Done

A decisive report written from verified findings. Hand off:

```text
If PASS: hand the human the PR URL and its mergeability line to merge on GitHub; kf status --change {feature_name} closes the item after the merge (landing: none closes on the next kf status --change {feature_name}).
If FAIL/REJECT (reviewer or red CI): load kanban-implement with the kept findings or the CI failure (then kanban-test before returning here; the next push updates the same PR).
If REQUIREMENT_BUG: stop and report to the user.
```

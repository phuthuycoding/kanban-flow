---
name: archive
description: 'Close a PASS-reviewed feature or bug: kf status / kf sync close it once its PR is merged, kf archive is the explicit idempotent form. Features require a completion report (written at review PASS); living docs under docs/specs/ are edited in review and the close copies nothing under docs/. Use at review PASS for the feature report, or when completing closure in done.'
---

# Kanban Phase 6 — Artifact (Autonomous)

Argument: `<feature_name>`.

Close the work item with traceable results and the appropriate documentation.

**Closing is internal — nobody is asked for it.** Once the human merges a review-PASS item's recorded PR on GitHub, `kf status --change {feature_name}` (or `kf status --all`), `kf sync` or `kf archive` closes it; a `landing: none` item closes when its branch has 0 commits ahead of its base. `kf archive` is the explicit form of the same transaction: it refuses while a recorded `pr` is not verifiably merged (exit 1, no side effects, no `--force` escape). Until the merge, the item waits in `review`, listed under `Waiting to merge` in `kf status --all`. The close moves it to `done`, closes the issue, moves the board and stamps `delivered` — all idempotent, so a re-run reconciles.

---

## 1. Prepare closure artifacts

```bash
kf status --change {feature_name}
kf status --change {feature_name} --json
```

Require current PASS testing and review reports. Read `kind` before choosing closure work:

- Feature: use `kf instruct feature-report --change {feature_name}` and write `phase-6-feature-report.md` in the review folder. Include actual changes, test/review evidence, documentation manifest, limitations and accepted follow-ups.
- Bug: no feature report or feature planning artifacts are required. Read the bug report and review result; confirm the verified fix, regression evidence and docs impact.

Write the feature report at review PASS (`kf:review` step 10): the close validates the item as `done` and refuses without it. If already in done, complete only missing closure work and validate; never reimplement.

## 2. Docs

The close writes nothing under `docs/`: no requirement, use-case or test-plan copy, for a feature or a bug. Brainstorm writes nothing under `docs/` either. Do not change approved source artifacts during closure.

### 2b. Living docs (mandatory, in review)

`docs/specs/` must describe the system as it is after this feature. This runs in review, not at the close — the close is silent inside `kf status` / `kf sync` and loads no skill: `kf:review` step 2b reads [reconcile.md](reconcile.md) and follows it in the item worktree before the code-reviewer dispatch, edits the living docs the plan's `## Documentation Impact` names (one `## History` line each), consolidates the legacy features it lists as `consolidates:`, and commits the edits on the item branch (the reviewers see them and they go into the PR). The review report records `docs: updated` or `docs: none` with `docs_reason`; the feature report written at step 10 lists the living docs in `## Docs Reconciled` (`None — <reason>` when nothing is affected). The legacy snapshots under `docs/requirement`, `docs/use-cases` and `docs/testplan` are never bannered or rewritten here; `kf:docs` consolidates the rest.

For a bug, the same review step edits the existing living doc the bug report names and the changelog entry, or records `docs: none` with the reason in the review report ([reconcile.md](reconcile.md), "A bug"). A bug never creates a living doc.

## 3. Close and validate

```bash
kf status --change {feature_name}   # closes a review-PASS item whose PR merged
kf archive {feature_name}           # the explicit form of the same close; idempotent
kf validate --change {feature_name}
```

The close requires current PASS reports, verifies the recorded PR is merged (or, with `landing: none`, that the branch has 0 commits ahead of its base), refuses while the item worktree is dirty, runs the done hook — which closes the issue and moves the board to `statusMap.done` — removes the item worktree, deletes the merged branch locally and on origin, moves review → done and stamps `delivered`/`deliveredAt` last. An item approved before living docs whose PASS report records no `docs:` still closes, with the warning `⚠ <feature>: no living doc recorded (approved before living docs)`. If it refuses on an unmerged PR, the item is not done — the human merges it first. Other refusals:

- **PR closed without merge** — the item stays in review: report it and ask. The human reopens the PR, or opens a new one and records it with `kf issues link {feature_name} <new PR URL> --pr --replace` (`--replace` is allowed only when the recorded PR was closed unmerged).
- **Done hook refused** — unticked acceptance criteria on the linked issue stop the close. Report which, and ask the human: they tick them, or approve `kf archive {feature_name} --skip-hooks`, a recorded bypass.
- **Local branch past the merged head** — the item branch has commits the merged PR does not; the close refuses rather than delete them. Report the commits and ask.

`kf sync` closes a `landing: none` item even when `.kf/config.json` sets no `repository`. Validate after archive. Do not report completion if validation fails.

Re-running the close on an item already in done rewrites no docs. Only a docs branch an earlier release recorded (`meta.docsBranch`) is still handled: the close waits on it, records it as landed once it is on origin's default branch, or commits its docs again to a fresh docs branch when they never landed.

## 4. Git handoff

```bash
git status
```

The close runs after the change merged and writes no docs, so it leaves nothing to commit: the living docs of step 2b already merged with the PR, as the `docs({context}): update living docs for {feature_name}` commit (feature or bug). The one exception is a legacy docs branch an earlier release recorded (`meta.docsBranch`, an unpushed `docs/<context>-<feature>` branch): push it and open its PR only when the user requested it or project instructions require it; until then `kf status --all` lists it under `Waiting to merge`.

A living-docs update owed by an item already in done is a change of its own: make it on its own branch and PR when the user requested it or project instructions require it. Include only this work item's changes, respect ignored .works directories and preserve unrelated working-tree changes. Otherwise report that changes are uncommitted.

---

## Done

Pipeline complete. Deliver the final report:

```text
## Pipeline Complete: {context}/{feature_name}
1. ✓ Confirm — requirement or bug triage
2. ✓ Plan — approved feature contract or lightweight bug contract
3. ✓ Implement — {M}/{M} tasks
4. ✓ Test — {N}/{N} passed
5. ✓ Review — PASS, PR {url or landing: none}, ci {green|none}
6. ✓ Close — merged on GitHub, done; living docs: {docs: updated, list | none, docs_reason}

Artifacts: .works/done/{feature_name}_{timestamp}/
Living docs:
- docs/specs/{context}/<capability>.md (each one step 2b created or updated)
- consolidated: {context}/<legacy feature> (each one removed into a living doc)
```

List only the living docs actually updated, or the review report's `docs_reason` when none were. Report the commit SHA only if a commit was made.

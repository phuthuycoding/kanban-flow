---
name: archive
description: 'Close a PASS-reviewed feature or bug: kf status / kf sync close it once its PR is merged, kf archive is the explicit idempotent form. Features require a completion report (written at review PASS) and canonical docs; bug docs are updated in review and the close changes none. Use at review PASS for the feature report, or when completing closure in done.'
---

# Kanban Phase 6 — Artifact (Autonomous)

Argument: `<feature_name>`.

Close the work item with traceable results and the appropriate documentation.

**Closing is internal — nobody is asked for it.** Once the human merges a review-PASS item's recorded PR on GitHub, `kf status --change {feature_name}` (or `kf status --all`), `kf sync` or `kf archive` closes it; a `landing: none` item closes when its branch has 0 commits ahead of its base. `kf archive` is the explicit form of the same transaction: it refuses while a recorded `pr` is not verifiably merged (exit 1, no side effects, no `--force` escape). Until the merge, the item waits in `review`, listed under `Waiting to merge` in `kf status --all`. The close moves it to `done`, syncs canonical docs, closes the issue, moves the board and stamps `delivered` — all idempotent, so a re-run reconciles.

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

## 2. Sync docs

For a feature, let the close copy requirement, UC index/files/diagram and test plan/current result into canonical docs. The requirement under `docs/requirement/` is written here, from the Phase 1 artifact; brainstorm writes nothing under `docs/`. Every canonical copy except the test result is stamped `status: archived`, and the UC index rows flip from `planned` to `implemented`. Do not manually copy the UC index/files, diagram or test plan before archive, and do not change approved source artifacts during closure.

### 2b. Reconcile superseded docs (mandatory, in review)

`docs/` must describe the system as it is after this feature, not as each older feature left it. This runs in review, not at the close — the close is silent inside `kf status` / `kf sync` and loads no skill: `kf:review` step 2b reads [reconcile.md](reconcile.md) and follows it in the item worktree before the code-reviewer dispatch, commits the edits on the item branch (the reviewers see them and they go into the PR), and writes the result to `reviews/<execution-id>/docs-reconciled.md`, which the feature report written at step 10 copies into `## Docs Reconciled` (`None — <reason>` when nothing is affected). The procedure: find earlier canonical docs and `docs/workflow/*` that describe behavior this feature changes, mark contradicted snapshots with a `Superseded by` banner, bring workflow docs up to date. Never rewrite another feature's snapshot body. Refreshing an item already in done whose `## Docs Reconciled` is missing or empty: run it now, in the place section 4 names.

For a bug, the same review step updates related feature docs and the changelog entry, or records `No documentation update required — <reason>` in the review report ([reconcile.md](reconcile.md), "A bug"). The close changes no bug docs and creates no canonical feature docs.

## 3. Close and validate

```bash
kf status --change {feature_name}   # closes a review-PASS item whose PR merged
kf archive {feature_name}           # the explicit form of the same close; idempotent
kf validate --change {feature_name}
```

The close requires current PASS reports, verifies the recorded PR is merged (or, with `landing: none`, that the branch has 0 commits ahead of its base), refuses while the item worktree is dirty, runs the done hook — which closes the issue and moves the board to `statusMap.done` — removes the item worktree, deletes the merged branch locally and on origin, syncs canonical docs for a feature, moves review → done and stamps `delivered`/`deliveredAt` last. Bugs skip canonical docs. If it refuses on an unmerged PR, the item is not done — the human merges it first. Other refusals:

- **PR closed without merge** — the item stays in review: report it and ask. The human reopens the PR, or opens a new one and records it with `kf issues link {feature_name} <new PR URL> --pr --replace` (`--replace` is allowed only when the recorded PR was closed unmerged).
- **Done hook refused** — unticked acceptance criteria on the linked issue stop the close. Report which, and ask the human: they tick them, or approve `kf archive {feature_name} --skip-hooks`, a recorded bypass.
- **Local branch past the merged head** — the item branch has commits the merged PR does not; the close refuses rather than delete them. Report the commits and ask.

`kf sync` closes a `landing: none` item even when `.kf/config.json` sets no `repository`. Validate after archive and check reported canonical destinations for a feature. Do not report completion if validation fails.

When refreshing an item already in done, canonical docs may include later bug fixes. If the CLI reports changed canonical docs, preserve them with `--skip-specs`; do not use `--force` to restore an older snapshot without explicit user direction — a forced overwrite is recorded as a bypass.

## 4. Git handoff

```bash
git status
```

The close runs after the change merged, so its output is a docs-only change, written to exactly one place and printed: the working tree when the repository has no `origin` or `origin/HEAD` is not set (the output says so), or when the primary checkout is on the default branch, not behind origin, with no uncommitted changes to tracked files (untracked files do not count); otherwise an unpushed `docs/<context>-<feature>` branch cut from `origin/<default>` (`meta.docsBranch`), leaving the primary working tree untouched. The reconciled docs of step 2b already merged with the PR; only a reconcile run late for an item already in done goes to the same place — for a docs branch, `git worktree add <tmp> docs/<context>-<feature>`, edit and commit there, then remove the temporary worktree. Push the docs branch and open its PR only when the user requested it or project instructions require it; until then `kf status --all` lists it under `Waiting to merge`. Commit messages:

- Feature: `docs({context}): sync canonical docs for {feature_name}` — the canonical copies (plus a late step 2b reconcile, when one ran here).
- Bug: none — its related-docs update was the review-time reconcile commit, merged with the PR.

In the working-tree case, commit on its own branch and PR when the user requested it or project instructions require it. Include only this work item's changes, respect ignored .works directories and preserve unrelated working-tree changes. Otherwise report that changes are uncommitted.

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
6. ✓ Close — merged on GitHub, done; docs sync/update status ({path or docs branch}), docs reconciled: {list or None}

Artifacts: .works/done/{feature_name}_{timestamp}/
Feature canonical docs:
- docs/requirement/{context}/{feature_name}.md
- docs/use-cases/{context}/{feature_name}/README.md
- docs/use-cases/{context}/{feature_name}/UC-###(-<slug>).md (one file per use case)
- docs/use-cases/{context}/{feature_name}/diagram.md
- docs/testplan/{context}/{feature_name}.md
- docs/testplan/{context}/{feature_name}-result.md
```

For bugs, list only related docs actually updated, or state why none were needed. Report the commit SHA only if a commit was made.

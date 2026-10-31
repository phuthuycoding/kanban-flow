# Reconcile superseded docs

Canonical docs are per-feature snapshots. When a new feature changes behavior an older feature documented, the older snapshot keeps describing the old behavior unless it is marked. This step keeps `docs/` true to the system as it is after this feature. It runs in review (`kanban-review` step 2b) once the mechanical checks pass and before the code-reviewer dispatch, in the item worktree; the edits are one commit on the item branch, so the reviewers see them and they land with the PR.

**A bug** skips sections 1–3: update existing related feature docs only when the fix changes documented behavior or reveals inaccurate documentation, using the feature/context named in the bug report — never overwrite feature docs with bug-report content — and record the bug ID, fix summary and regression reference in the project's changelog or change-history section (e.g. `CHANGELOG.md`) when one exists. That is the one docs commit (section 4). Behavior already documented correctly → no edit, and the result is `No documentation update required — <reason>`. A bug never creates canonical feature docs.

## 1. List the behavior this feature changes

Read, from the work item:

- `## Affected surfaces` and `## Scope` in `phase-1-spec-requirement.md`
- `## Documentation Impact` in `phase-2-implementation-plan.md`
- the business rules and postconditions of each `use-cases/UC-###*.md`

Write down each changed behavior as a short phrase plus the commands, flags, files or terms it uses (e.g. "archive closes the issue" → `kf archive`, `issues done`, `close_issue`).

## 2. Find docs that still describe the old behavior

```bash
grep -rn -i "<term>" docs/requirement docs/use-cases docs/testplan docs/workflow README.md
```

Skip this feature's own canonical paths. For every hit, read the surrounding text and decide:

- **Contradicted** — the doc states behavior that is no longer true.
- **Still true** — the doc mentions the term but its statement holds.
- **Partly contradicted** — one rule, flow or test is no longer true.

## 3. Mark or update

| Doc | Action |
|---|---|
| Another feature's requirement, UC index, UC file or test plan (`docs/requirement`, `docs/use-cases`, `docs/testplan`) | Add a banner directly under the first heading. Do not rewrite its body — it is that feature's snapshot. |
| `docs/workflow/*`, `README.md`, other living docs | Rewrite the text to the current behavior. |
| Still true | Leave it. |

Banner format:

```markdown
> **Superseded by `<feature>`.** <one sentence: what changed and what the doc now gets wrong>. Kept for history.
```

For a partial contradiction, name only the replaced part: `> **Partly superseded by <feature>:** <rule/flow/TC> no longer holds — <current behavior>.`

When it is unclear whether the old behavior still exists, do not guess: an in-session agent asks the human; a `kf run` / `kf drive` worker writes no review report and ends `STATUS: NEEDS_CONTEXT`, naming the doc and the open question in `Summary:`.

- Before ending `NEEDS_CONTEXT`, the worker reverts its uncommitted reconcile edits (`git restore` the touched doc paths, named in `Summary:`), so the tree is clean for the next run.
- The human settles the question by committing the banner, or by writing the decision into `<item>/reviews/<id>/docs-reconciled.md`, then re-runs the review / `kf drive`.
- The next worker reads that file first and does not re-ask a doc already settled there.

A banner changes that feature's canonical docs, so a later `kf archive` of the older feature reports them as changed — re-archive it with `--skip-specs` to keep the banner.

## 4. Record

Commit the edits on the item branch: `docs({context}): reconcile docs superseded by {feature_name}` (a bug uses the same subject). Nothing touched → no commit.

Write `<item>/reviews/<execution-id>/docs-reconciled.md`: one row per doc touched (document, superseded/updated behavior, action, commit sha), plus the rows carried forward from an earlier round's reconcile commit (`kanban-review` step 2b). Nothing touched and nothing carried → `None — <reason>` (e.g. "None — new command, no earlier doc covers it"); for a bug, `No documentation update required — <reason>`. The review report (bug) and the feature report's `## Docs Reconciled` (feature, written at review PASS, `kanban-review` step 10) are filled from this file. The human reads that section with the PR; an empty or missing one means the step was skipped.

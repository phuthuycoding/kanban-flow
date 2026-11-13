# Update the living docs

`docs/specs/` is the current description of the system: one living doc per capability, `docs/specs/<context>/<capability>.md`, listed in the context index `docs/specs/<context>/README.md`. The legacy snapshots under `docs/requirement`, `docs/use-cases` and `docs/testplan` are history awaiting consolidation (`kf:docs`); nothing banners or rewrites them. This step brings the living docs to the system as it is after this feature, and consolidates a legacy feature when this feature touches it. It runs in review (`kf:review` step 2b) once the mechanical checks pass and before the code-reviewer dispatch, in the item worktree; the edits are one commit on the item branch, so the reviewers see them and they land with the PR. The close copies nothing under `docs/`.

**A bug** skips section 3: it edits the existing living doc under `docs/specs/<context>/` that the bug report names, only when the fix changes documented behavior or reveals inaccurate documentation — never overwriting it with bug-report content — and records the bug ID, fix summary and regression reference in the project's changelog or change-history section (e.g. `CHANGELOG.md`) when one exists. That is the one docs commit (section 4). A bug never creates a living doc: `kf validate` refuses a capability file the bug's branch adds (`docs_bug_new_spec`); the context index may be edited. Behavior already documented correctly → no edit, and the result is `docs: none` with the reason.

## 1. List the docs this feature changes

Read, from the work item:

- `## Documentation Impact` in `phase-2-implementation-plan.md` — each line is `docs/specs/<context>/<capability>.md` (a living doc to create or update), `consolidates: <context>/<feature>` (a legacy feature to fold in) or `none — <reason>`
- `## Affected surfaces` and `## Scope` in `phase-1-spec-requirement.md`
- the business rules and postconditions of each `use-cases/UC-###*.md`

Write down each changed behavior as a short phrase plus the commands, flags, files or terms it uses (e.g. "archive closes the issue" → `kf archive`, `kf status`, `close_issue_done`).

## 2. Edit the living docs

For each living doc the plan names:

- **New capability** — `kf instruct living-doc --change {feature_name}` prints the template and the path. Fill `## Purpose`, `## Current behaviour`, `## Use cases`, `## Surfaces` and `## History`, and link it under `## Capabilities` in the context index (`kf instruct living-doc-index --change {feature_name}` when the index does not exist yet).
- **Existing capability** — rewrite `## Current behaviour`, `## Use cases` and `## Surfaces` to the behavior after this feature. The doc says what is true now, not what changed.
- **Retired capability** — remove its file, drop its `## Capabilities` link and add it to `## Retired` in the index with the reason.

Every living doc this feature edits gets exactly one new `## History` line: `- <timestamp> — {feature_name}: <what changed>`. Never rewrite earlier History lines.

`docs/workflow/*`, `README.md` and other prose docs that state the changed behavior: rewrite the text to the current behavior. Find them with:

```bash
grep -rn -i "<term>" docs/specs docs/workflow README.md
```

When it is unclear whether the old behavior still exists, do not guess: ask the human, naming the doc and the open question.

## 3. Consolidate on touch

A legacy feature this feature changes is folded into a living doc instead of being marked:

1. Each `consolidates: <context>/<feature>` line of the plan names one. Move what is still true of its requirement, use cases and test plan into the living doc that now owns the behavior; drop what is obsolete.
2. Delete every file of that legacy feature: `docs/requirement/<context>/<feature>.md`, the folder `docs/use-cases/<context>/<feature>/`, `docs/testplan/<context>/<feature>.md` and `docs/testplan/<context>/<feature>-result.md`. Never half-remove one.
3. Name the token `<context>/<feature>` in the `## History` line of the living doc that took it over, or in the index's `## Retired` when nothing of it survives.

`kf validate` holds both halves: a planned consolidation with a legacy file left fails the PASS report (`docs_consolidation_incomplete`), and any legacy feature removed since the merge-base must be removed whole (`docs_legacy_half_removed`) and named in a `## History` or `## Retired` section (`docs_legacy_unnamed`). A legacy feature this feature contradicts but the plan does not consolidate stays as it is, for `kf:docs`.

## 4. Record

Commit the edits on the item branch: `docs({context}): update living docs for {feature_name}` (a bug uses the same subject). Nothing touched → no commit.

The review report's frontmatter records the result: `docs: updated` when this item's branch changes a file under `docs/specs/` (committed; `kf validate` checks the diff since the merge-base, `docs_updated_no_change`), or `docs: none` with a non-blank `docs_reason` (e.g. "new internal helper, no capability changes"). The feature report's `## Docs Reconciled` lists each living doc created or updated and each legacy feature consolidated; the human reads it with the PR.

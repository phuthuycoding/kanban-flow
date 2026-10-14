# Reconcile superseded docs

Canonical docs are per-feature snapshots. When a new feature changes behavior an older feature documented, the older snapshot keeps describing the old behavior unless closure marks it. This step keeps `docs/` true to the system as it is after this feature.

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

When it is unclear whether the old behavior still exists, ask the human; do not guess.

A banner changes that feature's canonical docs, so a later `kf archive` of the older feature reports them as changed — re-archive it with `--skip-specs` to keep the banner.

## 4. Record

Fill `## Docs Reconciled` in `phase-6-feature-report.md` with one row per doc touched (document, superseded/updated behavior, action). When no doc describes the changed behavior, write `None — <reason>` (e.g. "None — new command, no earlier doc covers it"). Review reads this section; an empty or missing one means the step was skipped.

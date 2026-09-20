# The artifact contract and how to read it

Artifacts are written inside the work item folder under `.works/`. Each file answers a different question; never use one report in place of another phase's.

## Reading order inside a work item

```text
phase-1-spec-requirement.md
├── phase-2-implementation-plan.md       (feature only)
├── phase-2-use-case-specification.md    (feature only: index + coverage)
├── use-cases/UC-###.md                   (feature only: one file per UC)
├── phase-2-use-case-diagram.md           (feature only)
└── phase-2-test-case.md                  (feature only: the test contract)
    └── phase-4-testing-result.md         (the outcome of one execution)
        └── phase-5-review-report.md      (review of that same execution)
            └── phase-6-feature-report.md (feature only: the handover)
```

A bug uses the `phase-1-bug-report.md` template but still stores its triage record at `phase-1-spec-requirement.md` so the CLI keeps working. Beyond that record a bug needs only the testing and review reports; the planning set and the feature report are not required. If behaviour appears beyond the scope of the defect fix, report the scope change and let the user decide whether a separate feature is warranted.

`phase-2-use-case-specification.md` is only an index. A feature's narrative belongs in `use-cases/UC-###.md`, and the ID in the file name must match the ID declared inside it. Every test case must trace `FR-###` → `UC-###`.

## Shared conventions

| Convention | What it means |
|---|---|
| Frontmatter | Identifies the work item, its context, its status and the current execution |
| Placeholder | Lives only in the template; every one must be replaced with real content before a gate |
| ID | `FR-###`, `UC-###`, `TC-###`, used consistently across every artifact |
| Report status | Testing: `PASS/FAIL/REJECT/BLOCKED`; review: `PASS/FAIL/REJECT/REQUIREMENT_BUG` |
| Execution | Testing and review must carry the same `executionId` as the current run |
| Summary tables | Totals must match the detail rows, not merely describe them |

The CLI checks the files, the placeholders, secret-like content, ID references, the approval fingerprint and each report's execution and status. Table totals, measured coverage and the quality of the narrative are the agent's job during planning, testing and review; a passing validator proves none of them.

## On archive into `dones`

`kf archive` leaves the artifact set in `.works/dones/{feature}_{timestamp}/` for audit. For a feature, the CLI copies the documents people actually read into the canonical docs:

| Canonical doc | Contents |
|---|---|
| `docs/requirement/{context}/{feature}.md` | The archived requirement |
| `docs/use-cases/{context}/{feature}/README.md` | The UC index and coverage |
| `docs/use-cases/{context}/{feature}/UC-###.md` | Each use case narrative |
| `docs/use-cases/{context}/{feature}/diagram.md` | The actor and use case diagram |
| `docs/testplan/{context}/{feature}.md` | The test plan and the coverage matrix |
| `docs/testplan/{context}/{feature}-result.md` | The most recent execution result |

For a bug, archive neither creates nor overwrites an existing feature's docs. The archive skill updates the related docs only when the bug report states a docs impact; when there is none, it says "No documentation update required" in the closure or review.

Archiving a feature that is already in `dones` refuses to overwrite canonical docs that have changed since the snapshot, so updates from a bug or from extra documentation survive. Use `--skip-specs` to leave the docs alone; use `--force` only when restoring the old snapshot is what you actually want.

## Checklist before closing

- [ ] The requirement or bug report is `confirmed` and free of placeholders.
- [ ] Feature: four planning artifacts, one file per UC, and a test matrix whose IDs line up.
- [ ] Bug: a triage record carrying the reproduction, the severity and the regression strategy.
- [ ] Testing and review both `PASS`, on the current execution.
- [ ] The feature report records what changed, which tests ran, which docs moved and what limits remain. Not required for a bug.
- [ ] Canonical docs synced where needed, and no database, deploy or publish action outside the approved scope.

# The artifact contract and how to read it

Artifacts are written inside the work item folder under `.works/`. Each file answers a different question; never use one report in place of another phase's.

## Reading order inside a work item

```text
phase-1-spec-requirement.md
├── phase-2-implementation-plan.md       (feature only)
├── phase-2-use-case-specification.md    (feature only: index + coverage)
├── use-cases/UC-###-<slug>.md            (feature only: one file per UC)
├── phase-2-use-case-diagram.md           (feature only)
└── phase-2-test-case.md                  (feature only: the test contract)
    └── phase-4-testing-result.md         (the outcome of one execution)
        └── phase-5-review-report.md      (review of that same execution)
            └── phase-6-feature-report.md (feature only: the handover)
```

A bug uses the `phase-1-bug-report.md` template but still stores its triage record at `phase-1-spec-requirement.md` so the CLI keeps working. Beyond that record a bug needs only the testing and review reports; the planning set and the feature report are not required. If behaviour appears beyond the scope of the defect fix, report the scope change and let the user decide whether a separate feature is warranted.

`phase-2-use-case-specification.md` is only an index. A feature's narrative belongs in `use-cases/UC-###-<slug>.md` — for example `UC-001-create-task.md`, so the name alone says what the file covers. The older plain `UC-###.md` form is still accepted; in both cases the `UC-###` prefix of the file name must match the ID declared inside it. Every test case must trace `FR-###` → `UC-###`.

## What the review report adds

Review is where the change lands, so `phase-5-review-report.md` carries two more frontmatter fields beyond `status` and `executionId`:

| Field | Values | Meaning |
|---|---|---|
| `ci` | `green`, `red`, `none` | The result of the PR's checks (`references/ci-watch.md` in `kanban-review`), or `none` when the repository has no CI |
| `landing` | `pr`, `none` | `pr` when the reviewed branch goes through a recorded pull request; `none` when there is nothing to land |

A `PASS` is refused while `ci` is `red` (`review_ci_red`) or missing (`review_ci_missing`), when `landing` is missing (`review_landing_missing`), or when `landing: pr` has no recorded PR (`review_pr_missing`). A red `ci` returns the item to implementation; the fix is tested and reviewed again on a new execution.

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

## On close into `done`

A review PASS item closes on the next `kf status`, `kf sync` or `kf archive` once its PR is merged (or at once when `landing: none` and nothing is ahead of the default branch), and `kf archive` is the explicit form. The close leaves the artifact set in `.works/done/{feature}_{timestamp}/` for audit. For a feature, the CLI copies the documents people actually read into the canonical docs:

| Canonical doc | Contents |
|---|---|
| `docs/requirement/{context}/{feature}.md` | The archived requirement |
| `docs/use-cases/{context}/{feature}/README.md` | The UC index and coverage |
| `docs/use-cases/{context}/{feature}/UC-###(-<slug>).md` | Each use case narrative |
| `docs/use-cases/{context}/{feature}/diagram.md` | The actor and use case diagram |
| `docs/testplan/{context}/{feature}.md` | The test plan and the coverage matrix |
| `docs/testplan/{context}/{feature}-result.md` | The most recent execution result |

Every copy except the execution result is stamped `status: archived` in its frontmatter (a file without frontmatter is copied as-is), and the index lands as `README.md` with its `use-cases/...` links rewritten to sibling links and its "Use Case Files" rows flipped from `planned` to `implemented`. The feature report is not copied — it stays with the work item for audit. On this first copy the `.works/` versions win unconditionally: whatever already sits at a canonical path, including a hand-edited requirement mirror, is overwritten.

For a bug, archive neither creates nor overwrites an existing feature's docs. The archive skill updates the related docs only when the bug report states a docs impact; when there is none, it says "No documentation update required" in the closure or review.

The overwrite behaviour flips on a re-archive: archiving a feature that is already in `done` refuses to overwrite canonical docs that have changed since the snapshot, so updates from a bug or from extra documentation survive. Use `--skip-specs` to leave the docs alone; use `--force` only when restoring the old snapshot is what you actually want — the bypass is recorded in `.kfw.json`. A doc an older version wrote without the archived stamp (status absent or `planning`) is not an edit: when stamping it yields the new copy, the re-archive upgrades it in place without a refusal or a bypass. Any other difference, a hand-set status included, is still refused.

Snapshots alone go stale when a later feature changes the same behavior, so closure reconciles them: before `kf archive`, the archive skill finds earlier canonical docs that contradict the new behavior, marks each with a `> **Superseded by <feature>.**` banner under its title (the old body stays for history), brings `docs/workflow/*` up to date, and lists what it touched in the feature report's `## Docs Reconciled` section. A banner counts as an edit to that older feature's docs, so re-archiving it by hand needs `--skip-specs` to keep the banner; `kf sync` never re-archives a delivered item, so the sweep is unaffected.

When the primary checkout is on a clean, current default branch, the canonical docs are written into its working tree. Otherwise they are committed to an unpushed `docs/<context>-<feature>` branch cut from `origin/<default>`, the name is stamped in the work item's `meta.docsBranch`, and `kf status --all` lists it under **Waiting to merge** until it is pushed (`kf doctor` warns `docs_branch_unpushed`).

## Run logs

Each worker run writes `runs/<id>.log` inside the work item folder, and the file fills while the worker runs: the default `claude` runner streams one JSON line per event, and a runner that prints one JSON object at exit is still accepted. `kf drive --status`, the `--watch` heartbeat and `--tail` read it to show each live worker's last tool call or text with its age. A worker that exits non-zero leaves its own error text in the task reason and the stop reason; a usage-limit failure stops the drive with code `usage_limit` and keeps the worker session for the next `kf drive`. See [the harness guide](harness.md#task-harness-kf-drive).

## The day files under `.kf/travel/`

The `travel` skill keeps its state outside any work item, in two plain files under `.kf/travel/`. `kf init` adds the folder to `.gitignore`, so neither is committed.

| File | Contents |
|---|---|
| `progress.md` | The ledger: one `## YYYY-MM-DD` section per day, one line per item with its state (`driving`, `blocked`, `waiting-to-merge`, `carry-over`, `done`), its size, and the PR URL or the reason and next command where there is one. A `driving` or `blocked` line is owned by travel |
| `estimates.md` | One line appended when a ledger line becomes `done`, fields in this order: `date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap`. `work` is the sum of that day's `kf drive` run durations for the item, `files` the item worktree's diff against its base, and `actual` the size the higher of the two implies (`-` for a cancelled or restarted item, which stays out of the stats) |

Sizes are S=1, M=2, L=4, XL=8 points. The morning budget is the median daily total of `actual` points once three days of estimates exist, otherwise 10 tasks; after 20 measured lines the thresholds are learned from the recent rows instead of the defaults.

## Checklist before closing

- [ ] The requirement or bug report is `confirmed` and free of placeholders.
- [ ] Feature: four planning artifacts, one file per UC, and a test matrix whose IDs line up.
- [ ] Bug: a triage record carrying the reproduction, the severity and the regression strategy.
- [ ] Testing and review both `PASS`, on the current execution, the review report with `ci` green or none and a `landing` value.
- [ ] The feature report records what changed, which tests ran, which docs moved, which earlier docs were reconciled (or `None` with a reason) and what limits remain. Not required for a bug.
- [ ] Canonical docs synced where needed, and no database, deploy or publish action outside the approved scope.

## The implementation plan's Task Breakdown

The `## Task Breakdown` table in `phase-2-implementation-plan.md` is what the [task harness](harness.md#task-harness-kf-drive) schedules:

| Column | Meaning |
| --- | --- |
| `Task` | `TASK-###`, unique |
| `Dependencies` | `TASK-###` ids this task waits for; `-`, `none` or empty for none |
| `Role` | a key of `harness.roles`, or `-` for the implementation default |
| `Files` | comma-separated paths, directories or globs the task may change — its allowlist. A directory allows everything under it, and so does a glob that matches a directory: `src/*` also allows `src/x/y.ts`. Tasks whose Files overlap never run at the same time; an empty cell means "files unknown" and the task runs alone |

Two sections after the table bind the reviewers rather than the scheduler. `## Global Constraints` lists the spec's project-wide requirements verbatim (version floors, dependency limits, naming and copy rules, exact values); the task reviewer in `kanban-implement` receives it word for word, so a constraint missing here is a constraint nobody checks. `## Review Focus` lists up to five inputs or failure modes the spec implies but no task's tests exercise, each as the condition and the behaviour expected; each line's pinning test belongs to the task that owns the behaviour. Both take `None` — the first when the spec states none, the second only after checking.

`kf validate` reports a duplicate id (`task_duplicate`), a missing dependency (`task_dep_missing`), a cycle (`task_dep_cycle`) and an undeclared role (`task_role_unknown`) as errors. The table is part of the approved contract: editing it after `kf approve` means approving again. Plans written before these columns existed still parse — every task gets role `-` and unknown files.

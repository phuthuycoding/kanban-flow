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
    └── phase-4-testing-result.md         (the outcome of one execution: the stage record, each TC mapped to its test, line coverage per changed file)
        └── phase-5-review-report.md      (review of that same execution)
            └── phase-6-feature-report.md (feature only: the handover)
```

A bug uses the `phase-1-bug-report.md` template but still stores its triage record at `phase-1-spec-requirement.md` so the CLI keeps working. Beyond that record a bug needs only the testing and review reports; the planning set and the feature report are not required. If behaviour appears beyond the scope of the defect fix, report the scope change and let the user decide whether a separate feature is warranted.

`phase-2-use-case-specification.md` is only an index. A feature's narrative belongs in `use-cases/UC-###-<slug>.md` — for example `UC-001-create-task.md`, so the name alone says what the file covers. The older plain `UC-###.md` form is still accepted; in both cases the `UC-###` prefix of the file name must match the ID declared inside it. Every test case must trace `FR-###` → `UC-###`.

## What the review report adds

Review is where the change lands, so `phase-5-review-report.md` carries two more frontmatter fields beyond `status` and `executionId`:

| Field | Values | Meaning |
|---|---|---|
| `ci` | `green`, `red`, `none` | The result of the PR's checks (`references/ci-watch.md` in `/kf:review`), or `none` when the repository has no CI |
| `landing` | `pr`, `none` | `pr` when the reviewed branch goes through a recorded pull request; `none` when there is nothing to land |

A `PASS` is refused while `ci` is `red` (`review_ci_red`) or missing (`review_ci_missing`), when `landing` is missing (`review_landing_missing`), or when `landing: pr` has no recorded PR (`review_pr_missing`). A red `ci` returns the item to implementation; the fix is tested and reviewed again on a new execution.

## Shared conventions

| Convention | What it means |
|---|---|
| Frontmatter | Identifies the work item, its context, its status and the current execution |
| Placeholder | Lives only in the template; every one must be replaced with real content before a gate |
| ID | `FR-###`, `UC-###`, `TC-###`, used consistently across every artifact |
| Report status | Testing: `PASS/FAIL/BLOCKED`; review: `PASS/FAIL/REQUIREMENT_BUG` |
| Execution | Testing and review must carry the same `executionId` as the current run |
| Summary tables | Totals must match the detail rows, not merely describe them |

The CLI checks the files, the placeholders, secret-like content, ID references, the approval fingerprint and each report's execution and status. Table totals, measured coverage and the quality of the narrative are the agent's job during planning, testing and review; a passing validator proves none of them.

## On close into `done`

A review PASS item closes on the next `kf status --change <feature>` (or `--all`), `kf sync` or `kf archive` once its PR is merged (or at once when `landing: none` and nothing is ahead of the default branch), and `kf archive` is the explicit form. The close leaves the artifact set in `.works/done/{feature}_{timestamp}/` for audit and copies nothing under `docs/` — for a feature or a bug. The feature report stays with the work item.

## Living docs `docs/specs/`

The docs people read for current behaviour are the living docs, one per capability:

| Living doc | Contents |
|---|---|
| `docs/specs/{context}/{capability}.md` | `## Purpose`, `## Current behaviour`, `## Use cases`, `## Surfaces` and `## History` — one History line per feature or bug that changed it |
| `docs/specs/{context}/README.md` | The context index: `## Capabilities` links every capability file, `## Retired` names the capabilities and legacy features that no longer exist |

`kf instruct living-doc` and `kf instruct living-doc-index` print the templates and the path (`--change <feature>` fills the context). `README` is the index and never a capability name. A feature edits them at review (`/kf:review` step 2b, before the reviewer dispatch) in one docs commit on the item branch, as the plan's `## Documentation Impact` names them; the review report records `docs: updated` or `docs: none` with `docs_reason`, and the feature report's `## Docs Reconciled` lists the living docs created or updated and the legacy features consolidated. A bug edits an existing living doc and never creates one.

The plan's `## Documentation Impact` takes one line per entry: `docs/specs/<context>/<capability>.md`, `consolidates: <context>/<feature>` (a legacy feature this feature folds into a living doc), or `none — <reason>`. A consolidated legacy feature has every file deleted — `docs/requirement/<context>/<feature>.md`, `docs/use-cases/<context>/<feature>/`, `docs/testplan/<context>/<feature>.md` and `<feature>-result.md` — and its `<context>/<feature>` token named in a living doc's `## History` or the index's `## Retired`.

The legacy snapshots under `docs/requirement`, `docs/use-cases` and `docs/testplan`, which earlier releases copied at the close, are history: nothing banners or rewrites them, and `/kf:docs` consolidates them one context at a time (`kf doctor` warns `Legacy docs not consolidated` while any remain). A docs branch an earlier close recorded (`meta.docsBranch`, an unpushed `docs/<context>-<feature>` branch) is still listed under **Waiting to merge** until it lands (`kf doctor` warns `docs_branch_unpushed`).

## The task loop ledger `<item>/loop/progress.md`

The `/kf:implement` loop keeps its state in the ledger `<item>/loop/progress.md`, beside the task briefs, reports and `task-NNN-verify.log` files under `<item>/loop/`. `kf record <feature> <event> …` writes each line, stamped ` @ <ISO>`, under the item lock; `kf next <feature>` reads it, with the plan, the reports, the verify logs and `git log`, to print the actions due now. The nine line shapes `kf loop-stats` reads are fixed in `assets/skills/implement/references/task-loop.md` § The ledger. Beside them `kf next` reads these lines:

| Line | Meaning |
|---|---|
| `Scan: clean` | The pre-task conflict scan found no conflict; no seat opens before a `Scan:` line |
| `Note TASK-NNN: commits <a7>,<b7>` | The task's commits; `kf next` prints it after a developer's `done` for every reported commit no ledger line names yet, before the review. A commit lands at the first ledger line that names it (this note or a `review package` line), and cascades and verify waits are read from that position |
| `Note TASK-NNN: decided — <what>` | The session's decision that closes one open `decide` of the task |
| `Note TASK-NNN: verify routed — TASK-MMM` | The task's verify failure was sent to TASK-MMM as a fix round of TASK-MMM |

## The lifecycle log `<item>/lifecycle.jsonl`

Every work item carries a lifecycle log at the root of its folder: `lifecycle.jsonl`, one JSON record per line. kf only ever appends to it. `.kfw.json` stays the snapshot every command reads; the log is written beside it, by the same code that changes the snapshot or moves the folder and inside the same item lock, and it can rebuild the snapshot: folding the records in order gives the item's stage and its shared metadata — every `.kfw.json` field except `worktree`, with one value shortened: a hook skipped with `--skip-hooks` is `hook:<absolute path>` in `.kfw.json` and `hook:<file name>` in the log.

Each record has these fields:

| Field | Meaning |
|---|---|
| `v` | The format version, `1` |
| `at` | When the record was written, an ISO-8601 UTC time with milliseconds |
| `actor` | Who ran the command: git `user.name`, else `$USER`, else `$USERNAME`, else `human` |
| `origin` | `{ "machine": "<id>", "via": "cli" }` — which machine wrote it. The id is a random uuid kf creates once per machine in `~/.kf/machine-id`; it is `unknown` when that file cannot be read or created, or holds something that is not a uuid |
| `event` | What happened, one of the events below |
| `from`, `stage` | On a command's own record that moves the item: the stage it left and the stage it entered. `created`, `opened` and a `reconciled` record that moves the stage carry `stage` alone. The fold reads `stage` only |
| `set` | Each shared metadata field the change set, with its whole new value |
| `unset` | The shared metadata fields the change removed |
| `derived` | `true` on `opened` and `reconciled` only: the record was taken from the snapshot, not written by the change itself |

| Event | Written by | Carries |
|---|---|---|
| `created` | `kf new`, before its brainstorm hook runs | The stage `brainstorm` and every field of the new metadata, the item's `id` among them |
| `stage` | `kf stage`, the move of `kf approve`, the reopen of a cancelled item | `from`, `stage`, and what the move set or cleared: a new `executionId` on entering testing, the approval reset to pending on a return to planning, a cleared cancellation, a bypass (a `--force` bypass with the codes it ignored, a `--skip-hooks` bypass as `hook:<file name>`, without the hook's directory) |
| `approved` | `kf approve`, before the `stage` record of its move | The approval: status, by, at, contract hash and the living-docs marker |
| `approval-restored` | `kf approve` whose move was refused, when kf put the previous approval back | The approval the item had before |
| `cancelled` | `kf cancel` | `from`, the stage `cancelled`, the cancellation (by, reason, the stage it left) and the status |
| `waiver` | `kf verify <feature> --stage --waive` | The verify waiver |
| `linked` | `kf issues create`, `kf issues link` (an issue, a pull request, `--replace`) | The issue or pull request URL, and the `goal` when `kf issues create --title` saves the title on an item that had none |
| `delivered` | The close into `done` (`kf archive`, `kf stage <feature> done`, and the same close run by `kf status` or `kf sync`) | `from`, the stage `done`, the delivery stamp and the archived status |
| `delivered` | A later close of an item already in `done`, when it changes a field | What it set — a docs branch the close recorded, a missing delivery stamp — with no `from` and no `stage`, because the item does not move |
| `docs` | `kf status --all` proving a docs branch landed | The landing record |
| `opened` | Any lifecycle write on an item that has no log yet | The stage and every shared field as they were before that write, plus the item's new `id` when it had none |
| `reconciled` | Any lifecycle write on an item whose log disagrees with its `.kfw.json` | Only the fields that differ, and the stage when it differs |

Rules that hold for every record:

- **The id.** `kf new` gives each item a uuid, stored in `.kfw.json` as `id` and carried by the log; `kf status --change <feature> --json` prints it. An item created by an earlier release gets one at its first lifecycle write. A `.kfw.json` that lost its `id` gets back the one its log holds, at the next write or `kf doctor --fix`; kf mints a new uuid only when the log holds none. The folder name stays the local name; the id is what identifies the item across machines.
- **Nothing machine-local is written.** The `worktree` block of `.kfw.json` (path, branch, domain, port) never enters a record, and kf writes no host name, home directory or project path of its own: the one metadata value that holds a path, the hook a `--skip-hooks` bypass names, is recorded by its file name. `kf worktree create` and `kf worktree remove` write no record. What a person typed into the metadata — a goal, a cancellation reason — is recorded as typed.
- **A record follows a change that happened.** A refused command and a move that is rolled back leave the log byte-identical; a write that changes no shared field and no stage appends no record of its own. The one case with more than one record for a refusal is `kf approve` whose move is refused after the approval was written: the log holds `approved`, then `approval-restored`.
- **The log catches up by itself.** Before a lifecycle write appends its own record, kf compares the fold of the log with the item as it was before the change. A missing log is opened, a log that is behind — a `.kfw.json` edited by hand, a folder moved by hand, a record lost to a failed write — is reconciled, and the command's own record follows.
- **The log never changes a command's result.** When the log cannot be written the command keeps its exit code and its effect and prints one line on stderr, `⚠ lifecycle log not written for '<feature>': <path>: <reason>`; the next lifecycle write catches up. A log with an unreadable line, or one that never sets `schema`, `feature`, `context` and `created`, is never appended to; `kf doctor` reports it as a log it cannot read.
- **`kf doctor`** warns for an item whose log cannot be read or is behind its `.kfw.json`, naming the fields, and stays silent for an item with no log. `kf doctor --fix` opens a log for every item that has none and reconciles one that is behind, stamping a missing `id` without changing the file's indentation; it never rewrites a log it cannot read, and it leaves alone an item that still holds the run state of the removed `kf drive`.

The log protects against lost history, not against a file rewritten on purpose: it lives in the item folder, which the agent can write.

## The item measurement `<item>/metrics.json`

Estimation and measurement are harness data. `kf approve` records the item's estimate in `.kfw.json` as `meta.estimate`, from the contract's `## Estimate` section (`- Agent minutes: <n>`, the raw minutes before calibration): the minutes, the distinct Task Breakdown Files entries (`null` for a bug), how exact that count is, the size they give with the factor learned for the item's kind, and when; or `none` and why. Entering review records `meta.filesChanged`, the number of files the item branch changed, or `null` with the reason.

The close into `done` writes `<item>/metrics.json` once: the estimate, the actual size (from the work minutes and the files changed, sized with the default thresholds) and the gap in sizes, the time in each stage (backlog time is a stage of its own, not work), the path, the requirement, plan and merge gate spans, the fix rounds, seat time and models from the ledger, the files changed, the review tier, and whether the loop-metrics row was written. A figure that could not be taken is `{ "missing": "<reason>" }`, never 0, and a span whose clock ran backwards is `{ "unreliable": "clock went backwards" }`, never a negative number, and nothing machine-local (a path, a host name, a worktree) is written. A measurement that cannot be written never refuses or delays the close: the close warns. `kf metrics <feature>` prints it.

`kf estimate size`, `kf estimate stats` and `kf approve` learn from the history: every done item's `metrics.json` plus the legacy `.kf/travel/estimates.md`, read and never written. See [cli-reference](cli-reference.md) for the size rules and the factor.

## The loop metrics file `.works/loop-metrics.md`

The close writes one row per item to `.works/loop-metrics.md`, replacing the item's earlier row, when the ledger is one `kf loop-stats <feature> --record` accepts, and says in `metrics.json` why not otherwise; `kf loop-stats --all` reads it back. The file is derived from the ledger `<item>/loop/progress.md`, whose lines end in ` @ <ISO>` (grammar: `assets/skills/implement/references/task-loop.md` § The ledger), and is rebuilt by recording again. `--record` refuses a ledger with unparsed lines, orphans a resume did not dispatch again, stamps later than the file's last write, or `verify done` lines the `kf verify` log does not back, and names them; a plain report warns on stderr. Lines with no time are counted in the row, not dropped.

## The day file under `.kf/travel/`

The `travel` skill keeps its state outside any work item, in one plain file under `.kf/travel/`. `kf init` adds the folder to `.gitignore`, so it is not committed.

| File | Contents |
|---|---|
| `progress.md` | The ledger: one `## YYYY-MM-DD` section per day, one line per item with its state (`driving`, `blocked`, `waiting-to-merge`, `carry-over`, `done`), its size, and the PR URL or the reason and next command where there is one. A `driving` or `blocked` line carries an owner token: `owner=travel` while travel drives it, `owner=human` once the human takes a blocked item. A day section keeps only the day's plan; a line sized for the day only says `no item estimate` |
| `estimates.md` | Legacy, written by earlier releases' travel; nothing writes it now. kf still reads its rows (`date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin`, or the 13-field shape without `estmin`) into the estimation history. A row without `estmin` counts for the budget, hit rate and bias and teaches the factor nothing |

Travel reads each item's recorded estimate (`kf estimate show <feature> --json`) and never sizes an item that has one; it sizes only a line without one, for that day, with `kf estimate size`. Its budget and calibration come from `kf estimate stats`: the median daily total of actual points once three days are measured, otherwise 10 tasks.

## Checklist before closing

- [ ] The requirement or bug report is `confirmed` and free of placeholders.
- [ ] Feature: four planning artifacts, one file per UC, and a test matrix whose IDs line up.
- [ ] Bug: a triage record carrying the reproduction, the severity and the regression strategy.
- [ ] Testing and review both `PASS`, on the current execution, the review report with `ci` green or none and a `landing` value.
- [ ] The feature report records what changed, which tests ran, which living docs were created or updated and which legacy features consolidated (or `None` with a reason) and what limits remain. Not required for a bug.
- [ ] The review report's `docs:` says whether the living docs changed, and no database, deploy or publish action outside the approved scope.

## The implementation plan's Task Breakdown

The `## Task Breakdown` table in `phase-2-implementation-plan.md` is what the [pipelined task loop](harness.md#kf-verify) schedules:

| Column | Meaning |
| --- | --- |
| `Task` | `TASK-###`, unique |
| `Dependencies` | `TASK-###` ids this task waits for; `-`, `none` or empty for none |
| `Files` | comma-separated paths, directories or globs the task may change — its allowlist. A directory allows everything under it, and so does a glob that matches a directory: `src/*` also allows `src/x/y.ts`. The controller should not run tasks whose Files overlap side by side; an empty cell means "files unknown" and `kf verify --task` refuses nothing for that task |

Two sections after the table bind the reviewers rather than the scheduler. `## Global Constraints` lists the spec's project-wide requirements verbatim (version floors, dependency limits, naming and copy rules, exact values); the task reviewer in `/kf:implement` receives it word for word, so a constraint missing here is a constraint nobody checks. `## Review Focus` lists up to five inputs or failure modes the spec implies but no task's tests exercise, each as the condition and the behaviour expected; each line's pinning test belongs to the task that owns the behaviour. Both take `None` — the first when the spec states none, the second only after checking.

`kf validate` reports a duplicate id (`task_duplicate`), a missing dependency (`task_dep_missing`), and a cycle (`task_dep_cycle`) as errors. The table is part of the approved contract: editing it after `kf approve` means approving again. Plans written before the `Files` column existed still parse — every task gets unknown files.

---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case

> **Partly superseded by `drive-retire`:** the parts that use `kf drive` (config resolution, `--status`/`--watch`, drive supervisor and workers) or `kf run` no longer hold — both are removed; `travel` runs items itself in the session and the in-session loop is the only implementation path. Kept for history.

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Tester, then independent review with PR and CI watch |
| Requirement reference | FR-003, FR-004 |
| Goal | Review is where the PR is opened, an independent `code-reviewer` judges the diff and CI is watched; PASS is impossible with red CI or stale tests |
| Primary actor | Drive workers (tester, code-reviewer) |

## Supporting Actors
- Orchestrator running `kanban-review` (main agent or a `kf run` worker)
- GitHub (`gh pr create`, Actions, `gh run list`, `gh pr view`)
- `kf` validators (`validate-reports`, `direction`)

## Preconditions
- Testing report `PASS` for the current execution id; the item is in `review` with its worktree branch.
- `meta.pr` may be empty (first review) or recorded (a repair loop).

## Trigger
`kf stage <feature> review` succeeds and `kanban-review` starts.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Orchestrator | Establishes the facts (lint, build, suite counts, anti-pattern scan, rules) — the `kanban-review` steps that exist today | `reviews/<execution>/pack.md` prepared |
| 2 | Orchestrator | Dispatches `code-reviewer` agent(s) by tier (`select-tier`) on the branch diff, verifies evidence (`verify-findings`); an open HIGH finding ends here with a `FAIL` report and `kf stage <feature> implementation` — no PR exists yet | Reviewer PASS, or the loop back |
| 3 | Orchestrator | Only after the reviewer PASS: pushes the item branch and opens the PR when `meta.pr` is empty (`gh pr create`), records it with `kf issues link <feature> <url> --pr`; a repair loop that already has a PR pushes to it, never opens a second | `meta.pr` holds the PR URL for reviewed code |
| 4 | Orchestrator | Runs the CI watcher (moved from `kanban-ship` to `kanban-review/references/ci-watch.md`) on the pushed sha; waits for the outcome | `ci: green` or `ci: red` known; repos without `.github/workflows` → `ci: none` |
| 5 | Orchestrator | Assembles `phase-5-review-report.md` from the reviewer's verified findings — frontmatter `status`, `execution`, `ci: green|red|none`, `landing: pr|none`, the `## Reviewer` section naming the `code-reviewer` dispatches and models, the findings table copied from the kept findings; it adds no finding of its own beyond step 1's mechanical facts and never writes the report in place of the reviewer when a subagent or runner is available | Report on disk |
| 6 | kf | `kf validate` / the direction gate accept `PASS` only when `ci` is not `red`, the testing report is PASS for the same execution, and (`landing: pr` with `meta.pr` recorded, or `landing: none`) | PASS stands, or the gate names what blocks it |

## Alternative Flows
### A1 — CI red
- Trigger: the watcher exits 1.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The failed run URLs and the failing job's log tail become the repair brief; the orchestrator writes the report with `status: FAIL`, `ci: red` and moves the item to implementation | Repair loop: implementation → testing (new execution) → review; the same PR is updated by the next push, never a second PR |
| A1.2 | Second CI round still red | Hand back to the human with both rounds' failed runs |

### A2 — nothing to land
- Trigger: the item changed no tracked code (docs-only item kept inside `.works`, research, config decided elsewhere).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | No PR is opened; the report records `landing: none` and `ci: none` with the reason | PASS allowed; UC-003 closes the item on the next `kf status` |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Reviewer FAIL/REJECT | Report `status: FAIL|REJECT`; `kf stage <feature> implementation`; after the fix, testing mints a new execution before review | Loop as today (FR-004) |
| Report says PASS but `ci: red` | `kf validate` ERROR `review_ci_red`; `kf stage` refuses leaving review forward | Item stays in review |
| Report says PASS with `landing: pr` but `meta.pr` empty | `kf validate` ERROR `review_pr_missing` | Item stays in review |
| `gh pr create` fails (no remote, auth) | Report `status: BLOCKED`-equivalent: the orchestrator stops and reports; nothing is faked | Human decides |

## Postconditions
- A code item in review with `PASS` has a recorded PR URL and a `ci` value that is `green` or `none`.
- `kf status --change <feature>` next step: merge the PR (URL) — UC-003.

## Business Rules
- Review precedes the PR: the branch is pushed and the PR opened only after the independent reviewer passed; CI then confirms reviewed code.
- The orchestrator never writes a finding beyond the mechanical facts; the reviewer does (already in `kanban-review`).
- The watcher never re-runs, cancels or approves a workflow and never merges.
- A code fix after review always goes back through testing before the next review; the gate reads the execution id.

## Data
- `.kfw.json`: `meta.pr`, `meta.executionId`.
- `phase-5-review-report.md` frontmatter: `status`, `execution`, `ci`, `landing`.

## Acceptance Criteria
- [ ] Review of a code item records a PR URL before PASS and, when Actions exist, a green (or fixed-to-green) check run.
- [ ] `kf validate` rejects a PASS report with `ci: red` (`review_ci_red`) and a PASS report with `landing: pr` and no `meta.pr` (`review_pr_missing`).
- [ ] A repo without workflows records `ci: none`; the report says so.
- [ ] After a code fix, review PASS is refused until the new execution's testing report is PASS.

---
feature: "ci-pipeline-dedup"
context: "cli"
created: "20261009_1920"
execution: "51f342ea-fe55-4d6f-abdc-ffcd1b75ff10"
status: PASS
tested: "2026-10-09"
---

# Testing Result

## Feature
ci-pipeline-dedup

## Environment
Local checkout of the work branch; ruby YAML parser for the static check; the PR's own GitHub Actions runs for the live evidence.

## Execution Time
2026-10-09

## Summary
The workflow parses and carries the specified shape (TC-001). On the real repository the change's own PR produced one `pull_request` run per push — five pushes, five runs, zero `push`-event runs — with jobs `lint` and `test` in parallel (TC-002). Two runs were cancelled mid-flight by the concurrency group when a newer push landed, and the newest run completed green (TC-003).

## Test Results
| Test case | Result | Evidence |
|---|---|---|
| TC-001 | PASS | ruby YAML assertions on triggers, concurrency and jobs all hold |
| TC-002 | PASS | `gh run list --branch fix/ci-pipeline-dedup`: 5 runs, all event `pull_request`; PR checks show `lint`, `test (20)`, `test (22)` |
| TC-003 | PASS | runs 37930074301 and 37930122765 → `cancelled` when superseded; run 37930138429 → `success` |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `ruby -ryaml` assertions on `.github/workflows/ci.yml` (push.branches == [main], pull_request present, concurrency group, jobs lint+test, matrix [20,22], lint step order) | 0 | `ci.yml structure OK` |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | clean |
| `gh run list --branch fix/ci-pipeline-dedup` | 0 | 5 runs listed, every one `pull_request`, none `push` |
| `gh pr checks 12` | 0 | `lint` pass 10s, `test (20)` pass 22s, `test (22)` pass 22s |

## Failures and Blockers
None.

## Coverage
FR-001 (main-only push trigger) — observed: five branch pushes produced only `pull_request` runs. FR-002 (concurrency) — observed: two runs cancelled by superseding pushes; `cancel-in-progress` is false for `refs/heads/main`. FR-003 (job split) — observed: `lint` and `test` ran as separate parallel jobs.

## Regression
Pushes to a branch with no open PR no longer run CI — the documented trade-off in FR-001. Required checks that name `check` must be repointed to `lint`/`test` in repo settings (flagged in the PR body).

## Conclusion
The duplicate-run problem and the stale-run problem are both gone, verified on the live Actions list for the change's own PR.

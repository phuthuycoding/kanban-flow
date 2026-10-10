---
feature: ci-pipeline-dedup
context: cli
created: 20261009_1912
kind: feature
status: archived
---
# Spec Requirement

## Feature
ci-pipeline-dedup

## Objective
Stop CI from running twice for every PR commit and from finishing runs that are already stale, and split the single check job into a lint stage and a test stage.

## Problem Statement
`ci.yml` triggers on every `push` to any branch AND on `pull_request`. A commit on a branch with an open PR therefore runs the full check matrix twice (visible in the Actions list as a `push` run beside a `pull_request` run for the same commit). There is also no `concurrency` group, so a superseded run keeps burning minutes after a newer commit lands. Finally `check` runs typecheck, lint and the test suite serially inside one job, twice (node 20 and 22), so a lint failure waits behind a full `npm ci` and the slowest stage blocks the signal.

## Scope
### In Scope
- `.github/workflows/ci.yml` only.

### Out of Scope
- `.github/workflows/pages.yml` — already path-filtered and concurrency-safe.
- Branch protection / required-check renames on the repo settings side.
- Caching beyond the existing `cache: npm`, npm publish automation.

## Actors
- Contributor pushing commits and opening PRs.
- Maintainer reading the Actions tab.

## Functional Requirements
### FR-001
- Requirement: `on.push` is restricted to `branches: [main]`; `pull_request` is unchanged. A push to a branch with an open PR produces exactly one CI run (the `pull_request` one), while merges to `main` still run CI.
- Priority: high
- Notes: pushes to branches with no PR produce no run until a PR exists — that is the intended trade-off; the PR triggers on open.

### FR-002
- Requirement: a `concurrency` group keyed on the workflow + ref cancels in-progress runs for the same ref (`cancel-in-progress: true`); runs on `main` must not be cancelled by a later push — group key must distinguish `main` merges or use `cancel-in-progress: false` for that branch.
- Priority: high
- Notes: the queued/in-progress pile in the Actions list is the visible symptom being removed.

### FR-003
- Requirement: the single `check` job is split into two jobs: `lint` (npm ci, typecheck, lint on one Node version) and `test` (npm ci, `npm test` on the existing node 20/22 matrix). They run in parallel; neither `needs` the other.
- Priority: medium
- Notes: job names change from `check` to `lint`/`test`; any required-check setting naming `check` must be updated in repo settings — call this out in the PR body.

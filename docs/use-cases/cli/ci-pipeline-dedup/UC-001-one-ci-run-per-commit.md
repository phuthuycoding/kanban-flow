---
feature: "ci-pipeline-dedup"
context: "cli"
created: "20261009_1920"
id: UC-001
---

# UC-001 — Push to a PR branch produces one non-redundant CI run

## Actor
Contributor pushing to a branch that has an open pull request.

## Preconditions
- A PR exists for the branch.

## Main Flow
1. Contributor pushes a commit to the branch.
2. GitHub evaluates triggers: `push` does not match (branch is not main); `pull_request` matches once.
3. Exactly one CI run starts, containing jobs `lint` and `test` in parallel.
4. Contributor pushes a second commit before the first finishes.
5. The first run is cancelled by the concurrency group; the second runs to completion.

## Alternate Flows
- A commit lands on `main` via merge: the `push` trigger matches, the run is not cancelled by concurrency (`cancel-in-progress: false` on main).
- A push to a branch with no PR: no run; the run happens when the PR is opened.

## Postconditions
- Actions list shows one run per PR commit, not two.
- A superseded run shows `cancelled`, not `in progress`.

---
feature: prune-old-releases
context: cli
created: 20261029_2101
kind: feature
status: archived
---
# Spec Requirement

## Feature
prune-old-releases

## Objective
One-shot cleanup of `phuthuycoding/kanban-flow`: keep the five newest GitHub Releases and their git tags; delete every older GitHub Release and every leftover git tag.

## Problem Statement
The repo currently has 14 GitHub Releases (`v0.5.0` … `v0.13.0`) plus leftover tags from the old shell installer (`v1.0.0`, `v1.1.0`, `v2.0.0`) and pre-rewrite tags (`v0.4.0`, `v0.4.1`). Old releases clutter the Releases page and the tag list. The maintainer wants only the five newest TypeScript-rewrite releases to remain.

## Scope
### In Scope
- Select the five newest GitHub Releases of `phuthuycoding/kanban-flow` by `publishedAt` descending.
- Delete every other GitHub Release, including its git tag (`gh release delete <tag> --yes --cleanup-tag`).
- Delete leftover git tags that have no GitHub Release and are not in the keep set (`v2.0.0`, `v1.1.0`, `v0.4.1`, `v0.4.0` and any other remote tag outside the keep set).
- Dry-run the keep/delete sets and get an explicit human OK before any delete.
- After the run, verify exactly five GitHub Releases remain, `v0.13.0` is Latest, and remote tags equal those five.

### Out of Scope
- npm versions — `@phuthuycoding/kanban-flow` on the registry is left untouched.
- A reusable `kf` command, config flag, or CI workflow that prunes on every future release.
- Editing CHANGELOG.md, package.json, or git history / default branch.
- Deleting GitHub Releases of any other repository.

## Affected surfaces
- GitHub Releases page for `phuthuycoding/kanban-flow` (fewer rows; Latest stays the newest kept tag).
- Remote git tags on `origin` (only the five kept tags remain).
- N/A: CLI `-h`, README, docs site, landing page, examples, CHANGELOG body, npm package page.

## Actors
- Maintainer running the one-shot prune on this repository.

## Functional Requirements
### FR-001
- Requirement: The keep set is the five GitHub Releases with the latest `publishedAt` in `phuthuycoding/kanban-flow`. Ties break by tag name descending. Semver order is not used (so installer tags `v1.x`/`v2.x` cannot outrank `v0.13.0`).
- Priority: must
- Notes: Snapshot at spec time: keep `v0.13.0`, `v0.12.0`, `v0.11.5`, `v0.11.4`, `v0.11.3`. Recompute from live `gh release list` at execution time; if the live top five differ, stop and ask.

### FR-002
- Requirement: Every GitHub Release whose tag is not in the keep set is deleted, and its git tag is deleted with it (`gh release delete <tag> --yes --cleanup-tag`).
- Priority: must
- Notes: Snapshot at spec time: delete releases `v0.11.2`, `v0.11.1`, `v0.11.0`, `v0.10.0`, `v0.9.0`, `v0.8.0`, `v0.7.0`, `v0.6.0`, `v0.5.0`.

### FR-003
- Requirement: Every remote git tag that is not in the keep set is deleted, including tags that never had a GitHub Release.
- Priority: must
- Notes: Snapshot at spec time: extra tags `v2.0.0`, `v1.1.0`, `v1.0.0`, `v0.4.1`, `v0.4.0`. Use `git ls-remote --tags origin` as the source of truth for leftovers after release deletes.

### FR-004
- Requirement: A dry-run prints the keep set, the GitHub Releases to delete, and the leftover tags to delete. No delete runs until the human confirms that exact list.
- Priority: must
- Notes: Confirmation applies only to that printed list. If the live inventory changes, dry-run again.

### FR-005
- Requirement: npm published versions are not unpublished, deprecated, or otherwise modified.
- Priority: must
- Notes: Verify with `npm view @phuthuycoding/kanban-flow versions` after the prune; the list must match the pre-prune snapshot.

### FR-006
- Requirement: After a successful prune, `gh release list` returns exactly five releases, the Latest flag is on the newest kept tag, and `git ls-remote --tags origin` lists only those five tags (plus any `^{}` peeled refs for them).
- Priority: must
- Notes: Local tags that still exist on a developer machine are out of scope; only `origin` is cleaned.

## Non-Functional Requirements
- Deletes are sequential and logged (tag, command, exit code). A mid-run failure stops; already-deleted items are not recreated; the dry-run is re-run on the remainder.
- No `--force` git push of a branch. Tag deletion is `gh release delete --cleanup-tag` or `git push origin :refs/tags/<tag>`.

## Main Use Cases
- UC-001 Maintainer dry-runs the keep/delete sets and confirms
- UC-002 Maintainer prunes GitHub Releases and leftover tags; five newest remain
- UC-003 Live inventory no longer matches the spec snapshot — the run stops and asks

## Constraints
- Target is only `phuthuycoding/kanban-flow`.
- `gh` must be authenticated with permission to delete releases and tags.
- Do not delete a tag that is in the keep set, even if a command fails part-way.

## Assumptions
- "Newest" means GitHub `publishedAt`, not semver. Confirmed with the maintainer: GitHub Releases + git tags, one-shot this repo, npm untouched.
- Installer tags `v1.0.0`, `v1.1.0`, `v2.0.0` and pre-rewrite `v0.4.0`/`v0.4.1` are leftovers to delete even though they have no GitHub Release.
- CHANGELOG history for deleted versions stays; only GitHub release objects and git tags go.
- There are no draft or prerelease GitHub Releases at spec time; if one appears at execution, it counts in `publishedAt` order like any other and is not given special protection.

## Acceptance Criteria
- [ ] Dry-run printed keep = five tags, delete-releases and delete-tags lists, and the human confirmed that list before any delete.
- [ ] `gh release list --repo phuthuycoding/kanban-flow` returns exactly five rows.
- [ ] Those five tags are the five newest by `publishedAt` at execution time (expected today: `v0.13.0`, `v0.12.0`, `v0.11.5`, `v0.11.4`, `v0.11.3`).
- [ ] The Latest GitHub Release is the newest kept tag (`v0.13.0` at spec time).
- [ ] `git ls-remote --tags origin` shows only the five kept tags.
- [ ] `npm view @phuthuycoding/kanban-flow versions` matches the pre-prune snapshot.
- [ ] A second dry-run after success reports keep = 5, delete = empty.

## Edge Cases
- Fewer than five GitHub Releases already: do nothing, report, do not delete leftover tags either until the human re-confirms a new list.
- A keep-set tag is missing locally but exists on origin: still keep it; do not recreate a GitHub Release.
- `gh release delete` succeeds and `--cleanup-tag` already removed the tag: the leftover-tag pass skips it.
- `gh release delete` fails for one tag: stop, leave remaining releases, print the failed tag and the remainder.
- Annotated vs lightweight tags: both forms are deleted the same way; peeled `^{}` refs disappear with the tag.
- Someone publishes a new release between dry-run and delete: abort and dry-run again (FR-004).

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest for keep/delete-set selection against a fixture of `gh release list` + `git ls-remote` output; live `gh release list` / `git ls-remote --tags origin` / `npm view` as post-execution checks (not run in CI against this repo)
- Coverage Target: 80% of any new selection helper; live prune is verified by the acceptance commands above

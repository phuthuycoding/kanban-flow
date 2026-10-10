---
feature: release-on-tag
context: cli
created: 20261010_1217
kind: feature
status: archived
---
# Spec Requirement

## Feature
release-on-tag

## Objective
A GitHub tag becomes the whole release ceremony: pushing `v*` publishes to npm and creates the GitHub release with notes cut from the CHANGELOG — no manual `gh release create` or `npm publish`.

## Problem Statement
Releasing today means: bump version by hand, run the tests locally, `npm publish` by hand, then `gh release create` by hand with notes hand-copied out of CHANGELOG. Every step is forgotten-able and the tag and the published version can silently disagree.

## Scope
### In Scope
- `.github/workflows/release.yml`: `on.push.tags: ["v*"]` → verify → test → publish → release.

### Out of Scope
- Automatic version bumping or changelog generation — the human still edits both before tagging.
- Publishing prerelease/beta channels.
- Anything in ci.yml or pages.yml.

## Actors
- Maintainer cutting a release.

## Functional Requirements
### FR-001
- Requirement: pushing a tag `v*` runs the release workflow, which first verifies the tag's version equals `package.json`'s `version`; a mismatch fails before anything publishes.
- Priority: high
- Notes: `npm ci` + `npm run typecheck` + `npm test` must also pass first — publish never ships an untested build.

### FR-002
- Requirement: `npm publish --provenance` publishes `@phuthuycoding/kanban-flow`, using an `NPM_TOKEN` repository secret; the job declares `id-token: write` for provenance.
- Priority: high
- Notes: the maintainer must create the granular npm token and store the secret — documented in the PR, cannot be automated.

### FR-003
- Requirement: the same tag creates a GitHub release whose notes are the matching `## [x.y.z]` section extracted from CHANGELOG.md.
- Priority: high
- Notes: `gh release create` inside the job; missing section fails the release rather than shipping empty notes.

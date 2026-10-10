---
feature: "release-on-tag"
context: "cli"
created: "20261010_1217"
id: UC-001
---

# UC-001 — Maintainer pushes a release tag

## Actor
Maintainer who has bumped `package.json` + `package-lock.json` and written the CHANGELOG section.

## Preconditions
- `NPM_TOKEN` secret configured; main is green.

## Main Flow
1. Maintainer tags the release commit `v<x.y.z>` and pushes the tag.
2. Verify: tag version == package.json version AND the CHANGELOG has `## [x.y.z]` — else fail before anything publishes.
3. Test: `npm ci`, typecheck, `npm test` — all must pass.
4. Publish: `npm publish --provenance`.
5. Release: `gh release create` with notes extracted from the CHANGELOG section.

## Alternate Flows
- Tag/version mismatch or missing CHANGELOG section → workflow fails at verify; fix, delete the tag, retag.
- npm publish fails → the job retries cleanly (publish is idempotent for a version not yet on the registry).

## Postconditions
- npmjs.com shows the new version; github.com/releases shows the tag with its notes.

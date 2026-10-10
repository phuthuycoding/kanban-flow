---
feature: "release-on-tag"
context: "cli"
created: "20261010_1217"
execution: "188a43db-d12f-4a72-98b5-bf24de790a14"
status: PASS
tested: "2026-10-10"
---

# Testing Result

## Feature
release-on-tag

## Environment
Local checkout on the work branch; ruby YAML parser; the real CHANGELOG for notes extraction; npm and gh against the live repository for the publish and release steps.

## Execution Time
2026-10-10

## Summary
The workflow parses with the specified trigger and job order (TC-001). The publish step was exercised via `npm publish --dry-run` — the tarball carries the new `kanban-flow/github-hooks/` directory — and the release step was exercised for real: a `v0.0.0-test` tag was pushed, `gh release create --verify-tag` succeeded, then the release and tag were deleted (TC-002, every command individually). The fully-chained workflow run happens on the next real tag, gated on the owner adding `NPM_TOKEN`.

## Test Results
| Test case | Result | Evidence |
|---|---|---|
| TC-001 | PASS | YAML: tags `v*`; jobs verify → test → publish → release; awk on CHANGELOG.md returns the 0.6.0 section |
| TC-002 | PASS (partial) | `npm publish --dry-run` ok; `gh release create --verify-tag` on a real tag ok; chained run deferred — needs NPM_TOKEN, owner task |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `ruby -ryaml` parse of `.github/workflows/release.yml` | 0 | `on.push.tags == ["v*"]`; jobs = [verify, test, publish, release] |
| awk notes-extraction on `CHANGELOG.md` for `0.6.0` | 0 | output begins "### Added - A repository link…" |
| `npm publish --dry-run` | 0 | 110 files incl. all 9 `kanban-flow/github-hooks/*`; version 0.6.0 |
| `gh release create v0.0.0-test --verify-tag --prerelease` | 0 | release created then deleted; tag deleted local+remote |

## Failures and Blockers
`NPM_TOKEN` does not exist in repo secrets yet — the owner must add it before the first tagged release; the publish job will fail loudly without it, never silently.

## Coverage
FR-001: verify job enforces tag == version and CHANGELOG section — both exits precede publish. FR-002: publish job with id-token + NODE_AUTH_TOKEN. FR-003: notes extracted from the matching section, released via `gh release create --verify-tag`.

## Regression
None — a new file on the `v*` trigger only; ci.yml and pages.yml untouched.

## Conclusion
Each step is verified against the real tooling; the chained run on the next tag is the only evidence that cannot exist before merge.

---
uc: "UC-002"
feature: "done-trigger"
context: "cli"
---

# UC-002 — Link a pull request to the work item

## Goal
Record the PR that delivers a work item so `kf issues done` can verify merge state.

## Actors
- Primary: maintainer/agent

## Preconditions
- Work item exists; `.kfw.json` readable.

## Trigger
`kf issues link <feature> <ref>` where `<ref>` is a GitHub PR URL, or `kf issues link <feature> <n> --pr`.

## Main Flow
1. `cmdLink` detects the ref kind: `/pull/<n>` URL (or `--pr`) → pull request; `/issues/<n>` URL or bare number → issue.
2. Writes `pr` (or `issue`) into `.kfw.json` via `writeFeatureMeta`.
3. Prints the recorded link.

## Alternative Flows
- A1. Bare number without `--pr` → issue link (existing behaviour preserved).
- A2. Item already has `issue`, ref is a PR → `pr` is written; both fields may coexist.

## Exception Flows
- E1. Existing `pr` and another PR link → refuse ("already links PR …"), matching the existing `issue` rule.
- E2. Ref matches neither `/issues/N` nor `/pull/N` nor numeric → "neither an issue nor a PR ref" error.
- E3. No `.kfw.json` → "has no metadata file" error (existing).

## Postconditions
- `.kfw.json` carries `pr` (pull URL) alongside or instead of `issue`.

## Business Rules
- `pr` validation mirrors `issue`: `https://<host>/<owner>/<repo>/pull/<n>` only.
- Bare numbers keep meaning "issue" — PR numbers are only unambiguous via URL or `--pr`.

## Acceptance Criteria
- [ ] `kf issues link f https://…/pull/28` writes `pr`; `kf issues link f 26` writes `issue`.
- [ ] `--pr` flag writes `pr` for a bare number.
- [ ] A second PR link refuses; existing `issue` does not block a `pr` link.
- [ ] `readFeatureMeta` rejects a malformed `pr` value.

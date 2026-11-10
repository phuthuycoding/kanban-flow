---
feature: unknown-config-key
context: cli
created: 20261110_1213
kind: feature
status: archived
---
# Spec Requirement

## Feature
unknown-config-key

## Objective
`kf doctor` warns about each top-level key in `.kf/config.json` that kf does not read, and names the likely intended key for a singular/plural slip, so a typo can no longer turn a setting off silently (GitHub issue #131).

## Problem Statement
`parseConfigText` (`src/project/config.ts`) validates the keys it knows and lets every other top-level key pass through unread. A real project carried both `"worktree": { "enabled": false }` and `"worktrees": { "enabled": false }`; editing `worktrees` did nothing and `kf doctor` reported nothing. Today the only config findings `kf doctor` has are for legacy keys (`checkLegacyFields`: `defaultContext`, `stack`, `ship`; plus the removed harness keys).

Journey: the user runs `kf doctor` (or `kf doctor --json`) in a project whose config has `"worktrees": {…}`. The output lists a WARNING for `.kf/config.json`: `unknown_config_key: "worktrees" is not a kf config key and is ignored.` with the action `did you mean "worktree"? rename or remove it`. A key with no near match gets the action `remove it, or keep it as a note (kf ignores it)`. `kf doctor --fix` leaves the key in place, and the warning stays until the user edits the file.

## Scope
### In Scope
- One WARNING finding per unknown top-level key, in the existing `kf doctor` text and `--json` output.
- The known-key set: every top-level key `ProjectConfig` declares (`schema`, `contexts`, `repository`, `project`, `defaultContext`, `stacks`, `stack`, `reviewer`, `agents`, `skills`, `harness`, `worktree`, `created`) plus the legacy `ship` block, so a key that already has its own legacy finding is never also reported as unknown.
- A singular/plural hint: when adding or dropping one trailing `s` gives a known key, the action names it.
- The `kf doctor` row of `docs/workflow/cli-reference.md` and a CHANGELOG entry.

### Out of Scope
- `kf doctor --fix` removing or renaming an unknown key — the key may be a deliberate note.
- Unknown keys nested inside known blocks (`harness`, `worktree`, `project`, `skills`) — those blocks are validated by their own parsers.
- Refusing the config (an error from `readProjectConfig`) for an unknown key — it stays a warning.
- `kf doctor --fix` expanding inline arrays when it rewrites the config (the issue's "Related (minor)") — a separate issue.
- Fuzzy matching beyond the trailing `s` (edit distance, case changes).

## Affected surfaces
- docs/workflow/cli-reference.md
- docs/workflow/autoconfig.md
- CHANGELOG.md

## Actors
- A developer running `kf doctor` on a kf project.

## Functional Requirements
### FR-001
- Requirement: `kf doctor` reports one WARNING finding, area `.kf/config.json`, code `unknown_config_key` in its message, for each top-level key of `.kf/config.json` outside the known-key set, naming the key; a config with only known keys gets no such finding. The finding never changes the exit code on its own (warnings do not fail `kf doctor`).
- Priority: must
- Notes: the known-key set is the `ProjectConfig` top-level keys plus `ship`; keys reported by the legacy checks are known, so they never warn twice.

### FR-002
- Requirement: when an unknown key with one trailing `s` added or removed equals a known key, the finding's action names that key (`did you mean "worktree"?`); otherwise the action says to remove it or keep it as a note. `kf doctor --fix` leaves unknown keys in the file, and the finding is still reported after `--fix`.
- Priority: must
- Notes: `worktrees` → `worktree`, `context` → `contexts`. The hint names only keys kf reads today: the legacy `ship`, `stack` and `defaultContext` are never hint targets (`ships` gets no hint), and as known keys they never warn.

## Non-Functional Requirements
- No new dependency; the check reads the raw config the doctor already reads (`readRawConfig`).
- A config that does not parse, or parses but fails the shape check (the existing invalid-config ERROR), keeps today's behaviour; the new check adds nothing then, as `checkLegacyFields` does.

## Main Use Cases
- UC-001 Doctor reports an unknown config key with a hint

## Constraints
- Warning level only; `--fix` must not edit the key.

## Assumptions
- Keys starting with `$` (for example `$schema` for editor support) are treated like any other unknown key and warned about; kf writes none today.
- The finding text follows the existing doctor findings (`level`, `area`, `message`, `action`); the code name appears at the start of the message, as `statusmap_legacy` does.

## Acceptance Criteria
- [ ] A config with `"worktrees": {…}` beside `"worktree"`: `kf doctor` prints a WARNING naming `worktrees` with the action `did you mean "worktree"?`, and `kf doctor --json` carries the same finding.
- [ ] A config with an unknown key `notes`: the WARNING's action says to remove it or keep it as a note.
- [ ] A config with only known keys, including a legacy `ship` block or `defaultContext`: no `unknown_config_key` finding.
- [ ] After `kf doctor --fix` the unknown key is still in the file and still reported.
- [ ] With only `unknown_config_key` findings, `kf doctor` exits 0.
- [ ] `docs/workflow/cli-reference.md`'s `kf doctor` row names the `unknown_config_key` warning, and CHANGELOG.md's Unreleased section has an entry for it.

## Edge Cases
- Several unknown keys: one finding each, in the order `JSON.parse` gives the keys (integer-like keys first).
- An unknown key whose plural and singular forms are both unknown (`foos`): no hint.
- Config file absent, invalid JSON, or a shape the parser refuses: no `unknown_config_key` finding (the existing findings apply).
- A key with a different case (`Worktree`): unknown, no hint (exact match only).

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (src/tests/doctor.test.ts, run by npm test)
- Coverage Target: 80%

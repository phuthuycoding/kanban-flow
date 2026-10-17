---
feature: "command-tree"
context: "cli"
created: "20261017_1739"
kind: feature
status: confirmed
---

# Spec Requirement

## Feature
command-tree

## Objective
Replace the flat `COMMANDS` record + hand-rolled `positionals[0]` sub-dispatch with a real command tree, and expose a git-flow-style `<noun> <verb>` surface (`kf feature start`, `kf bug start`…) while every legacy flat spelling keeps working.

## Problem Statement
The CLI is a flat switch of 27 commands; nesting exists but only by convention — `worktree`, `issues`, `proxy` each re-dispatch on `positionals[0]` with bespoke usage strings. Adding the ship feature (and future verbs) deepens the inconsistency. There is no single place that describes the command surface, so help output, parsing and dispatch all drift apart.

## Scope
### In Scope
- A command-tree model: a node carries its option spec, help text and either a handler or children; argv resolution walks the longest matching path and parses against the leaf spec.
- Git-flow-style noun→verb surface for the lifecycle: `kf feature start|list|show|move|approve|ship|finish|drop|run`, `kf bug start` plus the same verb set under the `bug` noun (noun documents intent; `bug start` implies `--type bug`; a verb under `bug` refuses a feature-kind item and vice versa).
- Every existing flat command keeps working as an alias; alias help redirects to the canonical form.
- `kf help` / `kf help <path>` render the tree.
- Skill docs (`skills/*/SKILL.md`), `AGENTS.md` seed text and README updated to canonical spellings.

### Out of Scope
- Renaming/removing any existing command — aliases are permanent in this feature, removal is a later major-version decision.
- Changing handler behaviour, option names, exit codes or `CmdResult` — pure dispatch/UX layer.
- The `ship` handler itself — owned by `ship-pipeline`; this feature only places it in the tree (`feature ship`), so `ship-pipeline` lands first.
- Interactive prompts/`--dry-run` UX changes.

## Affected surfaces
- CLI surface: help output shape, all documented spellings.
- `skills/*/SKILL.md` CLI reference blocks.
- `AGENTS.md` template seeded by `kf init`.
- `README.md`, `CHANGELOG.md`, `docs/requirement/cli/`, `docs/use-cases/cli/`.

## Actors
- Human — types commands.
- Agent — invokes commands per skill instructions.
- Scripts/hooks — rely on legacy spellings continuing to work.

## Functional Requirements
### FR-001
- Requirement: a tree registry (e.g. `src/cli/tree.ts`) where a node holds `{ options?, help, run? , children? }`; dispatch resolves the longest argv path; `parseArgs` runs with the leaf node's option spec and `allowPositionals`.
- Priority: must
- Notes: replaces the `switch` in `index.ts` and the flat `COMMANDS` record; `commandHelp`/`allCommands` become tree queries.

### FR-002
- Requirement: lifecycle verbs nest under `feature`/`bug` nouns: `start` (new; `bug start` ⇒ `--type bug`), `list`, `show <name>`, `move <name> <stage>` (stage), `approve`, `ship` (ship), `finish` (archive), `drop` (cancel), `run`. A `bug`-noun verb on a feature item (and vice versa) refuses with a clear message.
- Priority: must

### FR-003
- Requirement: all 27 current flat spellings (`kf new`, `kf stage`, `kf archive`…) keep working byte-for-byte identical behaviour; they are registered as aliases, not duplicated handlers.
- Priority: must
- Notes: aliases may be hidden from the top-level command list but `kf help <alias>` still resolves and names the canonical path.

### FR-004
- Requirement: `kf help` lists the canonical tree grouped by noun; `kf help <path>` (e.g. `kf help feature start`) prints that node's help; unknown paths show nearest-parent help + error.
- Priority: must

### FR-005
- Requirement: handler signatures, `ParsedArgs` shape, `CmdResult` contract and exit codes unchanged; existing tests keep passing plus new tests assert alias↔canonical equivalence.
- Priority: must

### FR-006
- Requirement: `skills/*/SKILL.md`, the seeded `AGENTS.md` text and README reference canonical spellings; per-invocation behaviour of skills is unchanged because aliases resolve.
- Priority: should

## Non-Functional Requirements
- Zero breaking change for scripts/hooks/agents using legacy spellings.
- Ambiguous prefixes (e.g. `kf feat`) refuse, never silently guess.
- Tree definition stays data/declarative — no per-command bespoke re-dispatch remains.

## Main Use Cases
- UC-001 Resolve `kf feature start auth login-flow` to the `new` handler
- UC-002 Legacy `kf stage x implementation` keeps working
- UC-003 `kf help feature` renders the noun's verb list
- UC-004 `kf bug finish` on a feature-kind item refuses

## Constraints
- `node:util` `parseArgs` stays the option parser (no new CLI dependency).
- This feature lands after `ship-pipeline` so `feature ship` has a handler to map.

## Assumptions
- `issues`, `worktree`, `proxy` keep their current subcommand words and are registered as tree children rather than manual `positionals[0]` switches.
- Aliases are silent (no deprecation warning spam); discoverability via `help`.
- Verb set under `bug` mirrors `feature` — the noun only changes `start`'s default type and acts as a kind check elsewhere.

## Acceptance Criteria
- [ ] `kf feature start <name>` creates a work item identical to `kf new`; `kf bug start` sets `kind: bug`.
- [ ] Every current command spelling produces identical output before/after.
- [ ] `kf help` shows the tree; `kf help feature move` shows stage's help.
- [ ] `positionals[0]` re-dispatch inside `worktree`/`issues`/`proxy` is gone — subcommands are tree children.
- [ ] Kind-mismatch (`kf bug finish` on a feature) refuses.
- [ ] No new dependencies; `npm run typecheck`, `npm test` green.

## Edge Cases
- Unknown verb under a known noun (`kf feature wat`) → verb list + error, not the generic "unknown command".
- Positional-heavy leaves (`stage`, `cancel`) keep `allowPositionals` semantics.
- `--help` at any depth resolves to that node's help.
- `kf help <alias>` prints canonical usage.

## Open Questions
- Whether aliases should be listed in top-level `kf help` (hidden vs shown under a "legacy" group).

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`src/tests` — `args.test.ts` rewritten for the tree; alias-equivalence tests)
- Coverage Target: 80%

---
feature: "cli-refactor"
context: "harness"
created: "20261024_1317"
kind: feature
status: confirmed
---

# Spec Requirement

## Feature
cli-refactor

## Objective
Restructure the CLI command layer and the driver along clear responsibility lines — without changing any behaviour — so business logic lives in `workflow`/`harness`, integrations live in `integrations`, and command files only parse arguments and render results.

## Problem Statement
A review of `src/cli/commands/` and `src/harness/drive.ts` after task-harness found:
- `src/harness/drive.ts` is 878 lines and holds three responsibilities: claiming and recording a drive, stopping and reporting it, and the driver loop.
- `cli/commands/archive.ts` holds the canonical-docs sync and the whole archive transaction. `stage.ts`, `sync.ts` and `issues.ts` call it by faking CLI arguments (`cmdArchive({ command: "archive", … })`).
- `cli/commands/cancel.ts` holds the cancel transaction, and it imports canonical-doc paths from `archive.ts`.
- `cli/commands/helpers.ts` mixes three concerns: CLI helpers, bypass bookkeeping (domain logic that `workflow/transition.ts` imports upward from the CLI layer), and GitHub helpers (also imported by `ship/steps.ts`).
- Eleven commands repeat the same find-root → find-item → "Unknown feature" opening.

This is a pure refactor, and it is also the first feature this repository runs through `kf drive`.

## Scope
### In Scope
- Split `src/harness/drive.ts` into `src/harness/drive/` modules by responsibility. `src/harness/drive.ts` stays as a barrel re-exporting the same public API.
- Move `recordBypasses`/`bypassNote` to `src/workflow/bypass.ts`.
- Move `gh` and `checkMergeGate` to `src/integrations/github.ts`. The CLI result renderers (`ghFailure`, `noRepository`) stay in `cli/commands/helpers.ts`.
- Move the canonical-docs functions to `src/workflow/canonical-docs.ts`.
- Move the archive transaction to `src/workflow/archive.ts` as `archiveItem()`, returning a typed outcome. Internal callers use `archiveItem()` instead of `cmdArchive` with synthetic arguments.
- Move the cancel transaction to `src/workflow/cancel.ts` as `cancelItem()`, returning a typed outcome.
- Add a `resolveItem()` helper for the shared command opening, used by the commands that repeat it.
- Update `docs/workflow/source-layout.md` and add a CHANGELOG entry.

### Out of Scope
- Any change to CLI output, exit codes, flags or behaviour.
- `project/doctor.ts` and `workflow/features.ts`: they are under 500 lines and have cohesive responsibilities.
- The agent-guide drift fix (separate PR #73) and the worktree-context work (deferred).

## Affected surfaces
- `docs/workflow/source-layout.md` (module map).
- `CHANGELOG.md`.

## Actors
- Maintainer: reads and changes the code.
- kf CLI users and agents: must see no difference.

## Functional Requirements
### FR-001
- Requirement: `src/harness/drive.ts` is split into modules under `src/harness/drive/` — claim/record, control/status, and the driver loop — each under 500 lines. `src/harness/drive.ts` re-exports the same names, so `cli/commands/drive.ts` and the tests import unchanged.
- Priority: must
- Notes: Closes review FINDING-004 of task-harness.

### FR-002
- Requirement: `recordBypasses` and `bypassNote` live in `src/workflow/bypass.ts`; nothing under `src/workflow`, `src/harness`, `src/ship` or `src/worktree` imports from `src/cli/`.
- Priority: must
- Notes: Closes FINDING-006.

### FR-003
- Requirement: `gh` and `checkMergeGate` live in `src/integrations/github.ts` and are imported from there by `cli/commands/*` and `ship/steps.ts`; `cli/commands/helpers.ts` keeps only CLI helpers (`findRoot`, `resolveItem`, `ghFailure`, `noRepository`).
- Priority: must

### FR-004
- Requirement: The canonical-docs functions (`canonicalContent`, `canonicalDocPaths`, copy preparation, write and rollback) live in `src/workflow/canonical-docs.ts`; `cli/commands/archive.ts` re-exports the previously exported names so existing imports keep working.
- Priority: must

### FR-005
- Requirement: `archiveItem(root, name, opts)` in `src/workflow/archive.ts` performs the archive (delivery gate, docs sync, hooks, move, stamps) and returns a typed outcome; `cmdArchive` renders it with byte-identical stdout, stderr tag and exit code; `stage.ts`, `sync.ts` and `issues.ts` call `archiveItem` instead of `cmdArchive` with synthetic arguments, with their own output unchanged.
- Priority: must

### FR-006
- Requirement: `cancelItem(root, name, opts)` in `src/workflow/cancel.ts` performs the cancel and returns a typed outcome; `cmdCancel` renders it with byte-identical output.
- Priority: must

### FR-007
- Requirement: `resolveItem(cwd, name)` in `cli/commands/helpers.ts` returns the root and the item, or the exact refusal each command printed before (`Unknown feature '<name>'. Run: kf list`, the no-works message); the commands that repeated this opening use it with unchanged output.
- Priority: should

### FR-008
- Requirement: Behaviour is unchanged: typecheck, lint and build pass; the full existing suite passes; no existing test changes other than an import path; new tests pin `archiveItem` and `cancelItem` outcomes and byte-identical `kf archive` / `kf cancel` output for success and refusal paths.
- Priority: must

## Non-Functional Requirements
- No new dependencies.
- No source file over 500 lines after the change.
- No circular imports introduced.

## Main Use Cases
- UC-001 Maintainer finds driver, archive and cancel logic in the layer named after it
- UC-002 CLI users see identical behaviour

## Constraints
- Byte-identical CLI output.
- Old export paths keep working through re-exports.

## Assumptions
- Re-export shims in the old modules are acceptable; they can be removed in a later cleanup.
- `kf drive` runs this item with the harness configured in PR #72; worker sessions are real `claude -p` runs within `budget.maxRuns: 10`.

## Acceptance Criteria
- [ ] `wc -l` shows no file under `src/` over 500 lines.
- [ ] `grep` finds no import of `../cli/` from `src/workflow`, `src/harness`, `src/ship` or `src/worktree`.
- [ ] `stage.ts`, `sync.ts`, `issues.ts` no longer call `cmdArchive`.
- [ ] The full suite passes with only import-path changes in existing tests, plus new archive/cancel outcome and byte-identical output tests.
- [ ] `kf archive` and `kf cancel` outputs for success and refusal fixtures match the pre-refactor recordings exactly.

## Edge Cases
- Archive rollback paths (mid-pass failure) keep their exact error messages.
- `kf stage <f> dones` and reopen-to-dones still route through archive.
- `kf issues done` deprecated alias still forwards to archive.

## Open Questions
- None.

## Test Strategy
- Level: unit+integration
- UI Tests: N/A
- Tools: vitest (`npm test`), existing archive/cancel/stage/sync/issues suites, recorded-output comparison like `transition.test.ts`
- Coverage Target: 80%

---
feature: archive-docs-latest
context: cli
created: 20261013_0957
kind: feature
status: archived
---
# Spec Requirement

## Feature
archive-docs-latest

## Objective
After `kf archive`, the canonical docs under `docs/` describe the system's latest business: every archived artifact carries an archived status, and docs of earlier features that the new feature changes or replaces are reconciled instead of left contradicting the code.

## Problem Statement
Canonical docs are per-feature snapshots copied at archive; nothing reconciles them with later features.
- `archive-after-merge` made `kf archive` close the issue and removed `kf issues done`, yet `docs/use-cases/cli/done-trigger/UC-001-archive-leaves-issue-open.md` still states "Archive never closes an issue", and done-trigger's UC index, UC-003/UC-004 and test plan carry no superseded marker. Only the requirement got a hand-written banner.
- `kf archive` stamps `status: archived` on the requirement mirror only. Every canonical UC index, UC file, diagram and test plan keeps `status: planning`, and UC index rows keep `planned`, across all 15 archived features in `docs/*/cli/`.
- The `kanban-archive` skill asks only to "update other affected docs as needed" and still tells the agent to commit `feat(...)`/`fix(...)`, while since archive-after-merge the archive output lands after the merge as a separate `docs({context}): sync canonical docs for {feature}` change (#35, #38).

## Scope
### In Scope
- `kf archive` stamps `status: archived` in the frontmatter of every canonical copy that has frontmatter (UC index, UC files, diagram, test plan), not only the requirement; the testing result keeps its `PASS` status.
- `kf archive` rewrites the Status cell of the UC index "Use Case Files" table from `planned` to `implemented`.
- `kanban-archive` skill: a new step "Reconcile superseded docs" with its detailed procedure in `skills/kanban-archive/reconcile.md`.
- `kanban-archive` skill: Git handoff matches post-merge archive (`docs({context}): sync canonical docs for {feature}` on its own branch/PR).
- Feature report template: a mandatory "Docs Reconciled" section.
- One-time cleanup of existing canonical docs: superseded banners on done-trigger's UC index, affected UC files and test plan; status stamp for the 15 archived features' canonical docs.
- Workflow docs + CHANGELOG describing the new behavior.

### Out of Scope
- A new standalone skill — the reconcile procedure lives inside `kanban-archive` (decided with the user).
- Automatic detection of superseded docs by the CLI — the judgment stays with the agent; the CLI only stamps status.
- Cleaning brainstorm material out of requirement docs (a Phase 1 / `kanban-brainstorm` concern).
- Unifying the language of existing requirement docs.
- Changing bug closure behavior.

## Affected surfaces
- `skills/kanban-archive/SKILL.md` and new `skills/kanban-archive/reconcile.md`
- `kanban-flow/templates/phase-6-feature-report.md`
- `docs/workflow/artifacts.md`, `docs/workflow/cli-reference.md` (archive row), `docs/workflow/skills.md` (kanban-archive row), `docs/README.md`
- Existing canonical docs under `docs/requirement|use-cases|testplan/cli/`
- `CHANGELOG.md`

## Actors
- Maintainer/agent closing a feature with `kanban-archive` and `kf archive`.
- Reader of `docs/` who needs the current business behavior.

## Functional Requirements
### FR-001
- Requirement: On a feature archive, every canonical copy of the UC index, UC files, diagram and test plan whose source has frontmatter is written with `status: archived`; the testing result keeps its own status; a copy without frontmatter is written unchanged.
- Priority: must
- Notes: Extends the existing `archivedDocument` stamping from the requirement to the other mappings.

### FR-002
- Requirement: The canonical UC index has every `planned` Status cell in its "Use Case Files" table rewritten to `implemented`; other tables and text are untouched.
- Priority: must
- Notes: Only the Status column of that table changes.

### FR-003
- Requirement: Re-archiving an item already in `dones` stays idempotent with the stamped content: unchanged canonical docs report no change, and docs edited after the snapshot are still detected as changed (existing `--skip-specs` / `--force` semantics kept).
- Priority: must
- Notes: The comparison must use the same stamped content that archive writes. A canonical doc written by an older version (unstamped, `planning`) whose stamped form equals the new copy counts as unchanged and is upgraded in place — no `--force`, no bypass record.

### FR-004
- Requirement: `kanban-archive` has a "Reconcile superseded docs" step, before `kf archive`, that points to `reconcile.md`: find earlier canonical docs describing behavior this feature changes (from `## Affected surfaces`, Documentation Impact and a grep of `docs/`), mark contradicted requirement/UC index/UC files/test plan with a `> **Superseded by <feature>.** <what changed>` banner, update `docs/workflow/*` to the new behavior, and never rewrite another feature's snapshot body.
- Priority: must
- Notes: Agent judgment; the step always runs for features.

### FR-005
- Requirement: The feature report has a "Docs Reconciled" section listing each reconciled doc and the change, or `None — <reason>`; the skill requires it before archive.
- Priority: must
- Notes: Makes a skipped reconcile visible at review.

### FR-006
- Requirement: `kanban-archive` Git handoff tells the agent to commit archive output as `docs({context}): sync canonical docs for {feature}` on its own branch/PR after the feature merge, and bug closure doc fixes as `docs({context}): ...`.
- Priority: should
- Notes: Matches #35 / #38.

### FR-007
- Requirement: Existing canonical docs are cleaned once: done-trigger's UC index, UC-001/UC-003/UC-004 and test plan get a superseded banner pointing to archive-after-merge; all archived features' UC index/UC files/diagram/test plan get `status: archived` and `implemented` UC rows.
- Priority: should
- Notes: Applied with the same stamping logic, not by hand edits.

## Non-Functional Requirements
- Stamping never fails an archive: a document without frontmatter is copied unchanged.
- No new dependency; change stays inside `src/cli/commands/archive.ts`, the skill folder, the template and docs.

## Main Use Cases
- UC-001 Archive stamps every canonical doc as archived
- UC-002 Re-archive in dones stays idempotent with stamped docs
- UC-003 Agent reconciles docs superseded by the new feature

## Constraints
- Approved source artifacts in `.works/` are not modified by archive; only canonical copies are stamped.
- `--force` / `--skip-specs` semantics unchanged.

## Assumptions
- `implemented` is the status value for a delivered UC row (template uses `planned`).
- The superseded banner format follows the one already in `docs/requirement/cli/done-trigger.md`.
- Superseded detection stays a skill-level judgment; no CLI heuristic.

## Acceptance Criteria
- [ ] Archiving a test feature writes `status: archived` to the canonical UC index, UC files, diagram and test plan; the result keeps `status: PASS`.
- [ ] The canonical UC index rows read `implemented`; the coverage table is unchanged.
- [ ] Re-running `kf archive` on the dones item reports no changed canonical docs; a hand edit is still reported as changed.
- [ ] Re-archiving a dones item whose canonical docs were written unstamped by an older version upgrades them to `archived` without refusal or bypass record.
- [ ] `skills/kanban-archive/SKILL.md` has the reconcile step and points to an existing `reconcile.md`; the Git handoff names `docs({context}): sync canonical docs for {feature}`.
- [ ] The feature report template contains a "Docs Reconciled" section.
- [ ] `docs/use-cases/cli/done-trigger/UC-001-archive-leaves-issue-open.md` carries a superseded banner; no canonical doc under `docs/*/cli/` keeps `status: planning`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Edge Cases
- Source artifact without frontmatter → copied unchanged.
- UC index without a "Use Case Files" table or with a non-`planned` status → untouched.
- Legacy canonical docs already stamped → stamping again yields identical content.
- Bug archive → no canonical docs, unchanged behavior.
- An older feature whose docs got a superseded banner is re-archived → its docs are reported as changed, and `--skip-specs` keeps the banner (existing semantics).

## Open Questions
- None.

## Test Strategy
- Level: unit
- UI Tests: none
- Tools: vitest (`src/tests/archive-delivery.test.ts`, `src/tests/sync.test.ts`)
- Coverage Target: 80%

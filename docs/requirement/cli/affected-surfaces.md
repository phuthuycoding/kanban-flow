---
feature: "affected-surfaces"
context: "cli"
created: "20261012_1931"
status: confirmed
kind: feature
---

# Spec Requirement

## Feature
affected-surfaces

## Objective

Give the pipeline an explicit **affected-surfaces contract**: every spec must enumerate the user-facing surfaces a change touches (or declare `N/A`), brainstorm-exit refuses a missing/unfilled section, and `kf validate` warns when a declared surface has no matching coverage in the plan — so a feature can no longer pass every gate while leaving the project's public docs factually wrong.

## Problem Statement

Real incident (issue #33): a feature adding a `postgres` engine passed Phase 1–6 cleanly — spec, plan, review, archive, merge — while the project's docs site (`docs/index.html`, ~15 spots) still advertised "MongoDB & MySQL". The workflow models functional requirements and code quality but not *which user-facing surfaces the change touches*:

1. The Phase-1 spec template has no field for surfaces, so nothing is ever declared.
2. Phase 2 only plans for what the spec named — undeclared surfaces get no task.
3. Phase 5 review has no rule class asking "does the diff cover the declared surfaces?".
4. Phase 6 archive syncs canonical docs but nobody owns the product's own documentation.

The pragmatic fix (issue's own proposal, confirmed): a small **explicit human-declared field**, not auto-detection — put it where it can't be skipped.

## Scope

### In Scope
- New `## Affected surfaces` section in the feature spec template (`kanban-flow/templates/phase-1-spec-requirement.md`) — one line per surface or `N/A`, with a suggested checklist in a template comment (README, docs site, landing page, CLI `-h`, examples, changelog, packaging, API reference).
- Gate: leaving `brainstorm` refuses a feature spec whose `## Affected surfaces` is missing or still placeholder — `N/A` counts as filled (confirmed with the human: gate + N/A escape).
- Coverage warning: `kf validate` warns (non-blocking) when a declared surface has no matching mention in `phase-2-implementation-plan.md` task rows or its Documentation Impact section.
- Planning convention: implementation-plan template gains a "docs/surface tasks" expectation — declared surfaces should appear as plan tasks or Documentation Impact entries.
- Skills + docs: `kanban-brainstorm` fills the section, `kanban-plan` carries it into the plan, `cli-reference`/`gates`/`state-machine` docs mention the gate; CHANGELOG.
- Backwards compat: specs written before this feature are not re-gated (the section check applies to items still in `brainstorm`; validate's coverage check skips specs without the section).

### Out of Scope
- Auto-detection of which files are "docs surfaces" — the issue itself calls this unreliable; the field is human-declared.
- Applying the section to the bug template — the bug report already carries a `Documentation Impact` table.
- Migrating or rewriting existing confirmed specs.
- Enforcing that docs content is *correct* — the contract guarantees surfaces are *named and covered*, not reviewed for prose quality.

## Affected surfaces
- workflow docs (`docs/workflow/gates.md`, `cli-reference.md`)
- agent skills (`skills/kanban-brainstorm`, `skills/kanban-plan`)
- spec + plan templates (`kanban-flow/templates/`)
- CHANGELOG

## Actors
- Human maintainer — declares the surfaces at brainstorm (can't skip: gate).
- Agent — writes the spec section, plans a task or doc-impact entry per declared surface.
- `kf validate` — emits the coverage warning.
- `kf stage` — enforces the brainstorm-exit gate via the existing artifact gate.

## Functional Requirements

### FR-001
- Requirement: The feature spec template gains `## Affected surfaces` — one bullet per user-facing surface the change touches, or the literal `N/A`. The section sits between `## Scope` and `## Actors`.
- Priority: must
- Notes: Template ships a commented suggestion list so the author knows what counts as a surface.

### FR-002
- Requirement: The artifact gate refuses `brainstorm → planning` for a feature spec whose `## Affected surfaces` is absent, missing, or still placeholder text. `N/A` (case-insensitive, sole content) counts as filled.
- Priority: must
- Notes: Implemented inside the existing spec validation path — bugs and pre-feature specs unaffected.

### FR-003
- Requirement: `kf validate` emits a WARNING per declared surface found nowhere in the implementation plan's TASK rows or Documentation Impact — non-blocking, heuristic match on the surface's own words.
- Priority: must
- Notes: WARNING not ERROR — fuzzy matching will false-positive; the contract's teeth are the brainstorm gate, this is the safety net.

### FR-004
- Requirement: Planning carries declared surfaces into work: the implementation-plan template documents that each declared surface needs a task or a Documentation Impact entry.
- Priority: should
- Notes: Convention, not a new artifact — the plan template gains a line in the relevant section.

### FR-005
- Requirement: Skills and docs teach the contract — `skills/kanban-brainstorm` (fill the section, ask when unclear), `skills/kanban-plan` (cover declared surfaces), `docs/workflow/cli-reference.md` + `gates.md`, CHANGELOG.
- Priority: must
- Notes: Without the skill updates the field exists but nobody writes it.

## Non-Functional Requirements
- Heuristic matching is deliberately simple (surface words appear in plan text) — false positives are warnings, never blocks.
- Zero schema changes to `.kfw.json`, hooks, or the stage model — the gate lives in artifact validation.
- Backwards compatible: old specs without the section parse fine; coverage check no-ops without the section.

## Main Use Cases
- UC-001 Spec gate refuses an unfilled surfaces section — brainstorm-exit blocked, `N/A` accepted.
- UC-002 Declared surfaces flow into the plan — agent writes tasks/doc-impact entries per surface.
- UC-003 Validate warns on uncovered surface — heuristic catches a declared-but-unplanned surface.
- UC-004 Code-only change with N/A — honest escape, no warning.

## Constraints
- The gate applies to `kind: feature` specs only — bug reports keep their `Documentation Impact` field.
- Section must be machine-findable: exact heading `## Affected surfaces` (kebab/space naming convention consistent with sibling sections).
- No new artifact files, no stage changes, no `.kfw.json` fields.

## Assumptions
- One-word or short-phrase surface names (`docs site`, `README`, `landing page`) are enough for the heuristic — no canonical taxonomy is enforced.
- The issue's own proposal (explicit human-declared field over auto-detection) is the intended design — confirmed.
- Issue #33 is the linked tracker item; auto-created #36 closed as duplicate.

## Acceptance Criteria
- [ ] A feature spec with `## Affected surfaces` unfilled/missing refuses `brainstorm → planning` with a clear error.
- [ ] `N/A` as the section content passes the gate.
- [ ] A declared surface absent from the plan produces a `kf validate` WARNING (not blocking).
- [ ] A declared surface covered by a task or Documentation Impact produces no warning.
- [ ] Bug specs and pre-feature specs are unaffected by the new checks.
- [ ] Spec/plan templates, `kanban-brainstorm`/`kanban-plan` skills, cli-reference/gates docs and CHANGELOG all reflect the contract.
- [ ] Coverage ≥80%; existing suite green.

## Edge Cases
- Spec edited post-approval to remove the section → contract fingerprint catches it (approval_changed), existing behavior.
- Surface named in the spec but spelled differently in the plan → heuristic may still warn; acceptable (warn, not block).
- Section present but containing only template suggestion comments → treated as unfilled (placeholder check, not section-presence check).
- Multiple surfaces, some covered some not → per-surface warnings for the uncovered ones only.

## Open Questions
- Should `kf doctor` also surface uncovered-surface findings, or is `kf validate` enough? (Default: validate only — doctor stays project-health, not contract detail.)
- Exact heading wording: `## Affected surfaces` vs `## Docs surfaces` — picked the issue's own term; confirm.

## Test Strategy
- Level: unit
- UI Tests: none
- Tools: vitest + existing fixture pipeline (cmdNew → spec write → stage transitions); fixture specs gain the section
- Coverage Target: 80%

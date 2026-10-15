---
feature: worktree-dotdir
context: worktree
created: 20261015_1948
kind: feature
status: archived
---
# Feature Spec

## Feature Name
worktree-dotdir

## Context
worktree

## Objective
Default worktree location becomes `<repo>/.worktrees/<feature>` — inside the repo — instead of the sibling `<repo>-worktrees/` directory, keeping sibling `baseDir` as an explicit override.

## Problem Statement
Sibling worktree dirs clutter the parent folder (`tmoi.link-worktrees/`, `MoiCash-worktrees/` next to the repo). Users running `git`-centric tools and IDEs expect checkouts namespaced inside the project. A dot-dir inside the repo is tidier, self-cleaning on repo deletion, and consistent with the `.works/` convention already in place.

## Goals
- Default `worktree.baseDir` = `<repo>/.worktrees` for worktrees created after the change.
- `.worktrees/` is guaranteed gitignored — bootstrap adds it next to `.works/`, and `ensureWorktree` appends it lazily for repos whose `.gitignore` predates the convention (otherwise the main checkout reads dirty on every status).
- Existing worktrees under a sibling dir keep working: registrations store absolute paths; `listWorktrees`/orphan detection run on `git worktree list`, not on the default dir.
- `worktree.baseDir` project config and any explicit path still win over the default.

## Non-Goals
- Migrating already-created sibling worktrees into `.worktrees/` — they stay where they are until removed.
- Changing branch prefixes, domain routing, or ADE attach behavior.

## User Stories
1. As a user, `kf worktree create x` puts the checkout at `<repo>/.worktrees/x` and `git status` on the main checkout stays clean.
2. As a user of a repo initialized before this change, the first create still keeps `git status` clean (lazy `.gitignore` append).
3. As a user with `worktree.baseDir` set, nothing changes — my explicit path wins.

## Functional Requirements
### FR-001
- Priority: must
- Requirement: `worktreeConfig` default `baseDir` resolves to `join(root, ".worktrees")` (absolute); explicit `worktree.baseDir` unchanged.
- Acceptance: default path is `<root>/.worktrees/<feature>`; tests asserting the old default updated.
- Edge cases: repo paths with spaces; worktree of a bare repo (unchanged — baseDir override).

### FR-002
- Priority: must
- Requirement: `ensureWorktree` (create path) appends `.worktrees/` to the main checkout's `.gitignore` when the resolved default dir lives inside the repo and isn't already ignored (substring or pattern match). Bootstrap's init prompt adds `.worktrees/` alongside `.works/`.
- Acceptance: after `worktree create` on a repo lacking the entry, `.gitignore` contains `.worktrees/`; no duplicate lines on repeat runs; no write when `baseDir` points outside the repo.
- Edge cases: missing `.gitignore` (create it); `.gitignore` that has `.worktrees` (no slash) or `/.worktrees/` — treat as covered; read-only/unclean index — fail create? No: warn and proceed (git status will show the dir but the worktree works).

### FR-003
- Priority: should
- Requirement: docs updated — `docs/workflow/cli-reference.md` baseDir row + any `<repo>-worktrees` references; changelog entry.
- Acceptance: no stale sibling-dir wording in the user-facing docs.

## Technical Constraints
- Keep the `baseDir` escape hatch absolute-or-relative semantics intact (`resolve(cfg.baseDir)` unchanged for explicit values).
- `.worktrees/` inside the repo must never be committed — lazy ignore write happens before `git worktree add` so the branch cut never sees the dir as content.

## Assumptions
- Users prefer the dot-dir default; the sibling layout stays reachable via config.
- Nested-worktree lookup via `findWorksRoot` is unaffected: walking up from `<repo>/.worktrees/<f>` still hits `.works/` at `<repo>` first, and `git rev-parse --git-common-dir` resolves identically.

## Success Criteria
- [ ] Fresh `kf worktree create` lands at `<repo>/.worktrees/<feature>` on a clean `git status`.
- [ ] A repo with an older `.gitignore` (only `.works/`) gets `.worktrees/` appended on first create.
- [ ] Explicit `worktree.baseDir` continues to be honored for both existing sibling worktrees and new paths.
- [ ] `git worktree list`/`listWorktrees`/orphan detection unchanged across both layouts.

## Dependencies
- None beyond existing worktree lifecycle modules.

## Open Questions
- Should `.worktrees/` also hide in editor/IDE tooling via a `.code-workspace` hint? → Out of scope; revisit if users ask.

## Affected Surfaces
- `src/worktree/config.ts` (`worktreeConfig` default), `src/worktree/lifecycle.ts` (`ensureWorktree` lazy ignore), `src/project/bootstrap.ts` (init `.gitignore` prompt), `docs/workflow/cli-reference.md`, CHANGELOG, tests.

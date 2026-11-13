# Monorepo Review Rules

## Package Boundaries
- A package imports another only through its public entry point — no deep import into another package's `src` or internal path
- Dependency direction follows the workspace's layers (apps → features → shared); a shared package never imports an app or a feature
- No circular dependency between packages
- Code used by one package stays in it; it moves to a shared package when a second consumer exists, not before

## Dependencies & Versions
- Every package declares what it imports in its own manifest — nothing resolved only because a sibling or the root hoists it
- Internal packages are referenced with the workspace protocol or path the repository uses, never a published version of themselves
- One version of a shared third-party dependency across the workspace, unless the manifest says why a package differs
- The lockfile changes with the manifests in the same commit; a lockfile change with no manifest change is explained

## Build, Test & CI
- A changed package's build, lint and tests run, and so do those of the packages that depend on it
- Task pipeline config (cache inputs, outputs, dependsOn) is updated when a package gains a new input, output or env var
- No task writes outside its own package's output directory; generated files are not committed unless the repository commits them
- A new package ships with the standard scripts and config the others share (lint, typecheck, test), by extension not by copy

## Changes Across Packages
- A change to a shared package's public API updates every consumer in the same change, or keeps the old signature working
- A breaking change to a published package carries the version bump or changeset the repository's release flow requires
- Shared types, schemas and contracts have one definition that consumers import — no hand-copied duplicate
- Environment variables are read by the app that owns them; a shared package takes configuration as arguments

## Ownership
- A change spanning several packages says in its description which ones and why they move together
- Root-level config (tsconfig base, lint, CI) is not edited to make one package pass

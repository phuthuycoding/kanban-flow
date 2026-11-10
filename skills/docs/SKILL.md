---
name: docs
description: Consolidate a project's legacy docs snapshots (docs/requirement, docs/use-cases, docs/testplan) into the living docs under docs/specs, one context per run. Use when kf doctor lists "Legacy docs not consolidated" or the user asks to migrate or consolidate the docs.
---

# Docs — consolidate legacy snapshots into living specs

Plugin root: `${CLAUDE_PLUGIN_ROOT}` — resolve it to the path this skill was loaded from.

`docs/specs/` is the current description of the system. The legacy snapshots are history awaiting consolidation. This skill moves their content into specs, one context at a time, and leaves the merge to the human.

## Procedure

1. Run `kf doctor --json` and read the legacy docs finding: the contexts and files still to consolidate. Pick one context per run; when several remain, name them and ask which comes first.
2. Check the branch with `git branch --show-current`. Never work on the default branch. Ask the user before creating the branch for this run, name it, and wait for the yes.
3. Read the context's legacy files and the existing `docs/specs/` files. Build a table: each legacy file, the spec file it folds into (new or existing), and what is dropped as obsolete.
4. Present the table and wait for the user to approve it. Write nothing until the table is approved; an edit to the table is approved again.
5. Write the spec files and update the index in `docs/specs/README.md` as the table says. Remove a legacy file only when its content is fully folded in; keep a feature's legacy files together, never half-removing one feature.
6. Run `kf validate --all --base <default branch>` before the PR and fix every finding it lists. Run `kf doctor` to confirm the context no longer appears.
7. Commit on the branch and open the PR. Never merge it: the human merges.

## Never

- Never merge, never push to or commit on the default branch.
- Never write before the table is approved.
- Never consolidate more than one context in a run.

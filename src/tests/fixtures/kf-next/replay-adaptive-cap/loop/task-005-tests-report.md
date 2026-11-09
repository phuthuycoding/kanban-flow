# TASK-005 tests report

Files: src/tests/open-source-surface.test.ts (extended), src/tests/worktree-domains-surface.test.ts (new).
CHANGELOG-based assertions (the unreleased and released 0.14.0 text) untouched.

## open-source-surface.test.ts (replaced the "/4 developers/" test, changed the wait-line needle)
- states the live developer cap rule in the README, the harness guide and the Pages site (W1, windowed around "starts at min(2, ceiling)")
- states no fixed cap of 4 developers anywhere in the user-facing docs (README, harness, lifecycle, cli-reference, Pages)
- documents harness.developers.max with its range and default in the README and the harness guide
- shows the developers-in-flight wait line with a count in the README and the harness guide (W2)
- documents the developers field of kf tasks --json in the CLI reference (W3)
- carries the wait lines ... (existing; needle now `developer waits — <N> developers in flight`)

## worktree-domains-surface.test.ts
- tells every skill and the automation-writer to use the direct URL when domains are off (W5, five files)
- says the JSON outputs still carry domain but must not be used (full W5 sentence, four files)
- says KFW_WORKTREE_DOMAIN is set only when domains are on, autoconfig + cli-reference (W6)
- mentions worktree.domains in the kf worktree help
- documents worktree.domains as a boolean defaulting to true in README, autoconfig, Pages
- describes what the switch turns off in README, autoconfig, Pages (W4 phrases)
- turns the domain off in this repository's own config (JSON parsed)

## TC mapping
TC-010 -> the five live-cap tests in open-source-surface.test.ts (describe "the docs describe concurrent developers in one worktree")
TC-016 -> the seven tests in worktree-domains-surface.test.ts
Out of scope (UI/E2E): none.

## Run
`npx vitest run src/tests/open-source-surface.test.ts src/tests/worktree-domains-surface.test.ts` -> exit 1, 2 failed | 48 passed (docs lanes landed part of the wording while I wrote).
Failing, for the right reason (wording missing):
- "says the JSON outputs still carry domain but must not be used ...": skills/implement/SKILL.md lacks the full W5 sentence "When worktree.domains is false in .kf/config.json, use http://127.0.0.1:<port> (the JSON outputs still carry domain; do not use it then)" (controller-owned line :26).
- "documents worktree.domains as a boolean defaulting to true ...": docs/workflow/autoconfig.md lacks "worktree.domains (boolean, default true)" adjacent (line 68 words it "`worktree.domains` is `false` (boolean, default `true`)").
Earlier runs (before lanes landed) also failed the wait-line, W5, W4 and boolean pins for the missing wording.

## Concerns
- Pins that now pass were not seen red against the final docs; each is a plain substring check on the rule's own text so removing the rule fails it. Not independently mutation-checked.
- The boolean pin expects the literal "worktree.domains (boolean, default `true`)" (backticks ignored); autoconfig.md currently words it differently, so Lane C must adopt W4's form there (or tell me to relax).
- Pages has no wait line today; the wait-line pin covers README and harness.md only, per the brief's file lists.

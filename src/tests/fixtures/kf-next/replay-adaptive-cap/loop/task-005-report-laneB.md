# TASK-005 lane B report (docs only)

Commit 4cca0c7 "docs(workflow): live developer cap, developers field and domain-off env".

Files (post-edit line numbers):
- docs/workflow/harness.md: 9, 16-17, 23 (config block + `harness.developers.max` bullet), 44 (wave-width wording), 46 (live cap, W2 wait line, rulings, `Note wave <w>: no step-up`, `loop/task-NNN-verify.log`).
- docs/workflow/lifecycle.md: 67 (live cap wording).
- docs/workflow/cli-reference.md: 43 (`developers: {max, source}`), 46 (`<N> developers in flight`), 54, 64, 66 (domain only when `worktree.domains` on; W4/W6).

Checks: `grep -n "4 developers\|wave width, 4"` on the three files returns nothing. No tests run (docs only, full suite not allowed).

Concerns: harness.md has no `<item>/loop/` artifact list, so the verify.log is mentioned inside the loop paragraph (line 46). Line 44 now reads "N = the wave width, held to the live developer cap".

---
name: kanban-review
description: 'Review a kanban feature or bug against its approved scope, current testing evidence and layered review rules. Write PASS/FAIL/REJECT/REQUIREMENT_BUG for the current execution. Use in review.'
---

# Kanban Phase 5 — Review (Autonomous)

Argument: `<feature_name>`.

Stand on quality, not survivor. Load layered review rules, audit the changes, and write a report whose `status:` is the truth `kf` trusts.

---

## 1. Move to review

```bash
kf stage {feature_name} review
```

(Already there → skip. If the move is refused, run `kf validate --change {feature_name}` — a missing/stale or non-PASS testing report blocks this direction; loop back through kanban-test.)

## 2. Load review rules

- Resolve rules per filename in project → user → package order. Include general, security and performance plus the project's stack rule when available.
- Project: `{project_root}/.kf/review/rules/*.md`; user: `~/.kf/review/rules/*.md`; package: `kanban-flow/review/rules/*.md` beside the installed CLI's package.json. If no rule source is available, report the missing rules instead of silently skipping review.
- Stack packs (`node`, `go`, `rust`, `python`, `php`, `ruby`, `java`) are opt-in: if the project's stack has no `{stack}.md`, suggest `kf rules` (auto-detect) or `kf rules --stack <id>` to install it — they are not auto-loaded from `kanban-flow/review/stacks/`.

Review **only files actually changed**. Record findings with severity HIGH / MEDIUM / LOW. Reproduce plausible failures — don't infer.

Use the `## Baseline` recorded at the top of `tasks.md` (starting HEAD + pre-existing working-tree changes) to include committed, staged, unstaged and new untracked feature files. Preserve unrelated pre-existing changes. Verify the testing report is PASS for the current execution id. After any implementation fix, loop through testing again before writing a new review result.

## 3. Write review-report

For `kind: bug`, review against the bug report and existing feature behavior. Check reproduction evidence, regression tests and fix scope; do not demand feature planning artifacts. Record the verified root cause and whether related feature docs need an update. If no documentation changes are needed, say why.

```bash
kf instruct review-report --change {feature_name}
```

Fill `phase-5-review-report.md`, set frontmatter `status:` to exactly one of:

- `PASS` — no HIGH blockers; change is shippable
- `FAIL` — HIGH blockers / broken tests
- `REJECT` — does not meet DoD / acceptance criteria
- `REQUIREMENT_BUG` — the requirement itself is wrong vs. real product need

Set `execution:` to the current id from instruct and keep Review Status/Final Decision consistent with frontmatter. Assess MEDIUM findings against acceptance and DoD; do not declare PASS merely because there are no HIGH findings.

## 4. The directional gate decides

- `PASS` → load kanban-archive for the applicable feature/bug closure before running `kf archive`.
- `FAIL`/`REJECT` → **structural fix needed**: loop back, re-implement, then the feature must be **re-tested before review again** (kanban-test skill).

```bash
kf stage {feature_name} implementation
```

- `REQUIREMENT_BUG` → **STOP FEATURE.** Do not silently rewrite the requirement — report back to the user what the review found and ask how to proceed. `kf stage` blocks all movement here by design.

---

## Done

A decisive report written. Hand off:

```text
If PASS: load the kanban-archive skill.
If FAIL/REJECT: load kanban-implement (then kanban-test before returning here).
If REQUIREMENT_BUG: stop and report to the user.
```

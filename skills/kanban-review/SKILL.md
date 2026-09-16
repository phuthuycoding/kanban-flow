---
name: kanban-review
description: Review a feature against project rules and conventions. Use when user says "review feature", "kanban review", "review {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Review

Move task from testing → review, then execute code review using loaded rules.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`.

---

## Workflow

### Step 1: Find and load the task

1. Find folder in `.works/testing/{feature_name}_*/`
2. Read `tasks.md` — what was built
3. Read `test-plan.md` — what it should do
4. Read `docs/use-cases/{context}/{feature_name}.md` — the spec

### Step 2: Move to review

```bash
mv .works/testing/{feature_name}_{timestamp} .works/review/
```

### Step 3: Load review rules

Load rules from two layers:

**Layer 1 — Global rules:**
```
~/.claude/kanban-flow/review/rules/general.md
~/.claude/kanban-flow/review/rules/security.md
~/.claude/kanban-flow/review/rules/performance.md
~/.claude/kanban-flow/review/rules/{stack}.md  (if exists)
```

**Layer 2 — Project rules (if exist):**
```
{project_root}/.claude/review/rules/*.md
```

**Merge:** Project rules override global rules with same filename.

### Step 4: Identify files to review

Based on `tasks.md`, find all created/modified files:
```bash
git diff --name-only HEAD~{N}  # if committed
git status --porcelain          # if not committed
```

### Step 5: Review each file

For each file, check against loaded rules:

**general.md rules:**
- Error handling pattern correct?
- No empty catch blocks?
- File under 500 lines?
- No unnecessary comments?
- No style-only changes?

**security.md rules:**
- No hardcoded secrets?
- Input validated at boundary?
- Auth checked before business logic?

**performance.md rules:**
- No N+1 queries?
- Pagination on list endpoints?
- Proper timeouts on external calls?

**Project-specific rules:**
- Follows project conventions?
- Matches existing patterns?

### Step 6: Generate review report

Use template: `~/.claude/kanban-flow/templates/review-report.md`

Write to: `.works/review/{feature_name}_{timestamp}/review-report.md`

Classify each violation by severity:
- **HIGH** — Must fix (security, data loss, crash)
- **MEDIUM** — Should fix (performance, maintainability)
- **LOW** — Suggestion (can defer)

### Step 7: Gate decision

**All pass (no HIGH/MEDIUM violations):**
> "Review PASS! Score: A/B. Ready to archive. Use /kanban-archive {feature_name}"

**HIGH violations found:**
> "Review found {N} HIGH severity issues that must be fixed:
> - {violation_1}
> Options:
> 1. Fix now (back to /kanban-implement)
> 2. Document as known issue and proceed
> What do you prefer?"

**MEDIUM violations only:**
> "Review found {N} MEDIUM suggestions. Score: B.
> Proceed to archive or fix first?"

---

## Gate

- [ ] Task moved from `.works/testing/` to `.works/review/`
- [ ] All review rules loaded
- [ ] All files reviewed
- [ ] Review report generated
- [ ] Score assigned (A/B/C/F)
- [ ] **User APPROVED or issues addressed**

## Output format

```
## Review: {feature_name}

### Score: {A/B/C/F}

### Gate
✓ Build passes
✓ Tests pass
✓ Security rules: {N} passed
✓ Performance rules: {N} passed
✓ Code conventions: {N} passed

### Violations
{IF any:}
| Severity | File | Rule | Issue |
|----------|------|------|-------|
| MEDIUM | auth/handler.ts:42 | error_handling | Empty catch block |

{IF none:}
No violations found.

### Files reviewed
- {file_1}: ✓
- {file_2}: ✓

Ready to archive? Use /kanban-archive {feature_name}
```

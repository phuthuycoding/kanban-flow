---
name: kanban-archive
description: Archive a completed feature. Use when user says "archive feature", "kanban archive", "archive {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Archive

Move task from review → done, and sync docs.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`.

---

## Workflow

### Step 1: Find and load the task

1. Find folder in `.works/review/{feature_name}_*/`
2. Read all artifacts to verify completeness

### Step 2: Pre-archive checks

Verify:
- [ ] `test-plan.md` — all scenarios tested
- [ ] `tasks.md` — all tasks checked `- [x]`
- [ ] `review-report.md` — score A or B (no unresolved HIGH violations)
- [ ] Tests passing in current branch
- [ ] Build passing

If any check fails, stop and report what's missing.

### Step 3: Move to done

```bash
mv .works/review/{feature_name}_{timestamp} .works/dones/
```

### Step 4: Sync docs

**Step 4a: Update use case spec**
- Copy/sync final state of `docs/use-cases/{context}/{feature_name}.md`
- Mark as archived: add `archived: {timestamp}` to frontmatter

**Step 4b: Update project docs if needed**
Based on impact assessment from brainstorm:
- Update README if feature changes quick-start
- Update API docs if new endpoints added
- Update CHANGELOG if significant change

### Step 5: Git operations (if applicable)

```bash
git add .
git commit -m "feat({context}): archive {feature_name}"
```

**Do NOT push** unless user explicitly asks.

### Step 6: Final report

Show complete history of the feature:

```
## Feature Archived: {context}/{feature_name}

### Timeline
- Brainstorm: {date}
- Plan approved: {date}
- Implementation: {date}
- Tests: {date} ({N}/{M} passed)
- Review: {date} (score: {A/B})
- Archived: {date}

### Files
- Created: {list}
- Modified: {list}

### Artifacts
- docs/use-cases/{context}/{feature_name}.md ✓
- .works/dones/{feature_name}_{timestamp}/ ✓

### Docs updated
- {doc_1}: ✓
- {doc_N}: ✓

Feature complete! 🎉
```

---

## Gate

- [ ] All pre-archive checks pass
- [ ] Task moved to `.works/dones/`
- [ ] Docs synced
- [ ] Git commit created (if applicable)
- [ ] Final report shown to user

## Output format

After archive completes:

```
## Archive Complete: {feature_name}

Total time from brainstorm to done: {duration}
Artifacts archived to: .works/dones/{feature_name}_{timestamp}/

Ready for next feature? Start with /kanban-brainstorm {next_feature}
```

---
name: kanban-plan
description: Plan a feature — create test plan and implementation plan from brainstorm output. Use when user says "plan feature", "kanban plan", "plan {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Plan

Read brainstorm output and create test plan + implementation plan.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`.

---

## Workflow

### Step 1: Load brainstorm output

Find the use case spec:
1. Check `docs/use-cases/{context}/{feature_name}.md`
2. Also check `docs/use-cases/**/{feature_name}.md` if context unclear
3. If not found, stop and ask user to run brainstorm first

Read the file. Understand the feature.

### Step 2: Create test plan

Use template: `~/.claude/kanban-flow/templates/test-plan.md`

For each acceptance criterion in the spec:
- Write concrete scenarios (Given/When/Then format)
- Include **Input** (the exact input data)
- Include **Expected Output** (the exact expected result)
- Mark priority: P0 (critical path), P1 (important), P2 (nice-to-have)

Include edge cases from the spec as separate scenarios.

### Step 3: Create implementation plan

Use template: `~/.claude/kanban-flow/templates/tasks.md`

Break the feature into phases following project architecture:
1. Read existing reference module to know file structure
2. Mirror the reference module's patterns
3. Tasks should be atomic (one clear action per task)
4. Order tasks by dependency (domain before infrastructure before app)

If project uses DDD:
```
Phase 1: Domain (VO → Entities → Events → Ports → UseCases)
Phase 2: Infrastructure (Store, Adapters)
Phase 3: Application (Service, Handler, Listeners)
Phase 4: Wiring (Router, Migrations, Registry)
Phase 5: Tests
```

### Step 4: Create feature folder in .works

Create: `.works/pending/{feature_name}_{timestamp}/`

Files:
- `test-plan.md` (from step 2)
- `tasks.md` (from step 3)
- `spec-link.md` → pointer to `docs/use-cases/{context}/{feature_name}.md`

timestamp format: `YYYYMMDD_HHmm` (e.g. `20260916_1700`)

### Step 5: Show output and get approval

Present plan to user:
> "Plan đã tạo. Anh xem qua test plan và implementation plan. OK thì em move sang implement?"

Show:
- Number of test scenarios
- Number of tasks, broken down by phase
- Risk areas if any

**Wait for user approval.** Do NOT proceed without approval.

---

## Gate

- [ ] Brainstorm output found and read
- [ ] Test plan created (with input/expected for each scenario)
- [ ] Implementation plan created (task breakdown by phase)
- [ ] Feature folder created in `.works/pending/`
- [ ] **User APPROVED plan before proceeding**

## Output format

```
## Plan Complete: {feature_name}

### Test Plan
- {N} scenarios (P0: {x}, P1: {y}, P2: {z})

### Implementation
- {N} tasks across {M} phases
- Estimated complexity: LOW/MEDIUM/HIGH
- Risk areas: {list}

### Location
.works/pending/{feature_name}_{timestamp}/

Ready to implement? Use /kanban-implement {feature_name}
```

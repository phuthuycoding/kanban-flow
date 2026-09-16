---
name: kanban-implement
description: Implement a feature by executing the task plan. Use when user says "implement feature", "kanban implement", "implement {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Implement

Move task from pending → doing, then execute tasks by spawning parallel agents.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`.

---

## Workflow

### Step 1: Find and load the task

1. Find folder in `.works/pending/{feature_name}_*/`
2. If not found, check `.works/doing/` — may already be in progress
3. Read `tasks.md` to understand the work

### Step 2: Move to doing

```bash
.mv .works/pending/{feature_name}_{timestamp} .works/doing/
```

### Step 3: Read context

Read these files:
- `tasks.md` — what to implement
- `test-plan.md` — what to build toward
- `docs/use-cases/{context}/{feature_name}.md` — the spec
- Reference similar existing module in project

### Step 4: Break tasks into parallel groups

Analyze dependencies between tasks:
- **Independent tasks** → can run in parallel (spawn multiple agents)
- **Dependent tasks** → must run sequentially

Group tasks like this:
```
Group A (parallel): task 1, task 2, task 3 — all independent
Group B (sequential after A): task 4 — depends on Group A
Group C (parallel after B): task 5, task 6
```

### Step 5: Execute tasks

For each group:

**Parallel tasks:** Use `Task` tool to spawn multiple agents concurrently. Each agent gets:
- The specific task(s) to implement
- Reference files to read (for patterns)
- The test scenario it should satisfy
- Clear acceptance criteria

**Sequential tasks:** Implement directly in main agent.

After each task:
- Verify it compiles/builds
- Mark `- [ ]` → `- [x]` in `tasks.md`

### Step 6: Quality gate after all tasks

Run:
```bash
{build_command} && echo PASS || echo FAIL
```

If FAIL → fix before proceeding.

### Step 7: Show progress

When complete or paused, show:

```
## Implementation Status: {feature_name}

### Completed this session
- [x] Task 1: {description}
- [x] Task 2: {description}

### Overall progress
- {N}/{M} tasks complete
- Status: COMPLETE / PAUSED (reason)

Ready for testing? Use /kanban-test {feature_name}
```

---

## Gate

- [ ] Task moved from `.works/pending/` to `.works/doing/`
- [ ] All tasks executed or blocked with reason
- [ ] Build passes
- [ ] `tasks.md` updated with checkboxes
- [ ] **User CONFIRMED to proceed to test**

## Spawn agent guidelines

When spawning parallel agents, include in prompt:
```
You are implementing task: {task_description}
Project context: {relevant_files_to_read}
Constraints: Follow existing patterns, do not add unnecessary abstractions
Output: Make the code changes, then confirm what was done.
```

## Output format

```
## Implementing: {feature_name}

Working on Group A (parallel): task 1, 2, 3
[spawning agents...]

✓ Task 1 complete
✓ Task 2 complete
✓ Task 3 complete

Working on Group B (sequential): task 4
[implementing...]

✓ Task 4 complete

All tasks complete! Run /kanban-test {feature_name}
```

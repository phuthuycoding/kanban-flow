---
name: kanban-run
description: Run feature implementation automatically end-to-end (implement → test → review → archive). Use after plan is approved. Use when user says "run feature", "kanban run", "implement and test {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Run — Auto pipeline

Run implement → test → review → archive in one pass. No human interaction unless blocked.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`

## What this does

1. Load plan from `.works/pending/`
2. Implement all tasks
3. Run tests
4. Review code against rules
5. Archive + sync docs
6. Report result

**Only stops** when: build fails, tests fail, or HIGH review violations found.

---

## Step 1: Load the plan

Find folder:
```
.works/pending/{feature_name}_*/
```

If not found → check `.works/doing/` (may already started) or `.works/review/` or `.works/testing/`.
If nothing found → stop: "No plan found. Run /kanban-brainstorm + /kanban-plan first."

Read these files from the feature folder:
- `tasks.md`
- `test-plan.md`
- `spec-link.md` → read the linked use case spec

---

## Step 2: Move to doing

```bash
.mv .works/pending/{feature_name}_{timestamp} .works/doing/
```

---

## Step 3: Implement (auto)

### 3a: Read reference
Pick smallest existing module in project as pattern reference. Read its files to learn conventions.

### 3b: Break tasks into parallel groups
Analyze `tasks.md` for dependencies:
- Independent tasks → parallel
- Dependent tasks → sequential after their dependencies

### 3c: Execute parallel tasks

Spawn multiple agents using `Task` tool, one per independent task or group. Each agent prompt:

```
You are implementing a feature. Here is the context:
- Use case spec: {content of usecase-spec.md}
- Task: {task description}
- Reference patterns: {relevant file paths to read}
- Constraints: Follow existing code patterns, no unnecessary abstractions.

Make the code changes. When done, confirm what files were created/modified.
```

### 3d: Execute sequential tasks
Implement directly in main agent, one by one.

### 3e: Mark progress
After each task completes, update `tasks.md`: `- [ ]` → `- [x]`

### 3f: Build gate
Run:
```bash
{build_command} && echo PASS || echo FAIL
```

**If FAIL:**
1. Show the error
2. Stop. Ask user: "Build failed. Options: fix it / abort"
3. Wait for user response before continuing

**If PASS → continue automatically**

---

## Step 4: Move to testing

```bash
.mv .works/doing/{feature_name}_{timestamp} .works/testing/
```

---

## Step 5: Run tests (auto)

### 5a: Detect test command
From project config: `package.json` (npm test), `go.mod` (go test), `Cargo.toml` (cargo test), etc.

### 5b: Run unit tests
```bash
{test_command} 2>&1
```

### 5c: Run integration tests (if test plan includes them)
```bash
{integration_test_command} 2>&1
```

### 5d: Check results

Parse output. Count pass/fail.

**If any test fails:**
1. Show which tests failed and error messages
2. Write `.works/testing/{feature_name}_{timestamp}/test-results.md`
3. Stop. Ask user: "Tests failed. Options: fix / skip failed tests / abort"
4. Wait for user response

**If all pass → continue automatically**

### 5e: Write test-results.md
```markdown
# Test Results: {feature_name}
- Total: {N}
- Passed: {N}
- Failed: 0
- Status: PASS
```

---

## Step 6: Move to review

```bash
.mv .works/testing/{feature_name}_{timestamp} .works/review/
```

---

## Step 7: Review (auto)

### 7a: Load review rules

**Global rules:**
```
~/.claude/kanban-flow/review/rules/general.md
~/.claude/kanban-flow/review/rules/security.md
~/.claude/kanban-flow/review/rules/performance.md
~/.claude/kanban-flow/review/rules/{stack}.md  (if exists)
```

**Project rules (override):**
```
{project_root}/.claude/review/rules/*.md
```

Merge: project rules override global with same filename.

### 7b: Find changed files

```bash
git status --porcelain 2>/dev/null || echo "not a git repo"
```

Or read `tasks.md` to find created/modified files.

### 7c: Review each file

For each file, check:
- general.md rules (error handling, file size, no empty catch, naming)
- security.md rules (no secrets, input validation)
- performance.md rules (no N+1, pagination, timeouts)
- Project-specific rules

Record violations with severity (HIGH/MEDIUM/LOW).

### 7d: Generate review report

Write to `.works/review/{feature_name}_{timestamp}/review-report.md`

### 7e: Gate

**No HIGH violations → continue automatically**

**HIGH violations found:**
1. Show violations list
2. Stop. Ask user: "HIGH violations found. Options: fix / document as known issue / abort"
3. Wait for user response

---

## Step 8: Move to done

```bash
.mv .works/review/{feature_name}_{timestamp} .works/dones/
```

---

## Step 9: Sync docs (auto)

1. Update `docs/use-cases/{context}/{feature_name}.md` — mark as archived
2. Check if README needs update (new endpoint, new feature)
3. Check if API docs need update
4. If changes needed → make them (but don't over-modify)

---

## Step 10: Git commit (auto, no push)

```bash
git add .
git commit -m "feat({context}): {feature_name}"
```

Do NOT push unless user explicitly asked.

---

## Final report

Always show at the end:

```
## Pipeline Complete: {context}/{feature_name}

### Steps completed
1. ✓ Implement — {N} tasks done
2. ✓ Test — {N}/{N} passed
3. ✓ Review — Score: {A/B} ({N} violations)
4. ✓ Archive — synced docs

### Time
Started: {timestamp}
Finished: {timestamp}

### Artifacts
- docs/use-cases/{context}/{feature_name}.md (archived)
- .works/dones/{feature_name}_{timestamp}/

```

---

## If paused (user chose to fix)

After user fixes the issue, resume by running `/kanban-run {context} {feature_name}` again. It will detect the current state from folder location and resume from that step.

---

## Error handling

- If a step produces an error (not a test failure, but actual crash/exception) → stop immediately, show error, ask user
- If an agent spawn fails → retry once, if still fails → stop
- Never silently ignore errors

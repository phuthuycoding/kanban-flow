---
name: kanban-flow
description: One-shot feature pipeline — brainstorm → plan → implement → test → review → archive, all in one pass. User describes the idea, agent decides everything. Use when user says "kanban", "kanban-flow", "làm feature", "build feature", "chạy feature", "feature này", "làm cái {feature}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Flow — One-shot Pipeline

One command drives the entire feature lifecycle. **The user describes the idea; the agent decides the rest.**

**ARGUMENTS:** `<context> <feature_name>` — e.g. `kanban auth user-login`

---

## Interaction policy

- User gives ONE command. Agent does everything else automatically.
- Brainstorm asks user only about **material ambiguity** (scope, behavior, acceptance criteria). If details are minor, make a reasonable assumption and record it.
- Do NOT ask "continue?" between steps. Proceed automatically.
- Auto-fix benign blockers once. Stop + ask only when genuinely stuck.

---

## Feature folder

Each feature is one folder that moves through `.works/`:

```
.works/pending/  →  .works/doing/  →  .works/testing/  →  .works/review/  →  .works/dones/
```

Folder name: `{feature_name}_{timestamp}` (timestamp = `YYYYMMDD_HHmm`).

Artifacts inside (all use templates from `~/.claude/kanban-flow/templates/`):

| Artifact | Template | Created at |
|----------|----------|-----------|
| `usecase-spec.md` | usecase-spec.md | Brainstorm |
| `design.md` | design.md | Brainstorm |
| `test-plan.md` | test-plan.md | Plan |
| `tasks.md` | tasks.md | Plan |
| `testing-report.md` | testing-report.md | Test |
| `review-report.md` | review-report.md | Review |

Canonical spec: `docs/use-cases/{context}/{feature_name}.md` (created at brainstorm, marked archived at the end).

---

## Step 1: Brainstorm

Understand the feature before writing anything.

### 1a. Understand the request
- If the request is clear → proceed.
- If materially ambiguous (scope, behavior, acceptance criteria unclear) → ask up to 3 focused questions, then proceed.
- Read project first: structure, stack, and 1 similar existing feature to learn patterns.

### 1b. Write canonical spec
`docs/use-cases/{context}/{feature_name}.md` using template `usecase-spec.md`:
- user story, acceptance criteria, edge cases, constraints, dependencies

### 1c. Write design + impact
`docs/use-cases/{context}/{feature_name}.md` design section OR separate local `design.md`, using template `design.md`:
- approach, mermaid diagram, data flow, files to create/modify, API contract, breaking changes
- impact: which docs need updating later (README, API docs, CHANGELOG)

**Progress, do not block:**
```
✓ Brainstorm → docs/use-cases/{context}/{feature_name}.md
```

---

## Step 2: Plan

### 2a. Create feature folder
```
.works/pending/{feature_name}_{timestamp}/
```

### 2b. Write test-plan.md
Template `test-plan.md`. For EACH acceptance criterion + each edge case:
- a concrete scenario: Given / When / Then
- `Input`: exact input data
- `Expected Output`: exact expected result

### 2c. Write tasks.md
Template `tasks.md`. Break feature into phases (mirror project architecture — domain/infra/app/wiring/tests for DDD, else the project's real layers). Tasks are atomic, ordered by dependency. Each task references the test scenario it satisfies.

**Progress, do not block:**
```
✓ Plan → {N} scenarios, {M} tasks
```

---

## Step 3: Implement

### 3a. Move to doing
```bash
mv .works/pending/{feature_name}_{timestamp} .works/doing/
```

### 3b. Analyze parallelism
- Independent tasks → parallel (spawn `Task` agents concurrently).
- Dependent tasks → sequential after their dependencies.

### 3c. Spawn agents
Each parallel agent prompt must include:
- the use case spec / design (path or excerpt)
- the exact task(s) and the test scenario they must satisfy
- reference file paths to read for patterns
- constraints: follow existing patterns, minimal changes, no unnecessary abstraction

Implement sequential tasks directly in the main agent.

### 3d. Update tasks.md
Tick `- [ ]` → `- [x]` as each task completes.

### 3e. Build gate
```bash
{build_command} && echo PASS || echo FAIL
```
- **FAIL** → analyze, fix, re-run. If still failing → STOP, show error, ask user.
- **PASS** → continue.

```
✓ Implement → {N}/{M} tasks
```

---

## Step 4: Test

### 4a. Move to testing
```bash
mv .works/doing/{feature_name}_{timestamp} .works/testing/
```

### 4b. Run tests
Detect test framework from project config. Run unit + integration + e2e per `test-plan.md`.

### 4c. Fix and re-run once
- Any failure → analyze root cause, fix (if unambiguous), re-run.
- Still failing → STOP, show failed tests, ask user: fix / skip as known issue / abort.

### 4d. Write testing-report.md (REQUIRED)
Template `testing-report.md`. Always create it — PASS or FAIL:
- summary, environment, per-scenario results (mapped to test-plan.md), failed details, coverage vs expected, overall status, conclusion

```
✓ Test → {N}/{N} passed
📋 .works/testing/{feature_name}_{timestamp}/testing-report.md
```

---

## Step 5: Review

### 5a. Move to review
```bash
mv .works/testing/{feature_name}_{timestamp} .works/review/
```

### 5b. Load rules (two layers)
Global: `~/.claude/kanban-flow/review/rules/{general,security,performance}.md` + `{stack}.md` if it exists.
Project: `{project_root}/.claude/review/rules/*.md` — overrides the same-named global file.

### 5c. Review changed files
For each created/modified file check the loaded rules. Record violations with severity:
- HIGH — must fix (security, data loss, crash)
- MEDIUM — should fix (perf, maintainability)
- LOW — suggestion

### 5d. Write review-report.md
Template `review-report.md`: gate checklist, violations, files reviewed, score, decision.

### 5e. Gate
- No HIGH violations → continue automatically.
- HIGH violations → auto-fix once (unambiguous), re-review. Still HIGH → STOP, ask user: fix / document as known issue / abort.

```
✓ Review → score {A/B}
```

---

## Step 6: Archive

### 6a. Move to done
```bash
mv .works/review/{feature_name}_{timestamp} .works/dones/
```

### 6b. Sync docs
- Mark `docs/use-cases/{context}/{feature_name}.md` as archived.
- Update README / API docs / CHANGELOG per the impact assessment from Step 1.

### 6c. Git commit (no push unless asked)
```bash
git add .
git commit -m "feat({context}): {feature_name}"
```

---

## Step 7: Final report

```
## Pipeline Complete: {context}/{feature_name}

1. ✓ Brainstorm — spec + design + impact
2. ✓ Plan — {N} scenarios, {M} tasks
3. ✓ Implement — {M}/{M} tasks
4. ✓ Test — {N}/{N} passed
5. ✓ Review — {A/B}
6. ✓ Archive — docs synced, commit {sha}

Artifacts: .works/dones/{feature_name}_{timestamp}/
Docs: docs/use-cases/{context}/{feature_name}.md
```

---

## Resume behavior

If interrupted (user stopped it, or it stopped at a blocker), re-invoking the skill resumes from the current state — detected solely from which `.works/` folder the feature is in.

---

## Hard rules

- Do NOT ask "continue to next step?" — everything is automatic.
- Do NOT ask which command to run — just run it.
- Brainstorm asks only material questions; never belabor minor details.
- Always write `testing-report.md` and `review-report.md` — never skip reports.
- Never silently swallow errors. If a step can't complete and can't be auto-fixed, STOP and report.
- The user's single command IS authorization for the full pipeline.
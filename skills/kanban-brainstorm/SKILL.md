---
name: kanban-brainstorm
description: Brainstorm a new feature — create use case spec, technical design, and impact assessment. Use when user says "brainstorm", "brainstorm feature", "brainstorm {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Brainstorm

Guide user through brainstorming a feature. Output: use case spec + design + impact assessment.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`, `payment checkout`.

## Read project first

Before brainstorming:
1. Read project structure (ls root, package.json, README)
2. Read existing docs in `docs/` if any
3. Read similar existing features to understand project patterns

---

## Workflow

### Step 1: Understand the request

If no clear input provided, ask user:
> "Feature này giải quyết vấn đề gì? Ai là user?"

If name provided but unclear, ask one clarifying question max. Don't over-clarify.

### Step 2: Create use case spec

Use template: `~/.claude/kanban-flow/templates/usecase-spec.md`

Output to: `docs/use-cases/{context}/{feature_name}.md`

Include:
- **User story**: As a {user}, I want {goal}, so that {benefit}
- **Acceptance criteria**: Concrete, testable conditions
- **Edge cases**: What happens at boundaries
- **Constraints**: Technical or business limits
- **Dependencies**: What this feature depends on

### Step 3: Technical design

Use template: `~/.claude/kanban-flow/templates/design.md`

Include:
- Architecture approach (mirror existing project patterns)
- Mermaid diagram (flow or sequence as appropriate)
- Data flow if data moves between services/layers
- Files to create/modify (list every file)
- API contract if applicable
- Breaking changes

### Step 4: Impact assessment

Answer these questions:
1. Which existing files/modules are affected?
2. Which docs need updating?
3. Are there breaking changes?
4. What test scenarios does this create?
5. Any security or performance implications?

### Step 5: Show output and save

Present all three sections to user. Ask:
> "Output đã lưu vào docs/use-cases/{context}/{feature_name}.md. Anh muốn tiếp tục Plan không?"

**Save file**, then stop. Do NOT proceed to plan step.

---

## Gate

- [ ] Use case spec complete
- [ ] Design complete (with mermaid diagram)
- [ ] Impact assessment done
- [ ] File saved to `docs/use-cases/{context}/{feature_name}.md`
- [ ] **User CONFIRMED before proceeding**

## Output format

After completing, show:

```
## Brainstorm Complete: {context}/{feature_name}

### Files
- docs/use-cases/{context}/{feature_name}.md

### What's in it
- Use case spec (user story + acceptance criteria + edge cases)
- Technical design (approach + diagram + files)
- Impact assessment (affected modules + docs to update)

Ready to plan? Use /kanban-plan {feature_name}
```

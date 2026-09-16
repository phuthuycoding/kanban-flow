# Kanban Flow

A skill-based kanban workflow for feature development with gates at each step.

## Quick Start

```
1. /kanban-brainstorm {context} {feature}   → create spec + design
2. /kanban-plan {context} {feature}          → test plan + task breakdown
3. /kanban-implement {context} {feature}     → execute tasks (parallel agents)
4. /kanban-test {context} {feature}          → run automated tests
5. /kanban-review {context} {feature}        → code review with rules
6. /kanban-archive {context} {feature}       → archive + sync docs
```

## Architecture

```
~/.claude/
├── skills/
│   ├── kanban-brainstorm/SKILL.md
│   ├── kanban-plan/SKILL.md
│   ├── kanban-implement/SKILL.md
│   ├── kanban-test/SKILL.md
│   ├── kanban-review/SKILL.md
│   └── kanban-archive/SKILL.md
└── kanban-flow/
    ├── templates/         ← artifact templates
    │   ├── usecase-spec.md
    │   ├── design.md
    │   ├── test-plan.md
    │   ├── tasks.md
    │   └── review-report.md
    └── review/rules/      ← global review rules
        ├── general.md
        ├── security.md
        ├── performance.md
        └── README.md

{project}/
├── .works/
│   ├── backlog/     ← ideas
│   ├── pending/     ← planned, awaiting approval
│   ├── doing/       ← implementing
│   ├── testing/     ← running tests
│   ├── review/      ← reviewing
│   └── dones/       ← archived
└── docs/
    └── use-cases/{context}/{feature}.md
```

## How it works

Each feature is a **folder** that moves through `.works/` columns:

```
backlog/ → pending/ → doing/ → testing/ → review/ → dones/
```

Each step has a **gate** requiring user approval before proceeding.

## State tracking

State is tracked by **filesystem location**:
- Feature in `.works/pending/` → planned, waiting for approval
- Feature in `.works/doing/` → implementing
- Feature in `.works/testing/` → running tests

No database, no config file — just folders.

## Review rules

Global rules: `~/.claude/kanban-flow/review/rules/`
Project rules: `{project}/.claude/review/rules/`

Project rules override global rules with same filename.

## Templates

All templates in `~/.claude/kanban-flow/templates/`
Each skill loads the appropriate template for its output.

## Design principles

- **Skills-only** (no CLI needed)
- **File-based state** (works across all tools)
- **Consistent output** (templates ensure same format)
- **Gate-based flow** (user approves each step)
- **Parallel agents** (implement step spawns multiple agents)

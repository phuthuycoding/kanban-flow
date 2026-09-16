# Kanban Flow Review Rules

## Structure
- `general.md` — Rules applied to every review
- `security.md` — Security-specific checks
- `performance.md` — Performance-specific checks
- `{stack}.md` — Stack-specific rules (create as needed, e.g. `react.md`, `node.md`, `go.md`)

## How to Use
Skill `kanban-review` loads all rules in this directory at review time.
Project-specific rules override global rules when same filename exists.

## Adding Rules
Create a new `.md` file in this directory. Each rule should be:
- A short imperative sentence
- Specific enough to verify (not "write good code")

## Severity Levels
- **HIGH** — Must fix before merge (security risk, data loss, crash)
- **MEDIUM** — Should fix before merge (performance, maintainability)
- **LOW** — Suggestion, can defer

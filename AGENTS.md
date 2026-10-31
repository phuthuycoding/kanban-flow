# AGENTS.md

Conventions for AI coding agents working in this repository. Seeded by `kf init`; edit freely.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Test | `npm test` |

Detect anything else by reading the repository, never by guessing.

## Workflow (kanban-flow)

- Start a feature with one command: `kanban <context> <feature>` (bug: `kanban <context> <name> --type bug`).
- Human gates: confirm the requirement (Phase 1), approve the plan (Phase 2; approve starts the item, `--backlog` defers it), and merge the PR after a review PASS. Do not ask "continue?" between other phases.
- Work item state lives in `.works/`; move items only with `kf stage` / `kf approve` / `kf archive`; `kf status` closes an item whose PR merged. Never move folders by hand.
- Never use `--force` or `--skip-hooks` without explicit user approval; every bypass is recorded in the work item's metadata.
- Run `kf autoconfig` for the setup checklist and the review rules to apply as coding conventions.

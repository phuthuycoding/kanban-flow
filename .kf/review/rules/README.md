# Kanban Flow Review Rules

## Structure
- `general.md` — Rules applied to every review
- `security.md` — Security-specific checks
- `performance.md` — Performance-specific checks
- `{stack}.md` — Stack-specific rules. Packs ship in the package at `assets/review/stacks/{stack}.md` (10 packs: the languages `node`, `go`, `rust`, `python`, `php`, `ruby`, `java`, plus `frontend`, `monorepo` and `mvvm`) and are installed into this directory via `kf rules`. `frontend` and `monorepo` are detected from build and workspace config files; `mvvm` is an architecture, so install it by name (`kf rules --stack mvvm`).

## How to Use
`/kf:review` passes every rule file in this directory to its reviewers, and `/kf:implement` passes them to each per-task reviewer. This `README.md` is not a rule file.
Three layers, resolved per filename: this project (`.kf/review/rules/`), then the user (`~/.kf/review/rules/`), then the package. A project file replaces the user's and the package's file of the same name.

A rule the reviewer cannot check by reading the diff — "the linter is clean", "the race detector passes" — is not a rule: put the command in `harness.verify` in `.kf/config.json`, where `kf verify` runs it.

## Installing Stack Rules
```bash
kf rules                                  # auto-detect stacks from manifests (monorepo: installs every detected pack)
kf rules --stack go --stack python        # install specific packs
kf rules --stack mvvm                     # an architecture pack: never auto-detected
kf rules --list                           # list available packs and detected stacks
kf rules --force                          # overwrite a project rule file that differs from the pack
```
Without `--force`, an existing `.kf/review/rules/{stack}.md` that differs from the pack is skipped with a warning — project rules are user-owned. Re-running on an identical file reports "already installed". Works before `kf init`.

## Adding Rules
Create a new `.md` file in this directory. Each rule should be:
- A short imperative sentence
- Specific enough to verify (not "write good code")

## Shared surfaces
The whole-branch review picks its reviewer set from the diff, and a change to a shared surface (a route, an event, a schema, a migration) adds a contracts reviewer. A project adds its own signals — a CLI help table, a public SDK entry file — as regular expressions, one per line, under a `## Shared surfaces` heading in any rule file here.

## Severity Levels
- **HIGH** — Must fix before merge (security risk, data loss, crash, a requirement not met, a test that asserts nothing where the requirement needs one)
- **MEDIUM** — Should fix before merge (performance, maintainability, a weak test)
- **LOW** — Suggestion, can defer

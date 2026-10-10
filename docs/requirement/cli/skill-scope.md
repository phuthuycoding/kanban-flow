---
feature: skill-scope
context: cli
created: 20261010_1747
kind: feature
status: archived
---
# Spec Requirement

## Feature
skill-scope

## Objective
Make kanban skills install to the agent's user-level (global) skills dir by default — one copy serving every project — with project scope as an explicit per-project opt-in that `kf init`, `kf install`, `kf autoconfig` and onboarding all understand.

## Problem Statement
Today every skills path (`installProjectSkills`, `cmdInstall`, `cmdUninstall`) writes the eight managed `kanban-*` skills into the project's per-agent dir (`{root}/.claude/skills`, `.agents/skills`, …). That copies the same skills into every project, duplicates drift apart as the package evolves, and users who want project-local skills get them whether they asked or not. The maintainer wants the reverse default: global (user home) first, project only when the user configures it — and the choice must be asked at onboarding and surfaced by `kf autoconfig`, not buried in a flag.

## Scope
### In Scope
- A per-agent user-level skills dir (`userRel`, e.g. `~/.claude/skills`, `~/.agents/skills`) alongside the existing `projectRel`, so every adapter can target both scopes.
- Global installs are **symlinks to the packaged `skills/` dirs** by default (one `~`-level link per managed skill, `~/.claude/skills/kanban-foo` → `<pkg>/skills/kanban-foo`), falling back to a plain copy when linking is not possible or the package location is ephemeral. Project installs always copy.
- `skills.scope` in `.kf/config.json` (`"global" | "project"`); absent means `"global"`.
- `kf install` / `kf uninstall` accept `--scope global|project` (default: the project's effective scope) and act on that scope only.
- Installing at global scope removes the managed skills from the project's agent dirs, so a stale project copy can never shadow the fresh global one. Installing at project scope never removes global copies — they may serve other projects.
- `kf init` (bootstrap, `--defaults`, and `--minimal`) installs at the effective scope; interactive onboarding asks the scope question and persists the answer.
- `kf autoconfig` reports the effective scope, checks install status per agent at that scope, detects stale copies by comparing installed content against the package, and names the fix (`kf install`).
- `kf doctor` reports missing/stale skills at the effective scope and `--fix` repairs them (reinstall +, when the configured scope is global, the project-copy cleanup).

### Out of Scope
- Changing the review-rules / templates precedence (already project → user → package).
- A user-level default config (`~/.kf/config.json`) — scope is a per-project decision; the global *behavior* is the built-in default. (Considered and declined in Q&A.)
- Version pinning or selective per-skill installs — drift is reported, not auto-healed at install time.
- Per-agent scope overrides (one agent global, another project).
- Moving or renaming the packaged `skills/` source dirs.
- `kf uninstall --scope all` (remove both scopes at once) — nice-to-have, not committed.

## Actors
- Project maintainer / developer — runs `kf init`, `kf install`, `kf uninstall`, `kf autoconfig`.
- AI coding agents (claude, codex, gemini, kiro, cursor, opencode, devin) — discover skills from their user- or project-level dirs.

## Functional Requirements
### FR-001
- Requirement: Each agent adapter declares a user-level skills dir (`userRel`, resolved against the user's home dir) in addition to `projectRel`. The install helper gains a link-or-copy step: global scope links each managed skill to `PKG_SKILLS_DIR`, copying instead when `symlink()` fails or the package root is ephemeral (e.g. an npx cache path); project scope always copies. `removeSkillsFrom` keeps working on any absolute target dir and must remove a symlink without touching its target.
- Priority: must
- Notes: Link-first is the user decision — a symlink tracks package upgrades with zero reinstalls. `rm -rf`/`fs.rm` on a symlink removes the link itself, so cleanup is already safe; the unsupported-agent and write-failure reporting from copy mode applies to link mode too.

### FR-002
- Requirement: `.kf/config.json` accepts `skills.scope` (`"global" | "project"`); when absent the effective scope is `"global"`. An invalid value is a config error surfaced with a clear message.
- Priority: must
- Notes: Effective-scope resolution lives in one place (`effectiveSkillsScope`) so init/install/uninstall/autoconfig never disagree.

### FR-003
- Requirement: `kf install [--agent <id>...] [--scope global|project]` installs the managed skills into the target scope's dirs (default scope: effective). Global installs link each managed skill to the package (copy fallback per FR-001) and report which mode landed. A global install also removes the managed skills from the project's agent dirs — but only when the *configured* scope is not `"project"`; a one-off `--scope global` on a project-scoped project adds the global copy without destroying the setup the config declared. A project install leaves global copies untouched. Global install/uninstall do not require `.works/` — outside a project the cleanup step is simply skipped.
- Priority: must
- Notes: Migration behavior chosen by the user — project copies are cleaned on global install to prevent a stale copy shadowing the fresh global one. Cleanup is tied to the configured scope, not the one-off flag, so an explicit `--scope global` cannot silently dismantle a `skills.scope: "project"` choice.

### FR-004
- Requirement: `kf uninstall [--agent <id>...] [--scope global|project]` removes the managed skills at the given scope (default: effective scope) and reports where nothing was found. `--purge` behavior is unchanged (project data only).
- Priority: must
- Notes: Global uninstall warns once that global skills serve every project. `--scope all` is explicitly out of scope.

### FR-005
- Requirement: `kf init` installs skills at the effective scope in all three paths — interactive bootstrap, `--defaults`, and `--minimal`. Interactive onboarding (`onboardAnswers`/`askAll`) asks "Install skills globally for all projects, or into this project only?" (default: global) and `saveConfig` persists the answer as `skills.scope`.
- Priority: must
- Notes: The quick-setup summary line in `onboardAnswers` shows the scope alongside the other defaults so the user sees what "Quick setup" implies.

### FR-006
- Requirement: `kf autoconfig` reports the effective scope, each configured agent's install status at that scope — and *how* it is installed (linked vs copied) — flagging an agent as stale when a link is broken or a copy's content differs from the packaged copy, with `kf install` as the suggested action. When scope is global but managed skills still exist in a project dir, it reports the leftover as a duplicate to clean (`kf uninstall --scope project`).
- Priority: must
- Notes: Status semantics per scope: global → valid link | broken link | stale copy | missing; project → installed | stale copy | missing. A live link is never "stale" — it tracks the package.

### FR-007
- Requirement: `kf doctor` reports missing, broken-link or stale skills at the effective scope using the same status logic as autoconfig, and `kf doctor --fix` repairs them by reinstalling at that scope (recreating links or falling back to copy) — including the project-copy cleanup under the same rule as FR-003 (only when the configured scope is not `"project"`).
- Priority: must
- Notes: User decision: doctor owns both the check and the fix. Reinstall is a managed-skills-only operation, so auto-repair is safe to apply without a human decision — same class as the other `--fix` repairs. Reinstall after a package move self-heals: the link is recreated against the current `PKG_SKILLS_DIR`.

### FR-008
- Requirement: `--global` / `--project` shorthand flags equivalent to `--scope global` / `--scope project` on `install`/`uninstall`.
- Priority: could
- Notes: Cheap sugar over `--scope`; only if args parsing supports both cleanly without ambiguity when combined.

## Non-Functional Requirements
- Idempotent: re-running install at either scope leaves exactly the packaged skills at that scope — no duplicates, no partial sets.
- Destruction is limited to the eight managed skill names; other skills in the same dir are never touched (existing `removeSkillsFrom` contract).
- Non-interactive paths (`--defaults`, `--minimal`, CI) never prompt; they use the configured or global default scope.
- Path handling via `node:os` `homedir()` + `join` — works on macOS/Linux/Windows.

## Main Use Cases
- UC-001 Fresh init defaults to global skills
- UC-002 Onboarding asks scope and persists the answer
- UC-003 Install global cleans the project copies
- UC-004 Install project leaves global copies untouched
- UC-005 Uninstall at a chosen scope
- UC-006 Autoconfig reports scope, status and stale skills

## Constraints
- Existing config files without `skills` must keep working unchanged (absent = global).
- `installedAgents` / checklist logic currently keys off project dirs only — both scopes must be queryable without breaking that call shape.
- Global skills are shared across every project. With links they track the package location they were created against, so a project pinned to a different kf version can still see newer skills than its CLI — broken/dangling links are caught by the stale check and re-pointed by `kf install` / `doctor --fix`. Accepted trade-off of the global default.
- This repository itself carries project-scope skills in `.claude/skills` and `.devin/skills` — the implementation must treat them as data under test, and a global install here will (correctly) remove them once the feature lands.

## Assumptions
- Every listed agent has (or is documented to read) a user-level skills dir; the open standard `~/.agents/skills` is the fallback where an agent reads the shared dir (devin already `alsoReads` codex/opencode dirs).
- Agents' skill discovery follows directory symlinks inside the skills dir — true for the filesystem-level scanners these agents use; verified per agent where docs allow, and copy fallback covers any agent that cannot.
- The "ephemeral package root" heuristic (e.g. path contains an npx cache segment) is decided in planning; linking is skipped there because the target would dangle when the cache is purged.
- Scope is stored per project only — no `~/.kf/config.json` user default (declined option).
- Content comparison for staleness compares managed skill files byte-for-byte against the package copy; the comparison helper is shared between autoconfig and doctor.
- The config field is a `skills` object (`{ "scope": "..." }`) so later skill-related options have a home; naming finalized in planning.

## Acceptance Criteria
- [ ] `kf init --defaults` (or `-i` choosing Quick setup) on a fresh project links (or copies, when linking is unavailable) the eight managed skills into the agent's `~`-level dir and creates no skills under the project's agent dirs; output states which mode landed.
- [ ] After `kf install --scope global`, `~/.<agent>/skills/kanban-*` entries are symlinks resolving into the packaged `skills/` dirs — confirmed via `fs.lstat`/`readlink` in tests.
- [ ] Interactive `kf init` asks the scope question; answering "project" installs into `{root}/.<agent>/skills` and writes `skills.scope: "project"` to `.kf/config.json`.
- [ ] On a project with project-scoped skills, `kf install --scope global` (or effective global) installs globally and removes all eight managed skills from the project's agent dirs; unrelated skills there survive.
- [ ] `kf install --scope project` while global copies exist installs the project copy and leaves `~`-level copies untouched.
- [ ] `kf uninstall --scope global` removes the eight managed skills from `~` dirs only; `--scope project` removes project copies only; output reports the scope and dirs affected.
- [ ] `kf autoconfig` prints the effective scope, per-agent installed/missing/stale status at that scope, and names `kf install` as the fix for missing or stale agents.
- [ ] With `skills.scope: "global"` and managed skills still in a project dir, autoconfig flags the project copies as duplicates to remove.
- [ ] After hand-editing one installed SKILL.md in a copy-mode dir, `kf autoconfig` reports that agent stale; after deleting a link's packaged target (simulated), it reports the link broken.
- [ ] `kf doctor` reports a stale/broken/missing agent at the effective scope; `kf doctor --fix` reinstalls it (link or copy fallback) and, with scope=global, removes leftover project copies — verified by re-running doctor clean.
- [ ] `kf status`/`kf doctor` behavior for existing projects with no `skills` field is unchanged apart from the global default (no crash, no forced migration).

## Edge Cases
- Agent with no documented user-level skills dir: the adapter's `userRel` must still resolve somewhere sensible; if an agent truly cannot load user-level skills, global install reports that agent as unsupported rather than writing a dir nothing reads — verified per agent in implementation.
- `HOME` unset or home dir unwritable → homedir() result used; write failures surface as install errors, not silent skips.
- Global skills in use by several projects; uninstalling globally degrades all of them → the command prints a one-line warning.
- `skills.scope` set to a garbage string in config → error naming the field and the allowed values.
- Project copy and global copy both present (scope=project): agent resolves project copy per its own precedence — expected, no warning needed.
- Re-running `kf init` on a project that already has project copies with no `skills` field: default global applies → global install + project cleanup on next install, matching the migration rule.
- `kf install --scope global` on a project whose config says `skills.scope: "project"` → global copy installed, project copies preserved; output should note the mismatch so the user knows both now exist.
- `kf install`/`uninstall --scope global` run outside any `.works/` project → act on `~` dirs only; no config to read, nothing to clean.
- An agent mid-session holding skills from a project dir that a global install then cleans: skills are already loaded; removal affects only future sessions — cleanup is a deliberate kf command, never a silent side effect.
- Package uninstalled or moved after a global link install → `~`-level links dangle; autoconfig/doctor report them broken and `kf install`/`doctor --fix` re-create them against the current package root.
- `symlink()` denied (Windows without Developer Mode, EPERM) or package root ephemeral (npx cache) → global install falls back to copy and says so; the stale check then applies the copy semantics (content compare).
- `removeSkillsFrom` on a symlinked managed skill must delete the link, never the packaged target — verified in tests.

## Open Questions
- Exact `userRel` per agent (kiro, opencode, devin least certain) — resolved from each agent's docs during implementation; wrong guesses are caught by the unsupported-agent check.

## Test Strategy
- Level: unit
- UI Tests: none — CLI surface only
- Tools: vitest (`src/tests/`), existing `install.test.ts`/`autoconfig.test.ts`/`doctor.test.ts` patterns
- Coverage Target: 80%

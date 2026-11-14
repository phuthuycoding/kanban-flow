# runtime-agents

## Purpose
Each AI runtime that kanban-flow installs into may carry its own directory of agent profiles. The registry in `src/integrations/agents.ts` declares, per runtime, where those files land and — through the `agentTarget` descriptor — how the managed file names and their expected on-disk bytes are derived, so install, state checks, doctor and uninstall all agree on what "owned", "stale" and "foreign" mean for that runtime.

## Current behaviour
- **Agent directories.** A runtime entry may declare `agentsRel` (project-scope dir under the project root) and `userAgentsRel` (global dir under the POSIX home); `userAgentsAppDataRel` names the global dir under `%APPDATA%` on win32. `projectAgentsDir(agent, root)` and `userAgentsDir(agent, home, platform?)` resolve them; a runtime with neither has no agent registry and gets no agent files. `claude` resolves `.claude/agents`; `devin` resolves `.devin/agents` (project), `~/.config/devin/agents` (POSIX) and `%APPDATA%\devin\agents` (win32).
- **Managed names and content.** The default target writes the seven packaged `assets/agents/<seat>.md` files under their own names and compares state byte-for-byte against the packaged files. An `agentTarget` descriptor can change all three: `managedName(seat)` maps the seat to a different file name (`devin` → `kf-<seat>.md`), `expectedBytes(seat)` returns the rendered bytes to compare against instead of the packaged file, and `linkAllowed` forbids symlinks so rendered targets are always copies. The transform applies uniformly across `installAgentsTo`, `agentEntryState`, `agentsState`, `removeAgentsFrom` and the `.kanban-flow-agents.json` manifest, which is keyed by managed name.
- **The devin render.** `renderAgentProfile(text, seat)` in `src/integrations/skill-render.ts` rewrites the packaged Claude frontmatter into a Devin profile: `name:` becomes `kf-<seat>`, `model:` carries through unchanged, `tools:` becomes `allowed-tools` with the name mapping `Read→read`, `Edit`/`Write→edit` (deduped), `Grep→grep`, `Glob→glob`, `Bash→exec` and `mcp__<server>__<tool>` verbatim; a seat carrying a tool with no Devin name (the researcher's WebSearch/WebFetch) drops the whole `allowed-tools` key rather than emit a partial list. The body text is untouched.
- **Ownership.** Owned, copied, stale and foreign are decided against the target's expected bytes: the packaged file at a devin managed name is foreign, never owned. A file of yours at a managed name is kept and named by every lifecycle operation.
- **Non-rendered runtimes are untouched.** With no `agentTarget`, every path reproduces the pre-descriptor behaviour — claude installs byte-identical packaged files under their own names, linked at global scope.

## Use cases
- `kf install --agent devin` writes seven rendered `kf-*.md` profiles into the devin agents dir at the chosen scope.
- `kf doctor` reports missing, partial, stale or foreign devin profiles and `--fix` repairs them to the current render.
- `kf uninstall --agent devin` removes the owned `kf-*.md` at that scope, keeps and names foreign files, and reports `already clean` when nothing is installed.

## Surfaces
- `src/integrations/agents.ts` (`agentsRel`, `userAgentsRel`, `userAgentsAppDataRel`, `agentTarget`, `projectAgentsDir`, `userAgentsDir`), `src/integrations/skill-render.ts` (`renderAgentProfile`)
- `src/integrations/install.ts` (`AgentTarget`, `installAgentsTo`, `agentEntryState`, `agentsState`, `removeAgentsFrom`, manifest), `src/project/doctor-install.ts`, `src/cli/commands/autoconfig.ts`
- `assets/agents/*.md` (the packaged seat files the render reads)
- `docs/specs/cli/install.md`, `docs/workflow/harness.md`

## History
- 2026-11-14 — devin-adapter: devin agents registry dirs (`.devin/agents`, `~/.config/devin/agents`, `%APPDATA%\devin\agents`), the `agentTarget` descriptor (managed name, expected bytes, link allowed) and `renderAgentProfile` (Claude→Devin frontmatter); lifecycle, doctor, autoconfig and init target-aware; dedupe fixes so devin's agents dir is never skipped by the shared-skills-dir continues

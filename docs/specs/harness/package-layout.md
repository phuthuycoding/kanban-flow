# package-layout

## Purpose
Where the kanban-flow package keeps the harness assets it ships, and how the Claude Code plugin, the `kf` CLI and runtime copies find them. Every markdown, template, rule and hook file the harness ships lives in one `assets/` tree, so maintainers edit it in one place.

## Current behaviour
- **Layout.** The package root holds `dist/` (the CLI), `.claude-plugin/` (manifest and marketplace) and `assets/`:
  - `assets/skills/<name>/SKILL.md` holds the 11 skills, each with its own `references/` and `scripts/`.
  - `assets/agents/<name>.md` holds the 7 agent bodies.
  - `assets/shared/` holds the references several skills cite: `researcher-brief.md` and `harness-tools.md`.
  - `assets/templates/` holds the artifact and living-doc templates.
  - `assets/review/rules/` and `assets/review/stacks/` hold the review rule packs.
  - `assets/github-hooks/` holds the opt-in GitHub sync hook pack.
  - `assets/README.md`.
  - `assets/hooks/` does not ship, so the package hook tier is empty.
- **Plugin manifest.** `.claude-plugin/plugin.json` declares `"skills": "./assets/skills/"` and an `agents` array with one `./assets/agents/<name>.md` entry per agent.
  - Claude Code accepts only files in `agents`, and that field replaces the default scan, so a new agent needs a manifest entry.
  - A test fails when the array and the files in `assets/agents/` differ.
  - `claude plugin details` reports `Agents (0)` for this manifest. A session still loads all 7 `kf:` agents.
- **npm package.** `package.json` `files` ships `dist`, `assets`, `.claude-plugin` and `docs/workflow`. A test checks the `npm pack` list.
- **CLI reads.** The CLI reads packaged assets only through its package-path constants, which all resolve under `<package>/assets/`. The readers are `kf instruct`, `kf rules`, `kf init` seeding, `kf autoconfig`, the `kf doctor --fix` hook-pack repair and `kf install`. Project overrides (`.kf/templates`, `.kf/review/rules`, `.kf/hooks`) and user overrides (`~/.kf/...`) take precedence as before.
- **Skill citations.** Skills and agents cite packaged files as `${CLAUDE_PLUGIN_ROOT}/assets/...`. For a copy runtime (codex, gemini and others), `kf install` writes `kf-<name>` copies whose citations are rewritten to the copy root:
  - `assets/skills/<name>` becomes `kf-<name>`.
  - `assets/agents` becomes `kf-flow/agents`.
  - `assets/shared` becomes `kf-flow/shared`.
  - Any other package path becomes the package root.
  - The flow copy carries the agent bodies and the shared files, recorded in the sidecar digest like the rest of the copy.
- **Upgrades.** `kf install` and `kf doctor --fix` recognise a link or copy left by an earlier install as kf's in either the pre-`assets/` layout or the current one.
  - This covers managed skills, agents, legacy `kanban-*` links, the bare `travel` entry and retired skills.
  - The package root is checked by its plugin manifest. A link whose package dir is gone is recognised by its `kanban-flow` product-dir suffix.
  - Such entries are replaced, and a user's own file stays untouched.

## Use cases
- A maintainer edits harness assets in the single `assets/` tree.
- Claude Code loads the kf plugin's 11 skills and 7 agents from the manifest paths.
- A non-plugin runtime receives rendered skill copies whose every cited path exists.
- An install made from the earlier layout upgrades without manual cleanup.
- Skills cite one shared reference set under `assets/shared/`.

## Surfaces
- `.claude-plugin/plugin.json` (`skills`, `agents`)
- `package.json` `files`
- `src/shared/paths.ts` and `src/integrations/install.ts` (package-path constants, ownership checks)
- `src/integrations/skill-render.ts` (copy rewrites)
- `docs/workflow/harness.md`, `docs/workflow/artifacts.md`, `CHANGELOG.md`

## History
- 2026-11-12 — assets-layout: created. Harness assets moved under `assets/`, the plugin manifest declares the skills and agents paths, shared references live in `assets/shared/`, and upgrades recognise both layouts.

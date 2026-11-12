# Documentation

The `kanban-flow` documentation is split by purpose:

- [Workflow guide](workflow/README.md) — how the pipeline runs: state machine, gates, CLI and skill routing.
- [Workflow lifecycle](workflow/lifecycle.md) — a feature or bug from requirement or triage through to archive.
- [State diagram](workflow/state-machine.md) — the states, the legal transitions and what each one requires.
- [Gates and the artifact contract](workflow/gates.md) — what every phase demands before it lets go.
- [Artifacts and how to read them](workflow/artifacts.md) — artifact structure, traceability and the living docs under `docs/specs/`.
- [CLI reference](workflow/cli-reference.md) — commands, inputs, outputs and exit codes.
- [Agent onboarding](workflow/autoconfig.md) — how the agent learns the project: `kf init`, the `kf` plugin install, `AGENTS.md`, the `kf autoconfig` briefing and phase hooks.
- [Dashboard analytics](workflow/dashboard.md) — the KPIs, the charts and how each number is computed.
- [Skill routing](workflow/skills.md) — the `kf` plugin's 11 skills (`/kf:flow` and the rest, `kf-<name>` copies for other runtimes) and what each owns.
- [Agent harness](workflow/harness.md) — the stage → role → runner mapping behind `kf run`, `kf runs` and `kf harness`, and the task harness: `kf tasks`, `kf run --task` and `kf drive`, which runs an approved item from implementation to a review PASS.
- [Source layout](workflow/source-layout.md) — the shape of the source tree and where a new file belongs.
- `docs/specs/` — the living docs, the current description of the system: one `<context>/<capability>.md` per capability (`## Purpose`, `## Current behaviour`, `## Use cases`, `## Surfaces`, `## History`) and a `<context>/README.md` index. A feature edits them at review, in one commit before the reviewers; a bug updates an existing one when it needs to. Closing an item copies nothing under `docs/`.
- `requirement/`, `use-cases/`, `testplan/` — legacy per-feature snapshots that earlier releases copied out at the close. They are history, not current behaviour, and wait for `/kf:docs` to consolidate them into `docs/specs/` (`kf doctor` lists them as `Legacy docs not consolidated`).

The source of truth for state is the `.works/` filesystem, the `.kfw.json` metadata, the `.kf/config.json` config and the artifacts inside each work item folder. Personal defaults for `reviewer`, `agents` and `skills` can also come from `~/.kf/config.json` and the nearest `.kf/workspace.json`; `kf config show` prints where each value came from ([config layers](workflow/cli-reference.md#config-layers)). These documents describe what the CLI in `src/` does today.

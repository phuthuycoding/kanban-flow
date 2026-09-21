# Documentation

The `kanban-flow` documentation is split by purpose:

- [Workflow guide](workflow/README.md) — how the pipeline runs: state machine, gates, CLI and skill routing.
- [Workflow lifecycle](workflow/lifecycle.md) — a feature or bug from requirement or triage through to archive.
- [State diagram](workflow/state-machine.md) — the states, the legal transitions and what each one requires.
- [Gates and the artifact contract](workflow/gates.md) — what every phase demands before it lets go.
- [Artifacts and how to read them](workflow/artifacts.md) — artifact structure, traceability and the docs left behind after archive.
- [CLI reference](workflow/cli-reference.md) — commands, inputs, outputs and exit codes.
- [Dashboard analytics](workflow/dashboard.md) — the KPIs, the charts and how each number is computed.
- [Skill routing](workflow/skills.md) — what the orchestrator owns and what each phase skill owns.
- [Agent harness](workflow/harness.md) — the stage → role → runner mapping behind `kf run`, `kf runs` and `kf harness`.
- [Source layout](workflow/source-layout.md) — the shape of the source tree and where a new file belongs.
- `requirement/`, `use-cases/`, `testplan/` — canonical docs. `use-cases/` and `testplan/` are copied out when a feature reaches `dones`; `requirement/` is written by the brainstorm skill back in Phase 1 and archive only refreshes it and stamps `status: archived`. A bug only updates the related docs when it needs to.

The source of truth for state is the `.works/` filesystem, the `.kfw.json` metadata, the `.kf/config.json` config and the artifacts inside each work item folder. These documents describe what the CLI in `src/` does today.

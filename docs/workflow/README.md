# Kanban Flow Workflow

`kanban-flow` drives a feature's life cycle through the `kf` CLI and the phase skills:

```text
brainstorm → planning → implementation → testing → review → dones
                 ↘ backlog ↗
```

The pipeline exists to turn an idea into an approved execution contract, then execute it with traceability, and test and review the right version of it before archiving.

Features and bugs share one state machine. Create a bug with `kf new <name> --type bug`; it goes through `kanban-bug` for triage and reproduction before it reaches planning.

## Where to start

1. [Lifecycle](lifecycle.md) — who does what, and in what order.
2. [State machine](state-machine.md) — the states and the transitions each one allows.
3. [Gates](gates.md) — artifacts, approval, execution ids and report status.
4. [Artifact contract](artifacts.md) — file structure, traceability and the canonical output.
5. [CLI reference](cli-reference.md) — the command syntax an agent uses to move state.
6. [Skill routing](skills.md) — which skill loads in which state.
7. [Dashboard](dashboard.md) — the KPIs, the charts, the filters and what each number means.
8. [Source layout](source-layout.md) — the shape of `src/` and how to extend it.

## The rules that never bend

- Never move a folder by hand; use `kf stage` or `kf archive`.
- The requirement or bug report must be `status: confirmed` before it leaves brainstorm.
- Once planning is approved, the user chooses to start now or to send the item to `backlog`.
- Planning needs human approval. A feature's fingerprint covers the requirement, the four planning artifacts and every UC file; a bug's fingerprint covers only the bug report.
- Editing the execution contract after approval forces a return to planning and a fresh approval.
- Every entry into testing mints a new execution id. The testing and review reports must reference that exact id.
- A FAIL or a REJECT returns to implementation and must be tested again. BLOCKED stops the pipeline.
- REQUIREMENT_BUG stops every ordinary transition so the user can decide.
- The feature report must be written before archive; the CLI syncs the canonical docs when a feature is archived. A bug only updates the related docs when there is a docs impact.
- The pipeline grants itself no access to a database, a deployment, a publish, a message or any change outside the approved scope.

## Filesystem model

```text
project/
├── .kf/
│   ├── config.json
│   ├── templates/
│   ├── hooks/
│   └── review/rules/
├── .works/
│   ├── brainstorm/
│   ├── planning/
│   ├── backlog/
│   ├── implementation/
│   ├── testing/
│   ├── review/
│   └── dones/
└── docs/
    ├── requirement/{context}/{feature}.md
    ├── use-cases/{context}/{feature}/README.md + UC-###.md + diagram.md
    └── testplan/{context}/{feature}{,-result}.md
```

Each work item folder is named `{feature}_{YYYYMMDD_HHmm}` and carries a `.kfw.json`. The standard artifacts all use the `phase-{number}-` prefix.

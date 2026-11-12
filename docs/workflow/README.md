# Kanban Flow Workflow

`kanban-flow` drives a feature's life cycle through the `kf` CLI and the phase skills (the `kf` plugin: `/kf:flow`, `/kf:plan`, ...):

```text
brainstorm → planning ─ kf approve ─→ implementation → testing → review ─ PR merged ─→ done
                 ↘ kf approve --backlog ─→ backlog ↗      ↺ FAIL / red CI loop back

any stage ──kf cancel──→ cancelled ──back to the stage it stopped in──→ (resumes)
```

The pipeline exists to turn an idea into an approved execution contract, then execute it with traceability, and test and review the right version of it before the change lands and the item closes.

Above the items, the `travel` skill plans and runs a whole day: it sizes the work, keeps several items moving in its own session (one slot each, no detached process) and reports what needs the human or is waiting to merge. See [skill routing](skills.md).

Features and bugs share one state machine. Create a bug with `kf new <name> --type bug`; it goes through `/kf:bug` for triage and reproduction before it reaches planning.

## Where to start

1. [Lifecycle](lifecycle.md) — who does what, and in what order.
2. [State machine](state-machine.md) — the states and the transitions each one allows.
3. [Gates](gates.md) — artifacts, approval, execution ids and report status.
4. [Artifact contract](artifacts.md) — file structure, traceability and the living docs under `docs/specs/`.
5. [CLI reference](cli-reference.md) — the command syntax an agent uses to move state.
6. [Agent onboarding](autoconfig.md) — `kf init`, `AGENTS.md`, the `kf autoconfig` briefing and phase hooks.
7. [Skill routing](skills.md) — which skill loads in which state.
8. [Dashboard](dashboard.md) — the KPIs, the charts, the filters and what each number means.
9. [Agent harness](harness.md) — the in-session loop, `kf next` and `kf record`, the seven agents, `harness.verify` and `kf verify`, and the `kf doctor --fix` migration (`kf drive`, `kf run`, `kf runs` and `kf harness` were removed).
10. [Source layout](source-layout.md) — the shape of `src/` and how to extend it.

## The rules that never bend

- Never move a folder by hand; use `kf stage`, `kf cancel` or `kf archive`.
- `kf cancel` is the second way out. It needs `--reason`, moves the item to `.works/cancelled/`, and the only way back is the stage it stopped in.
- The requirement or bug report must be `status: confirmed` before it leaves brainstorm.
- Approving the plan starts the item: `kf approve` moves it to implementation, `kf approve --backlog` parks it in `backlog`. Nobody is asked to choose between the two in chat.
- Planning needs human approval. A feature's fingerprint covers the requirement, the four planning artifacts and every UC file; a bug's fingerprint covers only the bug report.
- Editing the execution contract after approval forces a return to planning and a fresh approval.
- Every entry into testing mints a new execution id. The testing and review reports must reference that exact id.
- A FAIL, or red CI on the PR, returns to implementation, where each failure is repaired on the task that owns it, and must be tested again. BLOCKED stops the pipeline.
- Review runs the independent `code-reviewer` first; only after its PASS is the branch pushed and the PR opened, and the review report is PASS only when CI is green or absent. The human merges the PR on GitHub; `kf status`, `kf sync` or `kf archive` then closes the item into `done`, removes its worktree and deletes the merged branch.
- REQUIREMENT_BUG stops every ordinary transition so the user can decide.
- The feature report must be written before the close, and the close copies nothing under `docs/`: review edits the living docs under `docs/specs/` and the review report records `docs:`. A bug only updates an existing living doc when there is a docs impact.

One rule in that list is not like the others: the pipeline granting itself no access to a database, a deployment, a publish or a message is a **policy carried in the skill prompts**, not a gate. Nothing in `src/` enforces it. It bends exactly as far as the agent does.

## Filesystem model

```text
project/
├── .kf/
│   ├── config.json
│   ├── templates/
│   ├── hooks/
│   ├── review/rules/
│   └── travel/             (the day ledger and estimates, gitignored)
├── .works/
│   ├── brainstorm/
│   ├── planning/
│   ├── backlog/
│   ├── implementation/
│   ├── testing/
│   ├── review/
│   ├── cancelled/
│   └── done/
└── docs/
    ├── specs/{context}/README.md + <capability>.md   # living docs
    ├── requirement/{context}/{feature}.md           # legacy snapshots, until kf:docs
    ├── use-cases/{context}/{feature}/README.md + UC-###-<slug>.md + diagram.md
    └── testplan/{context}/{feature}{,-result}.md
```

Each work item folder is named `{feature}_{YYYYMMDD_HHmm}` and carries a `.kfw.json`. The standard artifacts all use the `phase-{number}-` prefix.

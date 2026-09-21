# Kanban Flow

The workflow is driven by the `kf` CLI and the eight skills under `skills/`.

```text
brainstorm → planning → implementation → testing → review → dones
                 ↘ backlog ↗

any stage ──kf cancel──→ cancelled ──back to the stage it stopped in──→ (resumes)
```

A feature or bug needs human confirmation; planning needs human approval bound to the contents of the contract. After approval the user chooses to start now or to hold the item in backlog. A feature produces the full set of planning artifacts and a feature report; a bug needs only a triage report plus its test and review evidence. Every round of testing gets its own execution id, and both testing and review must PASS for that same run. A feature receives its canonical docs (`docs/requirement`, `docs/use-cases`, `docs/testplan`) on archive; a bug updates only the related docs when it needs to. A FAIL or a REJECT returns to implementation; a REQUIREMENT_BUG stops the work item. `kf cancel --reason` is the second way out: the item moves to `.works/cancelled/` and can only be reopened at the stage it stopped in.

See [the install guide, the CLI, the gates and the hooks](../README.md) to use the current workflow. Templates live in `kanban-flow/templates/`; project and user overrides live in `.kf/`.

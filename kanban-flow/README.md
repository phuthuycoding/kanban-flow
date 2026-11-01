# Kanban Flow

The workflow is driven by the `kf` CLI and the nine skills under `skills/`.

```text
brainstorm → planning → implementation → testing → review → done
                 ↘ backlog ↗

any stage ──kf cancel──→ cancelled ──back to the stage it stopped in──→ (resumes)
```

A feature or bug needs human confirmation; planning needs human approval bound to the contents of the contract. Approval starts the item (`kf approve --backlog` holds it in backlog instead). Starting means the in-session loop: the session runs the plan's tasks (test-writer, developer, `kf verify --task`, code-reviewer), then testing and review, and stops when a review PASS is waiting for its merge; `kf drive`, `kf run`, `kf runs` and `kf harness` were removed. An independent `code-reviewer` writes the review report; on PASS the branch is pushed, the PR opened and CI watched, and the human merges on GitHub. The next `kf status` closes the item: branch and item worktree removed safely, canonical docs synced, folder moved to `.works/done/`. `kf ship` is deprecated. The `travel` skill runs a day of many items on top of this ladder. A feature produces the full set of planning artifacts and a feature report; a bug needs only a triage report plus its test and review evidence. Every round of testing gets its own execution id, and both testing and review must PASS for that same run. A feature receives its canonical docs (`docs/requirement`, `docs/use-cases`, `docs/testplan`) when the item closes; a bug updates only the related docs when it needs to. A FAIL or a REJECT returns to implementation; a REQUIREMENT_BUG stops the work item. `kf cancel --reason` is the second way out: the item moves to `.works/cancelled/` and can only be reopened at the stage it stopped in.

See [the install guide, the CLI, the gates and the hooks](../README.md) to use the current workflow. Templates live in `kanban-flow/templates/`; project and user overrides live in `.kf/`.

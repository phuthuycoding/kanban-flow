---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  M[Maintainer] --> UC1[UC-001 Approve starts; --backlog defers]
  M --> UC3[UC-003 Merge closes the item]
  M --> UC6[UC-006 Epic issue type; #95 is an Epic]
  T[Travel] --> UC5[UC-005 Morning plan, loop, end of day]
  T --> UC7[UC-007 Progress block and parallel worktrees]
  D[Drive supervisor kf drive] --> UC4[UC-004 Config from worktree, origin/main, primary]
  W[Drive workers: tester, code-reviewer] --> UC2[UC-002 Review = PR + reviewer + CI watch]
  UC5 -. starts kf drive per slot .-> D
  UC2 -. PASS + CI green .-> UC3
  UC1 -. implementation .-> D
  UC7 -. Waiting to merge .-> UC3
```

- Actors: Maintainer (decides: spec, plan, daily plan, destructive; does: merge), Travel (day orchestrator, no product code), Drive supervisor (`kf drive`), Drive workers (coder, tester, code-reviewer in item worktrees)
- Use cases: UC-001 approve starts or defers; UC-002 review opens the PR, runs the independent reviewer and watches CI; UC-003 merge on GitHub closes the item to `done`; UC-004 drive config resolution; UC-005 travel day; UC-006 Epic issue type; UC-007 progress block and parallel worktrees
- Relationships: UC-001 feeds the drive (implementation); UC-005 dispatches drives per slot and reads their stops; UC-002 PASS with green CI feeds UC-003 through the Waiting to merge bucket of UC-007; UC-004 is a precondition every drive relies on when the primary checkout is stale

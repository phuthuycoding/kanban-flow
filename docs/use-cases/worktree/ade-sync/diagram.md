---
feature: ade-sync
context: worktree
created: 20261014_2112
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  DEV[Developer] --> UC1[UC-001 Create worktree attaches into running ADEs]
  DEV --> UC2[UC-002 Create worktree with no ADE reachable]
  DEV --> UC3[UC-003 Adapter failure degrades to warning]
  DEV --> UC4[UC-004 Remove worktree detaches ADE state]
  DEV --> UC6[UC-006 kf worktree sync broadcasts current worktree]
  MNT[kf maintainer] --> UC5[UC-005 Add a new ADE adapter]
  UC1 -.-> ORCA[(Orca)]
  UC1 -.-> HERDR[(Herdr)]
  UC3 -.-> HERDR
  UC4 -.-> HERDR
  UC6 -.-> ORCA
  UC6 -.-> HERDR
```

- Actors: Developer (runs kf), kf maintainer (extends the registry); Orca and Herdr are supporting systems.
- Use cases: UC-001 attach on create; UC-002 silent no-op without ADEs; UC-003 failure → warning; UC-004 detach on remove; UC-005 registry extension; UC-006 manual broadcast incl. foreign worktrees.
- Relationships: UC-001 and UC-006 exercise both ADEs through the same attach path; UC-003/UC-004 share the Herdr workspace lifecycle; UC-005 underpins all of them through the shared adapter interface.

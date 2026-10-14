---
feature: archive-docs-latest
context: cli
created: 20261013_1513
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  A[Maintainer/agent] --> UC1[UC-001 Archive stamps every canonical doc as archived]
  A --> UC2[UC-002 Re-archive in dones stays idempotent with stamped docs]
  S[Agent running kanban-archive] --> UC3[UC-003 Agent reconciles docs superseded by the new feature]
  UC3 -->|precedes| UC1
  R[Docs reader] -.reads.-> UC1
```

- Actors: Maintainer/agent, Agent running kanban-archive, Docs reader
- Use cases: UC-001, UC-002, UC-003
- Relationships: reconcile (UC-003) runs before `kf archive` (UC-001); re-archive (UC-002) reuses UC-001's stamping

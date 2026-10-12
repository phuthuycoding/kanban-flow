---
feature: "archive-after-merge"
context: "cli"
created: "20261011_1108"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  H[Human maintainer] --> UC1[UC-001 Refuse unmerged PR]
  H --> UC2[UC-002 Archive delivers merged item]
  H --> UC3[UC-003 Archive without PR]
  H --> UC4[UC-004 Reconcile legacy dones]
  H --> UC5[UC-005 Awaiting-merge visibility]
  C[Human / cron] --> UC6[UC-006 kf sync sweep]
  GH[gh CLI] -.->|merge state| UC1
  GH -.->|merge state| UC6
  HOOK[dones hook pack] -.->|AC gate, board, close| UC2
  HOOK -.->|re-run| UC4
  UC6 -.->|delegates per item| UC2
  UC1 -.->|gate inside| UC2
```

- Actors: Human maintainer (or cron driving `kf sync`), `gh` CLI, `dones` hook pack.
- Use cases: UC-001…UC-006 — the merge gate (UC-001) is a guard inside archive's finalization (UC-002/UC-004) and the sweep (UC-006); UC-003 is the no-evidence branch; UC-005 is read-only visibility.
- Relationships: `kf archive` is the single funnel — `kf stage x dones` and `kf sync` both delegate to it; the hook pack supplies the tracker side effects.

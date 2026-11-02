---
feature: researcher-agent
context: harness
created: 20261102_1044
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  H[Human] --> UC2[UC-002 Spike question answered by kf:spike]
  H --> UC4[UC-004 Migrate old install to the kf plugin]
  C[Controller session] --> UC1[UC-001 Auto-dispatch kf:researcher]
  C --> UC3[UC-003 Unblock a developer with research]
  UC2 --> R[kf:researcher agent]
  UC1 --> R
  UC3 --> R
  UC3 --> D[Developer agent]
  UC4 --> CL[claude CLI]
  C --> UC5[UC-005 Run a one-task wave inline]
  UC5 --> D
```

- Actors: Human, Controller session, kf:researcher agent, Developer agent, claude CLI
- Use cases: UC-001, UC-002, UC-003, UC-004, UC-005
- Relationships: the brainstorm/plan skills (UC-001), the spike skill (UC-002) and the implement skill (UC-003) dispatch the researcher; `kf install`/`doctor`/`uninstall` (UC-004) drive the `claude plugin` CLI and the shared `kf-*` copies.

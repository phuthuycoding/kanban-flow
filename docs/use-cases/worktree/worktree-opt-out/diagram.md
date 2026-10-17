---
feature: worktree-opt-out
context: worktree
created: 20261017_1750
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  O[Project owner / agent] --> UC1[UC-001 Default-off: no provisioning]
  O --> UC2[UC-002 Opt-in provisions]
  O --> UC3[UC-003 Doctor silent when disabled]
  O --> UC4[UC-004 Operator commands + teardown]
```

- Actors: Project owner, agent (CLI operator)
- Use cases: UC-001 default resolution skips provisioning; UC-002 explicit opt-in reproduces legacy behaviour; UC-003 doctor gating; UC-004 operator commands and teardown ignore the flag
- Relationships: all four are operator-initiated flows against `worktreeConfig`/doctor/teardown paths

---
feature: "worktree-domains"
context: "cli"
created: "20261007_1929"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  Op[Người vận hành] --> UC1[UC-001 Onboard hạ tầng domain]
  Op --> UC5[UC-005 Nhận cảnh báo infra thiếu]
  Op --> UC8[UC-008 List worktree + orphan]
  Ag[Agent] --> UC2[UC-002 Vào implementation → worktree + domain]
  Ag --> UC3[UC-003 Code + tự test qua domain]
  Ag --> UC4[UC-004 Archive: gỡ worktree giữ branch]
  Ag --> UC6[UC-006 Resume tái dùng worktree]
  Ag --> UC7[UC-007 Dirty worktree bị từ chối]
  Px[kf proxy serve] --> UC3
```

- Actors: Người vận hành, Agent, `kf proxy serve` (daemon)
- Use cases: UC-001..UC-008 như index
- Relationships: UC-003 phụ thuộc UC-001 (infra) và UC-002/UC-006 (worktree); UC-004/UC-007 là hai nhánh teardown của cùng sự kiện archive/cancel; `kf proxy serve` là supporting actor phục vụ request tới domain.

---
feature: "workflow-hardening"
context: "cli"
created: "20260919_1206"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  A[Agent] --> UC1[UC-001 Đọc briefing autoconfig và chạy lệnh]
  A --> UC2[UC-002 Bị chặn khi artifact chứa secret thật]
  A --> UC3[UC-003 Bypass gate, dấu vết được ghi]
  A --> UC5[UC-005 Bị chặn khi report PASS có exit code khác 0]
  R[GitHub Actions runner] --> UC4[UC-004 Chạy typecheck, lint, test]
  O[Người vận hành] --> UC6[UC-006 kf init seed AGENTS.md]
  O --> UC7[UC-007 Đọc CHANGELOG và version]
  O -. đọc dấu vết .-> UC3
  UC3 -. hiển thị qua status/validate/dashboard .-> O
```

- Actors: Agent (chạy `kf` trong pipeline), GitHub Actions runner, Người vận hành (đại ca)
- Use cases: UC-001 … UC-007 như index; UC-002 và UC-005 là hai hành vi chặn của validator, UC-003 là hành vi ghi vết
- Relationships: Người vận hành là bên tiêu thụ dấu vết của UC-003; UC-004 bao trùm toàn bộ test của các UC còn lại khi chạy trên CI

---
feature: "agent-roles"
context: "cli"
created: "20260919_2220"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  O[Người vận hành] --> UC1[UC-001 Khai báo roles và gán stage]
  O --> UC4[UC-004 Đổi model cho một role]
  O --> UC6[UC-006 Config cũ báo lỗi có hướng dẫn]
  M[Main agent] --> UC2[UC-002 Chạy chuỗi role trong một stage]
  M --> UC3[UC-003 Dừng chuỗi khi một role không DONE]
  M --> UC5[UC-005 Session tách theo role]
  UC2 -. role 1 .-> W1[Worker: researcher]
  UC2 -. role 2 .-> W2[Worker: writer]
  W1 -. output file .-> W2
  UC1 -. stage → role → runner .-> UC2
  UC4 -. chỉ sửa lớp role → runner .-> UC2
```

- Actors: Người vận hành (cấu hình, quan sát), Main agent (điều phối, giữ human gate), Worker agent (CLI headless đóng một role)
- Use cases: UC-001…UC-006 như index; UC-002 là luồng chính, UC-003/UC-005 là biến thể của cùng lệnh `kf run`
- Relationships: Lớp `role` nằm giữa stage và runner nên UC-004 không chạm UC-001; kết quả của role trước tới role sau qua file `output` trên đĩa, không qua bộ nhớ hội thoại

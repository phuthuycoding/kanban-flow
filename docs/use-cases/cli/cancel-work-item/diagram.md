---
feature: "cancel-work-item"
context: "cli"
created: "20260919_2245"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  O[Người vận hành] --> UC1[UC-001 Bỏ việc đang dở kèm lý do]
  O --> UC2[UC-002 Bỏ việc đã archive, quyết định docs]
  O --> UC3[UC-003 Mở lại việc bỏ nhầm]
  O --> UC4[UC-004 Đọc danh sách và tỷ lệ không bị bóp méo]
  M[Main agent] --> UC5[UC-005 Gate và hook ở stage cancelled]
  M --> UC6[UC-006 Đề xuất dừng hẳn khi REQUIREMENT_BUG]
  UC6 -. người quyết .-> UC1
  UC1 -. cancellation.fromStage .-> UC3
  UC1 -. loại khỏi mẫu số .-> UC4
```

- Actors: Người vận hành (quyết định bỏ và mở lại), Main agent (đề xuất, không tự bỏ)
- Use cases: UC-001…UC-006 như index; UC-001 là luồng chính, UC-002/UC-003 là biến thể
- Relationships: Agent chỉ đề xuất, quyết định bỏ luôn thuộc về người, giống hai human gate hiện có

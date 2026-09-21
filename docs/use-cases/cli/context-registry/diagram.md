---
feature: "context-registry"
context: "cli"
created: "20260920_1350"
status: planning
---

# Use Case Diagram

```mermaid
graph TD
  D[Dai ca] --> UC1[UC-001 Declare the context list at init]
  D --> UC4[UC-004 Spot a context in use but not declared]
  U[Whoever creates a work item] --> UC2[UC-002 A mistyped context is refused with a suggestion]
  A[Agent] --> UC3[UC-003 Survey the repo and propose a list]
  UC3 -.->|human confirms, then writes config| UC1
  UC1 -.->|the declared list is what UC-002 checks against| UC2
  UC4 -.->|feeds names back into| UC1
```

## Notes
- Actors: đại ca là người chốt danh sách, agent chỉ đề xuất, và bất kỳ ai gõ `kf new` là người chạm vào rào chắn.
- Relationships: UC-003 nuôi UC-001, UC-001 là điều kiện để UC-002 có gì mà đối chiếu, UC-004 chỉ ra chỗ danh sách còn thiếu để quay lại UC-001.
- Agent không có mũi tên nào trỏ thẳng vào việc ghi config: đó là chủ ý, không phải thiếu sót.

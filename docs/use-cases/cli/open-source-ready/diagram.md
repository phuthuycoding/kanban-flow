---
feature: "open-source-ready"
context: "cli"
created: "20260919_2340"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  S[Người lạ ghé repo] --> UC1[UC-001 Đọc README, hiểu vấn đề]
  UC1 --> T[Người dùng thử]
  T --> UC2[UC-002 Cài một dòng, chạy ngay]
  T --> UC3[UC-003 Bề mặt tiếng Anh, không gặp ngôn ngữ lạ]
  T --> UC5[UC-005 Đọc tài liệu chi tiết bằng tiếng Anh]
  M[Maintainer] --> UC4[UC-004 Publish khi muốn]
  UC4 -. tên gói kanban-flow, 0.3.0, LICENSE .-> UC2
```

- Actors: Người lạ ghé repo (đọc và quyết định), Người dùng thử (cài và chạy), Maintainer (publish, duy trì)
- Use cases: UC-001…UC-004; UC-001 là cửa vào, UC-003 quyết định người thử ở lại hay bỏ
- Relationships: UC-004 là điều kiện để UC-002 tồn tại; README của UC-001 phải trung thực theo khảo sát thị trường chứ không phóng đại; UC-005 là nơi người dùng đi tiếp sau README

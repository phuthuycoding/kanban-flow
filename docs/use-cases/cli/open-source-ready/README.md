---
feature: "open-source-ready"
context: "cli"
created: "20260919_2340"
status: planning
---

# Use Case Index

Mỗi use case là một file riêng trong thư mục `use-cases/`, không viết narrative gộp trong file này.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Người lạ đọc README và hiểu vấn đề trong 30 giây | [UC-001](UC-001.md) | Người lạ ghé repo | planned |
| UC-002 | Cài một dòng và chạy được ngay | [UC-002](UC-002.md) | Người dùng thử | planned |
| UC-003 | Bề mặt công cụ không còn ngôn ngữ lạ | [UC-003](UC-003.md) | Người dùng thử | planned |
| UC-004 | Đại ca publish khi muốn, không phải sửa thêm | [UC-004](UC-004.md) | Đại ca (maintainer) | planned |
| UC-005 | Người đọc tài liệu chi tiết bằng tiếng Anh | [UC-005](UC-005.md) | Người dùng thử | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-004 | TC-005, TC-006 | README tiếng Anh, mở bằng vấn đề, positioning trung thực |
| UC-002 | FR-005 | TC-005 | Cài một dòng, bỏ câu repo private |
| UC-003 | FR-001, FR-002 | TC-001, TC-002, TC-003 | Không còn tiếng Việt ở src, skills, template, dashboard |
| UC-004 | FR-003, FR-006, FR-007, FR-009 | TC-004, TC-007, TC-008 | Tên gói, phiên bản, LICENSE, npm pack không mang docs nội bộ |
| UC-005 | FR-008 | TC-009, TC-010 | Docs tiếng Anh, liên kết nội bộ còn sống |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 5 |
| Actors | 3 |
| Functional requirements covered | 9 |
| Test cases linked | 10 |

---
feature: "agent-roles"
context: "cli"
created: "20260919_2220"
status: planning
---

# Use Case Index

Mỗi use case là một file riêng trong thư mục `use-cases/`, không viết narrative gộp trong file này.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Khai báo roles, gán stage → role, kiểm tra bằng `kf harness` | [UC-001](UC-001.md) | Người vận hành | planned |
| UC-002 | Một stage chạy chuỗi role, bước sau nhận kết quả bước trước | [UC-002](UC-002.md) | Main agent | planned |
| UC-003 | Một role không DONE thì dừng chuỗi | [UC-003](UC-003.md) | Main agent | planned |
| UC-004 | Đổi model cho một role mà không đụng stage mapping | [UC-004](UC-004.md) | Người vận hành | planned |
| UC-005 | Hai role dùng chung runner nhưng session tách biệt | [UC-005](UC-005.md) | Main agent | planned |
| UC-006 | Config kiểu cũ báo lỗi kèm hướng dẫn chuyển đổi | [UC-006](UC-006.md) | Người vận hành | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-002, FR-007, FR-008 | TC-001, TC-002, TC-011 | Validate, seed, hiển thị ba lớp |
| UC-002 | FR-003, FR-004, FR-006 | TC-004, TC-005, TC-008, TC-009 | Chuỗi chạy, prompt vai/brief/output/previous, skill theo runner |
| UC-003 | FR-003 | TC-008, TC-010 | Dừng chuỗi, `--role`, `--agent` bị bỏ |
| UC-004 | FR-001, FR-008 | TC-002, TC-012 | Đổi runner một dòng, view theo role |
| UC-005 | FR-005 | TC-006, TC-007 | Session theo role, runs có role+runner |
| UC-006 | FR-002, FR-009 | TC-003, TC-013 | Lỗi nêu runner vs role, docs migration |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 6 |
| Actors | 3 |
| Functional requirements covered | 9 |
| Test cases linked | 13 |

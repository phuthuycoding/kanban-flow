---
feature: "cancel-work-item"
context: "cli"
created: "20260919_2245"
status: planning
---

# Use Case Index

Mỗi use case là một file riêng trong thư mục `use-cases/`, không viết narrative gộp trong file này.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Bỏ một việc đang dở, ghi lý do | [UC-001](UC-001.md) | Người vận hành | planned |
| UC-002 | Bỏ một việc đã archive và quyết định số phận canonical docs | [UC-002](UC-002.md) | Người vận hành | planned |
| UC-003 | Mở lại một việc đã bỏ nhầm | [UC-003](UC-003.md) | Người vận hành | planned |
| UC-004 | Item đã bỏ không làm bẩn danh sách, không bóp méo tỷ lệ | [UC-004](UC-004.md) | Người vận hành | planned |
| UC-005 | Gate và hook cư xử đúng với stage cancelled | [UC-005](UC-005.md) | Main agent | planned |
| UC-006 | Agent đề xuất dừng hẳn, người quyết | [UC-006](UC-006.md) | Main agent | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-002, FR-003 | TC-001, TC-002, TC-003 | Metadata đủ 4 trường, reason bắt buộc, hook |
| UC-002 | FR-004 | TC-005 | Liệt kê docs, purge có confirm |
| UC-003 | FR-005 | TC-007 | Chỉ về fromStage, xoá cancellation |
| UC-004 | FR-007 | TC-009, TC-010 | list/status/view/dashboard, mẫu số |
| UC-005 | FR-001, FR-006 | TC-004, TC-006, TC-008 | Không gate artifact, cancellation_missing, chặn archive |
| UC-006 | FR-008 | TC-011 | Docs và skill |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 6 |
| Actors | 2 |
| Functional requirements covered | 8 |
| Test cases linked | 11 |

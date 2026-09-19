---
feature: "cancel-work-item"
context: "cli"
created: "20260919_2245"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Bỏ một việc đã archive và quyết định số phận canonical docs |
| Requirement reference | FR-004 |
| Goal | Khi một feature đã archive bị thay thế, người vận hành thấy rõ tài liệu nào của nó còn trong repo và tự quyết xoá hay giữ |
| Primary actor | Người vận hành |

## Supporting Actors
- Không

## Preconditions
- Work item đang ở `dones` và đã sync canonical docs

## Trigger
Feature bị một feature sau viết đè, hoặc bị rút khỏi sản phẩm.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người vận hành | `kf cancel old-feature --reason "bị thay thế bởi new-feature"` | CLI xử lý như UC-001 |
| 2 | kf | Dựng danh sách canonical docs của đúng item đó theo `context` và tên | Không dò rộng, không đoán |
| 3 | kf | In danh sách và **không xoá** | Người vận hành tự quyết |
| 4 | Người vận hành | Chạy lại với `--purge-docs` nếu muốn xoá | CLI hỏi xác nhận trên TTY rồi mới xoá |

## Alternative Flows
### A1
- Trigger: Non-TTY (agent hoặc CI) chạy `--purge-docs`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bắt buộc `--force`, không có thì exit 1 | Không xoá ngầm trong tự động hoá |

### A2
- Trigger: Item chưa từng archive

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Không có bước liệt kê docs | Về UC-001 bước 5 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Một số docs đã bị xoá tay trước đó | Chỉ liệt kê file còn tồn tại | Không lỗi |
| Người dùng chọn Cancel ở prompt | Không xoá gì, item vẫn được chuyển sang cancelled | In rõ docs còn nguyên |

## Postconditions
- Người vận hành biết chính xác tài liệu nào còn lại; repo không mất file nào ngoài ý muốn

## Business Rules
- Xoá tài liệu là destructive nên không bao giờ ngầm
- Chỉ đụng canonical docs của chính item đó

## Data
- `docs/requirement/{ctx}/{name}.md`, `docs/use-cases/{ctx}/{name}/`, `docs/testplan/{ctx}/{name}.md`, `{name}-result.md`

## Acceptance Criteria
- [ ] Liệt kê đủ docs, không xoá khi không có cờ; `--purge-docs --force` xoá đúng (TC-005)

---
feature: "open-source-ready"
context: "cli"
created: "20260919_2340"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Người đọc tài liệu chi tiết bằng tiếng Anh |
| Requirement reference | FR-008 |
| Goal | Người đọc đi từ README sang tài liệu chi tiết mà không đụng phải rào ngôn ngữ, và mọi liên kết còn sống |
| Primary actor | Người dùng thử |

## Supporting Actors
- Agent đọc tài liệu khi được `kf autoconfig` trỏ tới

## Preconditions
- README đã trỏ sang `docs/workflow/`

## Trigger
Người đọc muốn hiểu gate, state machine, artifact hoặc harness.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người đọc | Mở `docs/workflow/README.md` | Mục lục tiếng Anh, trỏ đúng các file |
| 2 | Người đọc | Mở `gates.md`, `state-machine.md`, `lifecycle.md` | Tiếng Anh, sơ đồ mermaid có nhãn tiếng Anh |
| 3 | Người đọc | Bấm liên kết chéo giữa các file | Không gặp liên kết chết |
| 4 | Người đọc | Đọc `harness.md` | Hiểu ba lớp stage, role, runner |

## Alternative Flows
### A1
- Trigger: Agent đọc docs qua `kf autoconfig`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Nội dung tiếng Anh nên agent không phải dịch ngầm | Về bước 2 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Dịch tiêu đề mục làm chết anchor của liên kết nội bộ | Test kiểm mọi liên kết trỏ tới file tồn tại; anchor đổi thì sửa cả hai đầu | Không có liên kết chết |
| Dịch làm lệch nội dung kỹ thuật | Giữ nguyên tên lệnh, mã lỗi, đường dẫn; chỉ đổi văn xuôi | Tài liệu vẫn khớp công cụ |

## Postconditions
- Toàn bộ tài liệu người đọc bằng tiếng Anh; nhật ký nội bộ trong `.works/` và canonical docs cũ giữ nguyên

## Business Rules
- Dịch, không viết lại: giữ nguyên cấu trúc mục, bảng và sơ đồ
- `source-layout.md` đã là tiếng Anh, chỉ rà lại

## Data
- `docs/README.md`, `kanban-flow/README.md`, `docs/workflow/*.md`

## Acceptance Criteria
- [ ] grep tiếng Việt trên `docs/README.md`, `kanban-flow/README.md` và `docs/workflow/**` trả rỗng (TC-009)
- [ ] Mọi liên kết nội bộ trong docs trỏ tới file tồn tại (TC-010)

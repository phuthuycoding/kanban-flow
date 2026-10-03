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
| ID | UC-003 |
| Name | Bề mặt công cụ không còn ngôn ngữ lạ |
| Requirement reference | FR-001, FR-002 |
| Goal | Người dùng nước ngoài chạy công cụ mà không gặp chuỗi tiếng Việt ở bất kỳ đâu họ nhìn thấy |
| Primary actor | Người dùng thử |

## Supporting Actors
- Agent đọc skill được cài vào project

## Preconditions
- Đã cài và chạy `kf init`

## Trigger
Chạy bất kỳ lệnh `kf` nào, mở dashboard, hoặc agent đọc skill.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người dùng | `kf status --change <f>` | Tên phase tiếng Anh, kể cả backlog và cancelled |
| 2 | Người dùng | `kf dashboard` rồi mở trình duyệt | Toàn bộ giao diện tiếng Anh, `lang="en"` |
| 3 | Agent | Đọc skill brainstorm/plan/bug được cài vào project | Hướng dẫn tiếng Anh, giữ nguyên ý và cấu trúc |
| 4 | Agent | Đọc template use-case-specification | Tiếng Anh |

## Alternative Flows
### A1
- Trigger: Người dùng đọc tài liệu chi tiết

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `docs/workflow/*.md` vẫn tiếng Việt; README đã báo trước | Không bất ngờ, nằm trong backlog |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Có nhánh lỗi hiếm còn chuỗi tiếng Việt | Test grep toàn bộ `src/**` bắt được, không dựa vào mắt người | Không lọt |

## Postconditions
- Không còn tiếng Việt ở bề mặt công cụ

## Business Rules
- Dịch giữ nguyên ý, không rút gọn, không đổi bố cục
- Nhật ký nội bộ trong `.works/` và canonical docs cũ không thuộc phạm vi

## Data
- `src/**`, `skills/**`, `kanban-flow/templates/**`

## Acceptance Criteria
- [ ] grep tiếng Việt trên `src/**` trừ tests trả rỗng (TC-001)
- [ ] grep tiếng Việt trên `skills/**` và templates trả rỗng (TC-002)
- [ ] Dashboard HTML tiếng Anh, `lang="en"`; `kf status` in tên phase tiếng Anh (TC-003)

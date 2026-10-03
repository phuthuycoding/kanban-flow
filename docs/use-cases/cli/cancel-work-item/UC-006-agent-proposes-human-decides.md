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
| ID | UC-006 |
| Name | Agent đề xuất dừng hẳn, người quyết |
| Requirement reference | FR-008 |
| Goal | Khi pipeline đâm vào tường (REQUIREMENT_BUG, scope chết), agent biết có lối thoát và biết nó không được tự đi |
| Primary actor | Main agent |

## Supporting Actors
- Người vận hành (ra quyết định)

## Preconditions
- Work item ở trạng thái không đi tiếp được

## Trigger
Review trả `REQUIREMENT_BUG`, hoặc người dùng nói bỏ.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Main agent | Đọc skill `kanban-flow`: REQUIREMENT_BUG thì dừng và báo người | Không tự sửa requirement |
| 2 | Main agent | Trình bày hai lối: quay lại planning sửa scope, hoặc `kf cancel` kèm lý do | Người có đủ thông tin |
| 3 | Người vận hành | Chọn | Agent làm theo |

## Alternative Flows
### A1
- Trigger: Người dùng chủ động bảo bỏ

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Agent chạy `kf cancel` với lý do do người nêu | Về UC-001 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Agent tự ý cancel khi chưa được bảo | Vi phạm contract trong skill | `cancellation.by` và `runs[]` để soi lại |

## Postconditions
- Quyết định bỏ luôn có người đứng sau

## Business Rules
- Cancel là quyết định của người, cùng hạng với hai human gate hiện có

## Data
- `skills/kanban-flow/SKILL.md`, `docs/workflow/{lifecycle,state-machine,gates}.md`

## Acceptance Criteria
- [ ] Docs và skill mô tả lối thoát và ai được quyết (TC-011)

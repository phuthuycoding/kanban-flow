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
| ID | UC-005 |
| Name | Gate và hook cư xử đúng với stage cancelled |
| Requirement reference | FR-001, FR-006 |
| Goal | Item đã bỏ không bị đòi artifact, nhưng cũng không được tồn tại mà thiếu lý do |
| Primary actor | Main agent |

## Supporting Actors
- Người vận hành (đọc `kf validate`)

## Preconditions
- Item ở `cancelled`

## Trigger
`kf validate`, `kf status`, `kf archive` chạm vào item đã bỏ.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Validator | `STAGE_INDEX.cancelled = -1` làm mọi so sánh `>= dueFromStage` và `>= planning` thành false | Không đòi artifact, approval, traceability, report |
| 2 | Validator | Kiểm riêng: có `cancellation.reason` không | Thiếu → ERROR `cancellation_missing` |
| 3 | kf | `kf archive` trên item cancelled | exit 1 |

## Alternative Flows
### A1
- Trigger: Item bị cancel khi đang ở planning đã approve

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Không đòi 4 artifact planning, không đòi approval | `kf validate` valid |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `.works/cancelled/` chưa tồn tại (project cũ) | `ensureWorksStructure` tạo; `kf cancel` tự tạo nếu thiếu | Không lỗi |

## Postconditions
- Không tồn tại item cancelled mà không ai biết vì sao

## Business Rules
- Tắt gate bằng index âm, không rải `if (stage === "cancelled")` khắp validator

## Data
- `STAGE_INDEX`, `cancellation.reason`

## Acceptance Criteria
- [ ] Item cancelled valid khi có reason, ERROR khi thiếu; item đang approve cũng không bị đòi gì (TC-004)
- [ ] Hook `cancelled.sh` chạy và chặn được (TC-006)
- [ ] `kf archive` bị chặn (TC-008)

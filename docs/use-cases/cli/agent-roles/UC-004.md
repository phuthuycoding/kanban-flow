---
feature: "agent-roles"
context: "cli"
created: "20260919_2220"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Đổi model cho một role mà không đụng stage mapping |
| Requirement reference | FR-001, FR-008 |
| Goal | Khi một model mạnh lên hoặc yếu đi, chỉ sửa một dòng, quy trình giữ nguyên |
| Primary actor | Người vận hành |

## Supporting Actors
- Main agent (lần chạy sau dùng runner mới)

## Preconditions
- Đã có `roles` và `stages`; runner mới có trong `harness.runners`

## Trigger
Người vận hành đổi `roles.reviewer.runner` từ `codex` sang `claude-opus`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người vận hành | Sửa một dòng trong `roles` | `stages` không đổi |
| 2 | `kf harness` | In role → runner mới | Xác nhận |
| 3 | kf | Lần `kf run` sau dùng CLI mới; session của role bắt đầu lại vì runner đổi | Không nối nhầm ngữ cảnh |
| 4 | `kf view --json` | `metrics.runs.byRole` gom theo vai, thấy được vai nào tốn bao nhiêu | So sánh được giữa các đợt |

## Alternative Flows
### A1
- Trigger: Thêm runner mới cho cùng CLI khác model (`claude-haiku`)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Thêm runner rồi trỏ role rẻ tiền vào đó | Về bước 2 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Runner mới không có trên PATH | `kf harness` báo missing; `kf run` lỗi ENOENT ghi vào run | Người vận hành cài CLI |

## Postconditions
- Quy trình giữ nguyên, chỉ thực thi đổi

## Business Rules
- Session gắn với role; đổi runner của role nên coi như ngữ cảnh mới (không resume session cũ của runner khác)

## Data
- `roles.<role>.runner`, `sessions[role]`, `metrics.runs.byRole`

## Acceptance Criteria
- [ ] Đổi runner của role không cần sửa `stages` (TC-002)
- [ ] `kf view --json` có `metrics.runs.byRole` (TC-012)

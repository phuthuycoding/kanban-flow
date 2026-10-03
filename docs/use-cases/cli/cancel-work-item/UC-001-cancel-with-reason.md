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
| ID | UC-001 |
| Name | Bỏ một việc đang dở, ghi lý do |
| Requirement reference | FR-002, FR-003 |
| Goal | Dừng một work item mà vẫn giữ được lý do và bối cảnh, thay vì xoá tay |
| Primary actor | Người vận hành |

## Supporting Actors
- Hook `cancelled.sh` của project (nếu có)

## Preconditions
- Work item tồn tại và chưa ở `cancelled`

## Trigger
Người vận hành quyết định bỏ: đổi hướng, trùng việc khác, hoặc requirement sai từ gốc.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người vận hành | `kf cancel demo --reason "đổi hướng sang giải pháp khác"` | CLI nhận lý do |
| 2 | kf | Kiểm tra item chưa cancelled, không có run đang chạy, reason không rỗng và không chứa secret | Qua kiểm |
| 3 | kf | Chạy hook `cancelled.sh` (project → user → package) | Hook cho phép |
| 4 | kf | Ghi `cancellation { at, by, reason, fromStage }` và `status: "cancelled"`, chuyển folder sang `.works/cancelled/` | Dấu vết còn nguyên trong `.kfw.json` |
| 5 | kf | In stage cũ, lý do và nhắc cách mở lại | Người dùng biết đường lùi |

## Alternative Flows
### A1
- Trigger: `--by` không truyền

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Lấy `reviewer` trong `.kf/config.json`, không có thì `"human"` | Về bước 4 |

### A2
- Trigger: `--skip-hooks`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Bỏ qua hook và ghi `bypasses[]` như các lệnh khác | Về bước 4 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Thiếu `--reason` hoặc chỉ có khoảng trắng | exit 1 nêu reason bắt buộc | Item không đổi stage |
| Reason chứa chuỗi giống credential | `findSecretLike` chặn, exit 1 | Nhất quán với artifact |
| Item đã ở `cancelled` | exit 1 | Không ghi đè lý do cũ |
| Có run harness đang chạy | exit 1 nêu run id, trừ `--force` | Worker không ghi vào folder vừa chuyển |
| Hook exit non-zero | exit 1, in output hook | Item giữ nguyên stage |

## Postconditions
- Item nằm trong `.works/cancelled/` với lý do đọc được; `runs[]`, `bypasses[]`, `sessions` giữ nguyên

## Business Rules
- Lý do là bắt buộc; không có lý do thì bằng xoá
- Agent không tự cancel; đây là quyết định của người

## Data
- `.kfw.json`: `cancellation { at, by, reason, fromStage }`, `status: "cancelled"`

## Acceptance Criteria
- [ ] Metadata đủ bốn trường và folder đã chuyển (TC-001)
- [ ] Reason rỗng/secret/item đã cancelled bị chặn (TC-002)
- [ ] Hook chặn được; `--skip-hooks` ghi bypass (TC-003)

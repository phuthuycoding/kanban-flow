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
| ID | UC-006 |
| Name | Config kiểu cũ báo lỗi kèm hướng dẫn chuyển đổi |
| Requirement reference | FR-002, FR-009 |
| Goal | Người đang dùng `stages: { testing: "gemini" }` biết ngay phải sửa gì, không đoán |
| Primary actor | Người vận hành |

## Supporting Actors
- Docs `harness.md` mục migration

## Preconditions
- Config viết `stages` trỏ thẳng tên runner thay vì tên role

## Trigger
Chạy bất kỳ lệnh `kf` nào đọc config.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Thấy `stages.testing` trỏ tên có trong `runners` nhưng không có trong `roles` | Nhận diện config cũ |
| 2 | kf | Throw: `harness.stages.testing "gemini" is a runner, not a role; declare a role in harness.roles` | Người dùng biết chính xác việc cần làm |
| 3 | Người vận hành | Thêm `roles: { tester: "gemini" }`, đổi `stages.testing` thành `"tester"` | Config hợp lệ |
| 4 | Người vận hành | Đọc mục migration trong `harness.md` nếu cần ví dụ đầy đủ | Chuyển đổi xong |

## Alternative Flows
### A1
- Trigger: Tên trong `stages` không phải role cũng không phải runner

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Lỗi nêu danh sách role hợp lệ | Về bước 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Không có `harness` | Không lỗi; main làm hết như trước | Hành vi cũ giữ nguyên |

## Postconditions
- Không có config nào chạy ở trạng thái nửa cũ nửa mới

## Business Rules
- Không tự migrate; người dùng quyết vai trò nào tên gì
- Thông điệp lỗi phải nêu được cách sửa, không chỉ nêu sai

## Data
- `.kf/config.json`, `docs/workflow/harness.md`

## Acceptance Criteria
- [ ] Lỗi chứa `is a runner, not a role` (TC-003)
- [ ] `harness.md` có mục migration (TC-013)

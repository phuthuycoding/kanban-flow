---
feature: "context-registry"
context: "cli"
created: "20260920_1350"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-004 |
| Name | Nhìn ra context đang dùng mà chưa khai |
| Requirement reference | FR-004 |
| Goal | Thấy được chỗ danh sách khai còn lệch so với thực tế trên đĩa |
| Primary actor | Đại ca |

## Supporting Actors
- `kf contexts`

## Preconditions
- `contexts` đã khai, và repo đã có work item từ trước khi khai.

## Trigger
Chạy `kf contexts`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Đại ca | Chạy `kf contexts` | Lệnh chạy |
| 2 | `kf contexts` | Liệt kê từng context đã khai kèm số work item đang dùng | Thấy cái nào sống cái nào chết |
| 3 | `kf contexts` | Đánh dấu riêng context đang dùng mà chưa khai | Thấy chỗ lệch |
| 4 | Đại ca | Bổ sung vào config nếu thấy hợp lý | Danh sách khớp thực tế |

## Alternative Flows
### A1
- Trigger: Cần đọc bằng máy

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf contexts --json` | Trả cùng dữ liệu dạng JSON |

### A2
- Trigger: Có context đã khai nhưng chưa ai dùng

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Hiển thị số 0, không coi là lỗi | Khai trước dùng sau là hợp lệ |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Không có work item nào | Vẫn liệt kê danh sách đã khai, tất cả số 0 | Không phải lỗi |
| Context đang dùng mà chưa khai | Chỉ nêu ra, không tự thêm vào config và không chặn gì | Đợt này không dọn dữ liệu cũ, chỉ chiếu sáng nó |

## Postconditions
- Không có gì bị đổi trên đĩa. Lệnh này chỉ đọc.

## Business Rules
- `kf contexts` không bao giờ ghi config. Việc ghi là của người, hoặc của agent sau khi người chốt.
- Work item đã tồn tại ở context chưa khai không bị chặn hay đụng tới.

## Data
- `contexts` trong config; `listFeatures` để đếm số work item theo context

## Acceptance Criteria
- [ ] Liệt kê từng context đã khai kèm số work item, kể cả context có 0 (TC-009)
- [ ] Đánh dấu riêng context đang dùng mà chưa khai (TC-010)
- [ ] `--json` trả cùng dữ liệu (TC-009)
- [ ] Lệnh không ghi gì lên đĩa (TC-010)

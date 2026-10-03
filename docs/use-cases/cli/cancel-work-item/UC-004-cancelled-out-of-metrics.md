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
| ID | UC-004 |
| Name | Item đã bỏ không làm bẩn danh sách, không bóp méo tỷ lệ |
| Requirement reference | FR-007 |
| Goal | Đánh dấu bỏ phải rẻ về mặt tâm lý: số liệu không xấu đi vì người ta trung thực |
| Primary actor | Người vận hành |

## Supporting Actors
- Main agent (đọc cùng dữ liệu)

## Preconditions
- Có ít nhất một item ở `cancelled`

## Trigger
Chạy `kf list`, `kf status`, `kf view`, hoặc mở dashboard.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người vận hành | `kf list` | Item hiện với stage `cancelled`, không lẫn vào việc đang làm |
| 2 | Người vận hành | `kf status --change demo` | Dòng `Cancelled: <at> by <by> — <reason>`, không có `Next:` |
| 3 | Người vận hành | `kf view` | `metrics.cancelled` riêng; `completionRate` tính trên mẫu số không gồm cancelled |
| 4 | Người vận hành | Dashboard | Ô KPI Cancelled |

## Alternative Flows
### A1
- Trigger: Toàn bộ item đều cancelled

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Mẫu số bằng 0 → `completionRate` là `null` (hiển thị `N/A`) | Không chia cho 0 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Item cancelled có `runs[]` | Vẫn hiện trong `kf runs`? Không: `kf runs` chỉ quét item không ở `dones`; cancelled cũng bị loại | Giữ danh sách run gọn |

## Postconditions
- Số liệu phản ánh đúng việc đã làm, không bị việc đã bỏ kéo xuống

## Business Rules
- Cancelled không bao giờ nằm trong mẫu số của tỷ lệ hoàn thành
- Reason nhiều dòng thì hiển thị dòng đầu, đầy đủ trong `--json`

## Data
- `metrics.cancelled`, `metrics.completionRate`

## Acceptance Criteria
- [ ] list/status/json đúng (TC-009)
- [ ] `metrics.cancelled` và mẫu số đúng, dashboard có ô Cancelled (TC-010)

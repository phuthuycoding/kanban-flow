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
| ID | UC-003 |
| Name | Mở lại một việc đã bỏ nhầm |
| Requirement reference | FR-005 |
| Goal | Bỏ nhầm không phải án tử: đưa item về đúng stage nó đang đứng lúc bị bỏ |
| Primary actor | Người vận hành |

## Supporting Actors
- Không

## Preconditions
- Item ở `cancelled` và có `cancellation.fromStage`

## Trigger
Người vận hành đổi ý, hoặc lý do bỏ đã được giải quyết.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người vận hành | `kf status --change demo` xem `fromStage` | Biết phải về đâu |
| 2 | Người vận hành | `kf stage demo <fromStage>` | CLI cho phép đúng stage đó |
| 3 | kf | Xoá `cancellation` và `status` khỏi metadata, giữ `runs[]`/`bypasses[]`/`sessions` | Item trở lại như trước khi bỏ |
| 4 | kf | Chạy hook của stage đích như transition thường | Nhất quán với `kf stage` |

## Alternative Flows
### A1
- Trigger: `fromStage` là `dones`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Về `dones`, `status` để trống; muốn đánh dấu archived lại thì chạy `kf archive` | Ghi rõ trong docs |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `kf stage` tới stage khác `fromStage` | exit 1 nêu stage hợp lệ | Không cho nhảy lung tung |
| Metadata bị sửa tay, mất `cancellation` | exit 1 hướng dẫn dùng `--force` | Không đoán stage cũ |

## Postconditions
- Item quay lại pipeline, lịch sử run và bypass còn nguyên

## Business Rules
- Một đường vào, một đường ra; không thêm lệnh riêng cho thao tác hiếm

## Data
- `cancellation.fromStage`

## Acceptance Criteria
- [ ] Mở lại đúng stage, metadata sạch; stage khác bị chặn (TC-007)

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
| ID | UC-002 |
| Name | Gõ nhầm context bị chặn kèm gợi ý |
| Requirement reference | FR-002 |
| Goal | Một lần gõ nhầm không sinh ra cây docs thứ hai |
| Primary actor | Người tạo work item, thường là agent chạy `kf new` |

## Supporting Actors
- `kf new`, nơi rào chắn thật sự nằm

## Preconditions
- `contexts` đã khai trong `.kf/config.json`.

## Trigger
Chạy `kf new <feature> --context <ctx>` với `<ctx>` không thuộc danh sách.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người dùng | `kf new payment-retry --context biling` | Lệnh chạy |
| 2 | `kf new` | Đối chiếu `biling` với danh sách đã khai | Không khớp |
| 3 | `kf new` | Tìm tên gần đúng nhất | Tìm ra `billing` |
| 4 | `kf new` | Trả exit 1, không tạo thư mục nào | Không có `.works/brainstorm/payment-retry_*` |
| 5 | `kf new` | In tên sai, gợi ý, và cả danh sách đã khai | Người dùng sửa được ngay trên dòng lệnh |

## Alternative Flows
### A1
- Trigger: Gõ đúng tên đã khai

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf new payment-retry --context billing` | Tạo bình thường, không có gì đổi so với hôm nay |

### A2
- Trigger: `contexts` chưa khai

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Không đối chiếu gì | Hành xử y hệt hôm nay, project cũ không bị phá |

### A3
- Trigger: Không truyền cờ `--context`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Dùng phần tử đầu của `contexts` | Mặc định **là** phần tử của danh sách, nên không tồn tại trường hợp mặc định bị chính rào chắn từ chối |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Khác nhau chỉ ở hoa thường, ví dụ `Auth` khi đã khai `auth` | Đối chiếu không phân biệt hoa thường rồi từ chối | Bị chặn kèm gợi ý `auth`, không sinh thư mục thứ hai. Đây là ca quan trọng vì `assertPathName` có cờ `i` nên `Auth` vốn lọt được |
| Gõ nhầm quá xa mọi tên đã khai | Vẫn từ chối, không gợi ý bừa | Không có dòng gợi ý, nhưng vẫn in cả danh sách |

## Postconditions
- Không work item nào được tạo, và không thư mục docs nào phát sinh.

## Business Rules
- Chỉ chặn từ lúc tạo mới trở đi. Work item đã tồn tại ở context chưa khai không bị đụng.
- Luôn in cả danh sách đã khai, kể cả khi có gợi ý, để người dùng không phải mở config ra đọc.

## Data
- `contexts` trong config; đối số `--context`

## Acceptance Criteria
- [ ] `normalizeContext` và `suggestContext` cho kết quả đúng trên các ca gần và xa (TC-001, TC-002)
- [ ] Context lạ trả exit 1, không tạo thư mục, in gợi ý và cả danh sách (TC-005)
- [ ] `Auth` khi đã khai `auth` bị từ chối kèm gợi ý (TC-006)
- [ ] `contexts` chưa khai thì context bất kỳ vẫn tạo được (TC-007)

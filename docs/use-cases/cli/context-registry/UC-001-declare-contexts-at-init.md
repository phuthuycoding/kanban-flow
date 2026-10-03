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
| ID | UC-001 |
| Name | Đại ca khai danh sách context lúc init |
| Requirement reference | FR-001, FR-003, FR-005, FR-006, FR-007 |
| Goal | Project có một danh sách context hợp lệ, ghi trong `.kf/config.json` |
| Primary actor | Đại ca |

## Supporting Actors
- `kf init`, nơi đặt câu hỏi
- `kf autoconfig`, nơi nhắc lại nếu chưa khai

## Preconditions
- Đang ở thư mục project muốn khởi tạo.

## Trigger
Chạy `kf init`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Đại ca | Chạy `kf init` trên TTY | Onboarding bắt đầu |
| 2 | `kf init` | Hỏi **một** câu: `Contexts, comma separated, first is the default [app]:` | Nhận danh sách |
| 3 | `kf init` | Ghi `contexts` vào `.kf/config.json` | Config hợp lệ, không cần trường thứ hai |
| 4 | Đại ca | Chạy `kf autoconfig` | Dòng checklist báo `contexts` đã khai, kèm danh sách |

## Alternative Flows
### A1
- Trigger: Chạy `kf init --defaults` hoặc trên non-TTY

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Không hỏi gì. Có `--context X` thì khai `[X]`; không cờ thì **không khai gì**, project ở chế độ tự do | Công cụ không quyết thay người, về bước 4 |

### A2
- Trigger: Đại ca chưa nghĩ ra miền nghiệp vụ nào lúc init

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Bấm Enter ở bước 2 | Nhận mặc định một phần tử, khai lại sau bằng UC-003 |

### A3
- Trigger: Chạy lại `kf init --defaults` trên project cũ đã có config mà chưa khai `contexts`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | Không ghi `contexts` | Project giữ nguyên chế độ tự do; nâng cấp công cụ không đổi hành vi dữ liệu đã có |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `contexts` khai mảng rỗng | Coi là cấu hình sai, không phải chế độ tự do | Config invalid, nêu tên trường |
| Config cũ có cả `defaultContext` lẫn `contexts` với giá trị khác nhau | Phần tử đầu của `contexts` thắng, `defaultContext` bị bỏ qua | Không có trạng thái lỗi nào ở đây: một nguồn sự thật thì không thể lệch. `kf contexts` nêu ra để người dọn nếu muốn |
| Khai trùng nhau sau khi chuẩn hoá hoa thường, ví dụ `auth` và `Auth` | Coi là cấu hình sai | Config invalid |

## Postconditions
- `.kf/config.json` có `contexts` không rỗng và `defaultContext` thuộc danh sách đó.

## Business Rules
- `contexts` vắng mặt nghĩa là chế độ tự do như trước, không phải lỗi. Project cũ không bị phá.
- Khi `contexts` đã khai, phần tử đầu **là** mặc định. Không có trường thứ hai để giữ đồng bộ, nên không có cách nào tạo ra cấu hình tự chặn chính nó.
- Chỉ một câu hỏi về context trong toàn bộ onboarding, thay chứ không thêm.

## Data
- `.kf/config.json`: `contexts?: string[]`; `defaultContext` giữ lại chỉ để đọc project cũ

## Acceptance Criteria
- [ ] `kf init --defaults --context cli` ghi `contexts: ["cli"]`; không cờ thì không ghi `contexts` (TC-011)
- [ ] `kf init` trên TTY hỏi đúng một câu về context và nhận danh sách phân tách dấu phẩy (TC-011)
- [ ] `contexts` sai kiểu hoặc rỗng thì config invalid kèm tên trường (TC-003)
- [ ] Khi `contexts` đã khai, phần tử đầu là mặc định kể cả khi `defaultContext` mang giá trị khác (TC-004)
- [ ] Chạy lại `kf init --defaults` trên project cũ chưa khai `contexts` thì config không mọc thêm trường đó (TC-013)
- [ ] `kf autoconfig` có dòng checklist cho `contexts` (TC-012)

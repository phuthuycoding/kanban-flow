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
| ID | UC-003 |
| Name | Agent khảo sát repo rồi đề xuất danh sách context |
| Requirement reference | FR-004 |
| Goal | Có một danh sách context đề xuất dựa trên repo thật, để người chốt |
| Primary actor | Agent |

## Supporting Actors
- Đại ca, người chốt
- `kf contexts`, nơi phát ra bản brief

## Preconditions
- `contexts` chưa khai trong `.kf/config.json`.

## Trigger
Agent chạy `kf contexts`, thường sau khi `kf autoconfig` nhắc.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | Chạy `kf contexts` | Thấy `contexts` chưa khai |
| 2 | `kf contexts` | In bản brief khảo sát, kèm danh sách context đang dùng trên đĩa | Agent biết phải làm gì và đang có sẵn gì |
| 3 | Agent | Đọc thư mục nguồn cấp cao và các manifest | Có nguyên liệu |
| 4 | Agent | Nhóm theo miền nghiệp vụ, không theo tầng kỹ thuật | Có 3 tới 7 tên đề xuất |
| 5 | Agent | Trình danh sách cho đại ca | Chờ chốt |
| 6 | Đại ca | Chốt hoặc sửa | Danh sách cuối cùng |
| 7 | Agent | Ghi danh sách đã chốt vào `.kf/config.json` | UC-001 hoàn tất, UC-002 có cái để đối chiếu |

## Alternative Flows
### A1
- Trigger: Repo quá nhỏ, chỉ có một miền

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Đề xuất một tên duy nhất | Vẫn hợp lệ, về bước 5 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Agent định tự ghi config mà không hỏi | Brief nói thẳng phải trình cho người chốt trước | Đây là rào bằng lời trong prompt, công cụ không ép được. Nêu thẳng giới hạn này thay vì giả vờ có bảo đảm |
| Agent nhóm theo tầng kỹ thuật, ví dụ `frontend`, `backend`, `database` | Brief nói thẳng nhóm theo miền nghiệp vụ chứ không theo tầng | Danh sách theo tầng làm context mất hết tác dụng phân loại |

## Postconditions
- Có một danh sách đề xuất đã được người chốt, hoặc đại ca quyết định chưa khai vội.

## Business Rules
- Công cụ không tự đặt tên miền nghiệp vụ. Đặt tên là việc của người hiểu sản phẩm, không phải thứ đoán từ cấu trúc thư mục.
- Brief phải nêu số lượng mong muốn, vì danh sách quá dài thì tự nó mất tác dụng cảnh báo.

## Data
- Cấu trúc thư mục nguồn, các manifest, và `contextsInUse` đọc từ `.works/`

## Acceptance Criteria
- [ ] Khi chưa khai, `kf contexts` in brief có đủ ba ý: nhóm theo nghiệp vụ, đề xuất 3 tới 7 tên, và người chốt chứ agent không tự ghi (TC-008)
- [ ] Brief kèm danh sách context đang dùng trên đĩa (TC-008)

---
feature: "open-source-ready"
context: "cli"
created: "20260919_2340"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Người lạ đọc README và hiểu vấn đề trong 30 giây |
| Requirement reference | FR-004 |
| Goal | Người chưa biết gì hiểu ngay công cụ này chặn cái gì, và tin được vì nó không phóng đại |
| Primary actor | Người lạ ghé repo |

## Supporting Actors
- Không

## Preconditions
- Repo public, README là thứ đầu tiên hiện ra

## Trigger
Ai đó mở trang repo từ một đường dẫn hoặc kết quả tìm kiếm.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người lạ | Đọc đoạn mở đầu | Thấy vấn đề trước: agent báo đã test nhưng không ai kiểm chứng được |
| 2 | Người lạ | Đọc phần cơ chế | Hiểu gate là chương trình chặn, không phải lời dặn trong prompt |
| 3 | Người lạ | Đọc phần khác biệt | Thấy nêu đúng một cơ chế chưa tìm thấy ở đâu và nêu tổ hợp, không thấy câu "chưa ai làm X" cho những thứ đã có người làm |
| 4 | Người lạ | Đọc phần cài đặt | Một dòng, quyết định thử |

## Alternative Flows
### A1
- Trigger: Người đọc muốn biết chi tiết hơn

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | README trỏ sang `docs/workflow/` và nói rõ tài liệu chi tiết hiện bằng tiếng Việt | Người đọc không bị bất ngờ |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Người đọc là người hoài nghi, đi tìm xem lời tuyên bố có đúng không | Mọi khẳng định trong README đều chịu được một lần tìm kiếm vì đã lọc theo khảo sát | Không mất uy tín |

## Postconditions
- Người đọc hoặc thử, hoặc bỏ qua, nhưng không hiểu sai công cụ

## Business Rules
- Không tuyên bố "chưa ai làm" cho traceability gate, role→runner, hash-bound approval, cancelled kèm lý do, chặn placeholder
- Được nêu execution id là cơ chế không tìm thấy ở đâu, và nêu tổ hợp là khác biệt

## Data
- `README.md`

## Acceptance Criteria
- [ ] README tiếng Anh, dưới 120 dòng, mở bằng vấn đề (TC-005)
- [ ] Không chứa khẳng định "chưa ai làm" cho năm cơ chế đã có người làm (TC-006)

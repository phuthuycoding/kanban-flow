---
feature: "workflow-hardening"
context: "cli"
created: "20260919_1206"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Validator chặn report PASS có exit code khác 0 |
| Requirement reference | FR-006, FR-005 |
| Goal | Report testing `status: PASS` phải có bằng chứng lệnh với exit code 0; PASS mà không có lệnh hoặc exit code khác 0 bị chặn |
| Primary actor | Agent |

## Supporting Actors
- Người vận hành (đọc lỗi khi review)

## Preconditions
- Feature ở testing trở đi, có `phase-4-testing-result.md` với execution id hiện tại

## Trigger
`kf validate`, `kf stage <feature> review`, `kf archive`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Validator | Đọc frontmatter `status` | Chỉ tiếp tục khi `PASS` |
| 2 | Validator | Tìm heading `## Commands and Evidence`, lấy các dòng bảng sau header/separator | Danh sách dòng dữ liệu |
| 3 | Validator | Đọc cột thứ 2 (Exit code) từng dòng | Chuỗi đã trim |
| 4 | Validator | Nếu không có dòng nào, hoặc bất kỳ ô nào khác `0` | ERROR `testing_exit_code` với thông điệp nêu số dòng vi phạm |

## Alternative Flows
### A1
- Trigger: `status` là FAIL/REJECT/BLOCKED

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bỏ qua kiểm tra exit code | Các rule khác vẫn áp dụng |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Không tìm thấy heading (report tự viết khác template) | Coi như không có dòng lệnh | ERROR `testing_exit_code` khi PASS, thông điệp chỉ rõ cần bảng Commands and Evidence |

## Postconditions
- Report PASS luôn có ít nhất một lệnh đã chạy với exit code 0 được ghi lại

## Business Rules
- Chỉ đọc bảng dưới đúng heading; bảng ở section khác không tính
- Ô `N/A`, trống, hay giá trị không phải số đều là vi phạm khi PASS
- Rule này không chứng minh test đã chạy; nó chỉ chặn report thiếu bằng chứng

## Data
- `phase-4-testing-result.md` bảng `| Command / tool | Exit code | Evidence / output |`

## Acceptance Criteria
- [ ] Sáu tình huống trong TC-010 cho kết quả đúng

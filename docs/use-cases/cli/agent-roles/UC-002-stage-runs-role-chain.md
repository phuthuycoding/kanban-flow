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
| ID | UC-002 |
| Name | Một stage chạy chuỗi role, bước sau nhận kết quả bước trước |
| Requirement reference | FR-003, FR-004, FR-006 |
| Goal | Brainstorm chạy researcher khảo sát chiều rộng rồi writer viết spec, mỗi vai dùng đúng model mạnh việc đó |
| Primary actor | Main agent |

## Supporting Actors
- Worker agent cho từng role

## Preconditions
- Stage hiện tại có chuỗi role; runner của mỗi role có CLI trên PATH và skill đã cài

## Trigger
Main chạy `kf run <feature>` khi `kf status` cho thấy stage có role được gán.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Giải chuỗi role của stage thành danh sách assignment | Mỗi phần tử có role, runner, skill path |
| 2 | kf | Chạy role đầu: prompt mang vai + brief + yêu cầu ghi `output` nếu có | Worker 1 viết `research.md` |
| 3 | kf | Ghi run của role đầu vào `runs[]`, nhận `STATUS: DONE` | Bước đầu xong |
| 4 | kf | Chạy role sau với prompt thêm mục "Previous step": role trước, file output, đường dẫn log | Worker 2 đọc kết quả rồi viết spec |
| 5 | kf | Ghi run thứ hai, in tổng kết cả chuỗi | Main thấy từng bước |
| 6 | Main | `kf validate` rồi quyết chuyển stage | Gate quyết định, không phải lời khai worker |

## Alternative Flows
### A1
- Trigger: `--role writer`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Chỉ chạy role đó, không chạy phần còn lại của chuỗi | Kết thúc sau bước 5 |

### A2
- Trigger: `--dry-run`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | In kế hoạch cả chuỗi (mỗi role một khối argv + prompt), không chạy | Kết thúc |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Skill của runner chưa cài | exit 1 nêu role và runner, gợi ý `kf install --agent <runner>` | Không tạo run |
| Role có `output` nhưng worker không tạo file | Ghi `warning` trong run, không tự fail nếu STATUS DONE | Gate artifact của stage vẫn chặn nếu thiếu |

## Postconditions
- `runs[]` có một bản ghi cho mỗi role đã chạy; artifact và file output nằm trong feature dir

## Business Rules
- Chuỗi luôn tuần tự, không song song
- Kết quả truyền qua file trên đĩa, không qua bộ nhớ hội thoại

## Data
- `roles.<role>.output`, `runs[].role`, `runs[].runner`, `runs/<id>.log`

## Acceptance Criteria
- [ ] Chuỗi hai role chạy đúng thứ tự, prompt bước sau có role trước + output + log (TC-004, TC-008)
- [ ] Prompt mang vai và brief; role có `output` được yêu cầu ghi đúng file (TC-005)
- [ ] Thiếu skill nêu cả role và runner (TC-009)

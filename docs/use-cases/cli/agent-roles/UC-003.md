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
| ID | UC-003 |
| Name | Một role không DONE thì dừng chuỗi |
| Requirement reference | FR-003 |
| Goal | Không để worker sau chạy trên kết quả dở dang của worker trước, và không đốt token vô ích |
| Primary actor | Main agent |

## Supporting Actors
- Worker agent của role bị dừng

## Preconditions
- Stage có chuỗi từ hai role trở lên

## Trigger
`kf run <feature>` khi một role trong chuỗi kết thúc không thành công.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Chạy role đầu, nhận `STATUS: BLOCKED` (hoặc exit khác 0, thiếu STATUS, timeout) | Outcome không ok |
| 2 | kf | Dừng chuỗi, không spawn role sau | Không tốn token bước sau |
| 3 | kf | In role nào xong, role nào bị bỏ, exit 1 | Main biết dừng ở đâu |
| 4 | Main | Đọc log, xử lý hoặc hỏi người | Theo contract của skill |

## Alternative Flows
### A1
- Trigger: Role đầu trả `DONE_WITH_CONCERNS`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Coi là thành công, chuỗi tiếp tục; concern hiển thị trong tổng kết | Về bước 4 của UC-002 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Role đầu timeout | Kill process group, run `timeout`, dừng chuỗi | Như bước 2-3 |

## Postconditions
- `runs[]` chỉ có bản ghi của các role đã thực sự chạy

## Business Rules
- Chỉ `DONE` và `DONE_WITH_CONCERNS` cho phép đi tiếp
- Không tự retry role đã fail

## Data
- `runs[].status`, `runs[].statusLine`

## Acceptance Criteria
- [ ] Role đầu BLOCKED thì role sau không có file argv, exit 1 nêu role dừng (TC-008)
- [ ] `--agent` bị bỏ, báo lỗi chỉ sang `--role` (TC-010)

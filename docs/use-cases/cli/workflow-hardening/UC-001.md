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
| ID | UC-001 |
| Name | Agent đọc briefing autoconfig và chạy lệnh trong guide |
| Requirement reference | FR-001 |
| Goal | Agent mới vào project chạy được lệnh `kf` ngay từ briefing mà không phải đoán cú pháp |
| Primary actor | Agent |

## Supporting Actors
- Người vận hành (đã chạy `kf init`, có thể đã chỉnh `stacks` trong config)

## Preconditions
- `kf` trên PATH; project có hoặc chưa có `.kf/config.json`

## Trigger
Agent (hoặc người) chạy `kf autoconfig`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | Chạy `kf autoconfig` | stdout gồm context, checklist, rules, workflow guide |
| 2 | CLI | Sinh mục "Commands the agent will use" từ help đã đăng ký trong `args.ts` | Mỗi dòng khớp cú pháp `parseArgsCli` chấp nhận |
| 3 | CLI | Lấy stacks từ `config.stacks` nếu có, ngược lại auto-detect | "Detected stacks" phản ánh cấu hình người dùng |
| 4 | Agent | Chạy lệnh trong guide, ví dụ `kf stage <feature> <stage>` | Lệnh chạy, không báo unknown option |

## Alternative Flows
### A1
- Trigger: Config có `stacks` rỗng hoặc không có

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | CLI auto-detect từ manifest | Về bước 3 với kết quả detect |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Không có `.works/` | Briefing vẫn in, checklist đánh dấu thiếu config kèm lệnh `kf init --defaults` | Agent biết bước đầu tiên |

## Postconditions
- Agent có tập lệnh đúng cú pháp để đi qua pipeline

## Business Rules
- Guide không được chứa cú pháp viết tay lệch với `args.ts`; nguồn sự thật duy nhất là help string

## Data
- `.kf/config.json`: `stacks[]` ưu tiên hơn auto-detect

## Acceptance Criteria
- [ ] Mọi dòng `kf ...` trong guide parse được (TC-001)
- [ ] Stacks trong briefing lấy từ config khi có (TC-002)

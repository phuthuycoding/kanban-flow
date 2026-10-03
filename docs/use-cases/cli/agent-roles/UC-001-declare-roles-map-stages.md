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
| ID | UC-001 |
| Name | Khai báo roles, gán stage → role, kiểm tra bằng `kf harness` |
| Requirement reference | FR-001, FR-002, FR-007, FR-008 |
| Goal | Người vận hành mô tả quy trình bằng vai trò, không bằng tên hãng, và thấy ngay ba lớp có hợp lệ không |
| Primary actor | Người vận hành |

## Supporting Actors
- `kf init` (seed 6 role mặc định)

## Preconditions
- Project đã `kf init`; các CLI cần dùng đã cài

## Trigger
Chạy `kf init` lần đầu hoặc sửa `.kf/config.json`, rồi chạy `kf harness`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | `kf init` | Seed `roles` gồm architect, researcher, writer, coder, tester, reviewer, tất cả trỏ runner mặc định, `main: architect`, `stages` rỗng | Có khung sẵn để sửa |
| 2 | Người vận hành | Đổi `roles.writer.runner` thành `gemini`, `roles.researcher.runner` thành `codex` | Vai gắn với thế mạnh |
| 3 | Người vận hành | Gán `stages: { brainstorm: ["researcher", "writer"], implementation: "coder" }` | Quy trình mô tả bằng vai |
| 4 | `kf harness` | In ba bảng: stage → chuỗi role, role → runner + brief + output, runner → CLI/PATH/resume/session | Thấy ngay chỗ nào thiếu CLI |

## Alternative Flows
### A1
- Trigger: Role khai báo dạng ngắn `"coder": "claude-opus"`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Chuẩn hoá thành `{ runner: "claude-opus" }` | Về bước 4 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Role trỏ runner không tồn tại, `output` chứa `..`, `main` không phải role, chuỗi rỗng hoặc trùng role | `readProjectConfig` throw nêu đúng field | Mọi lệnh dừng với lỗi rõ, không fallback |

## Postconditions
- `kf run` dùng được; `kf status` biết stage nào thuộc role nào

## Business Rules
- `main` là role, không phải runner
- Stage `backlog` không gán được

## Data
- `.kf/config.json` → `harness.{main, roles, stages, runners}`

## Acceptance Criteria
- [ ] Các biến thể config sai bị từ chối nêu field (TC-001)
- [ ] `kf init` seed 6 role, không ghi đè (TC-002)
- [ ] `kf harness` in đủ ba bảng (TC-011)

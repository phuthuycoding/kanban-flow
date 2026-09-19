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
| ID | UC-006 |
| Name | `kf init` seed AGENTS.md, giữ nguyên file đã có |
| Requirement reference | FR-007 |
| Goal | Project mới có ngay `AGENTS.md` với build/test/lint commands và quy ước workflow, không cần thêm bước onboarding thủ công |
| Primary actor | Người vận hành |

## Supporting Actors
- Agent (đọc `AGENTS.md` sau đó)

## Preconditions
- Chạy `kf init` (onboarding hoặc `--minimal`) trong một thư mục

## Trigger
`kf init`, `kf init --defaults`, `kf init --minimal`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | CLI | Kiểm tra `AGENTS.md` và `CLAUDE.md` ở root | Không có cả hai → tiếp |
| 2 | CLI | Với stack node: đọc `package.json` scripts `build`, `test`, `lint`, `typecheck` | Bảng lệnh `npm run <script>` |
| 3 | CLI | Ghi `AGENTS.md`: bảng commands, mục workflow (`kanban {context} {feature}`, hai human gate, không `mv` folder), pointer `kf autoconfig` | File tồn tại |
| 4 | CLI | In dòng `AGENTS.md: created` trong output init | Người vận hành biết |

## Alternative Flows
### A1
- Trigger: Stack không phải node hoặc không detect được

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bảng commands để trống kèm chỉ dẫn điền | Về bước 3 |

### A2
- Trigger: `AGENTS.md` hoặc `CLAUDE.md` đã tồn tại

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Không ghi gì; output in `AGENTS.md: kept existing` | Kết thúc |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `package.json` không parse được | Lỗi nổi lên với đường dẫn file | `kf init` exit 1 |

## Postconditions
- Checklist `kf autoconfig` đánh dấu mục AGENTS.md là done cho project mới

## Business Rules
- Không bao giờ ghi đè file hướng dẫn agent đã có
- Nội dung seed ngắn, không lặp lại README

## Data
- `AGENTS.md` tại project root

## Acceptance Criteria
- [ ] Bốn tình huống trong TC-011 đúng

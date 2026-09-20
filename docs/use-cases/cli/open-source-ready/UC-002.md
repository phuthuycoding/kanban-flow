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
| ID | UC-002 |
| Name | Cài một dòng và chạy được ngay |
| Requirement reference | FR-005 |
| Goal | Khoảng cách từ "muốn thử" tới "đang chạy" là một lệnh |
| Primary actor | Người dùng thử |

## Supporting Actors
- npm registry

## Preconditions
- Gói đã publish (hoặc người dùng cài từ mã nguồn)

## Trigger
Người dùng quyết định thử sau khi đọc README.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người dùng | `npm install -g kanban-flow` | `kf` có trên PATH |
| 2 | Người dùng | `cd` vào project của mình, chạy `kf init` | `.works/`, `.kf/`, skills, AGENTS.md |
| 3 | Người dùng | Chạy ví dụ trong README | Thấy gate chặn thật |

## Alternative Flows
### A1
- Trigger: Người dùng muốn sửa mã

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | README vẫn giữ hướng dẫn clone, build, npm link | Về bước 2 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Gói chưa publish | README ghi rõ trạng thái và đường cài từ mã nguồn | Không ai bị kẹt ở lệnh không chạy |

## Postconditions
- Người dùng có `kf` chạy được trong project của họ

## Business Rules
- Đường cài chính là npm; đường từ mã nguồn là phụ
- Không còn câu "repo private nên dùng git clone"

## Data
- `README.md`, `package.json`

## Acceptance Criteria
- [ ] README có mục cài một dòng và không còn câu repo private (TC-005)

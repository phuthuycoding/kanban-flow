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
| ID | UC-007 |
| Name | Người vận hành đọc CHANGELOG và version mới |
| Requirement reference | FR-008 |
| Goal | Người nhận repo biết bản này có gì, đang ở version nào, và giới hạn nền tảng (hooks cần bash) |
| Primary actor | Người vận hành |

## Supporting Actors
- Người dùng khác nhận repo qua git clone

## Preconditions
- Branch feature đã implement xong

## Trigger
Mở repo, đọc `CHANGELOG.md`, chạy `kf --version`, đọc README.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người vận hành | Đọc `CHANGELOG.md` | Mục `## [Unreleased]` liệt kê thay đổi của feature này và các thay đổi chưa release trên `main` |
| 2 | Người vận hành | Chạy `kf --version` | `0.2.0` |
| 3 | Người vận hành | Đọc mục Phase hooks trong README | Ghi chú hooks chạy bằng `bash`; Windows dùng WSL/Git Bash |
| 4 | Người vận hành | Đọc `BACKLOG.md` | Các mục đã xong được đánh dấu, mục còn lại giữ nguyên |

## Alternative Flows
### A1
- Trigger: Đại ca đổi ý về số version sau khi đã approve

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Quay về planning, sửa contract, approve lại | Về bước 2 với số mới |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `dist/` cũ chưa build lại | `kf --version` in số cũ | Ghi trong README: sau `git pull` chạy `npm run build` |

## Postconditions
- Repo có lịch sử thay đổi đọc được và version phản ánh bản TypeScript rewrite

## Business Rules
- CHANGELOG theo Keep a Changelog; không ghi trailer/credit AI
- Không đổi ngôn ngữ README trong scope này

## Data
- `CHANGELOG.md`, `package.json` (`version`), `README.md`, `BACKLOG.md`

## Acceptance Criteria
- [ ] Ba bước kiểm tra trong TC-012 đúng

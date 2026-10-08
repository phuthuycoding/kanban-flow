---
feature: "worktree-domains"
context: "cli"
created: "20261007_2023"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-006 |
| Name | Resume/re-enter implementation tái dùng worktree |
| Requirement reference | FR-001, FR-002 |
| Goal | Quay lại implementation (FAIL loop, reopen cancelled, session mới) không bao giờ tạo worktree trùng hoặc mất code đang có |
| Primary actor | Agent |

## Supporting Actors
- `git`, routes file

## Preconditions
- Item đã có worktree trong `.kfw.json` (path, branch, domain, port)

## Trigger
`kf stage <f> implementation` một lần nữa (FAIL loop, reopen) hoặc `kf worktree create <f>` thủ công.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | `kf stage <f> implementation` hoặc `kf worktree create <f>` | kf đọc registry item |
| 2 | kf | Thấy `worktree` field + path tồn tại + `git worktree list` xác nhận | Bỏ qua tạo mới |
| 3 | kf | Đảm bảo route còn trong routes file (ghi lại nếu mất) | Domain hoạt động lại |
| 4 | kf | Transition tiếp / trả về thông tin hiện có | Cùng path/domain/port như trước |

## Alternative Flows
### A1
- Trigger: Registry trỏ path nhưng worktree đã bị `rm -rf` tay

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `git worktree prune` + tạo lại worktree cùng path, giữ branch `kf/<f>` nếu còn | Worktree mới sạch từ branch cũ; route/registry refresh |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Branch `kf/<f>` tồn tại nhưng item chưa có registry (tạo tay trước đây) | Báo lỗi rõ "branch exists, not managed"; hint `git worktree add <path> kf/<f>` hoặc đổi branchPrefix | Không âm thầm checkout branch cũ |
| Port trong registry đã bị route khác chiếm | Cấp port mới, cập nhật registry + route | Không đục port của item khác |

## Postconditions
- Đúng một worktree per item; code cũ trong worktree/branch được giữ
- `kf status` luôn in cùng domain/port sau khi reuse

## Business Rules
- Idempotent là contract cứng: create × N = một worktree
- Không bao giờ `git worktree remove` trong luồng create

## Data
- `.kfw.json` `worktree` field là nguồn đúng; `git worktree list --porcelain` là ground truth kiểm chứng

## Acceptance Criteria
- [ ] Re-enter implementation giữ nguyên path/domain/port (TC-015)
- [ ] Worktree bị xoá tay → create tạo lại sạch từ branch cũ (TC-015)
- [ ] Branch tồn tại ngoài registry → lỗi rõ, không silent reuse (TC-015)

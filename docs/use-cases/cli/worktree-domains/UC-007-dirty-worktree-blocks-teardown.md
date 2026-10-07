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
| ID | UC-007 |
| Name | Worktree dirty khi archive: từ chối và hướng dẫn |
| Requirement reference | FR-007 |
| Goal | Không bao giờ mất code chưa commit của agent vì teardown; người/agent luôn có đường thoát rõ ràng |
| Primary actor | Agent |

## Supporting Actors
- `git worktree remove` (từ chối dirty mặc định)

## Preconditions
- Item có worktree với file đã sửa chưa commit hoặc untracked

## Trigger
`kf archive <f>` hoặc `kf cancel <f>` trên item có worktree dirty; hoặc `kf worktree remove <f>` thủ công.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | `kf archive <f>` | kf check dirty trước khi teardown |
| 2 | kf | Phát hiện dirty (`git -C <wt> status --porcelain` không rỗng) | TỪ CHỐI archive |
| 3 | kf | In message: danh sách tóm tắt dirty + 2 lựa chọn (commit trong worktree / `kf worktree remove <f> --force`) | Item giữ nguyên stage, không mất gì |
| 4 | Agent | Commit code trong worktree rồi archive lại | Archive thành công theo UC-004 |

## Alternative Flows
### A1
- Trigger: Agent cố tình bỏ code (thử nghiệm hỏng)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf worktree remove <f> --force` → `git worktree remove --force` + gỡ route + registry | Worktree mất, branch `kf/<f>` vẫn còn với commit đã có |
| A1.2 | `kf archive <f>` lại | Đi qua vì không còn worktree |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| `git status` trong worktree lỗi (dir corrupt) | Coi như "unknown state" → từ chối, message hướng `remove --force` | An toàn hơn là xoá mù |
| `--force` trên worktree có commit chưa merge + dirty | Vẫn gỡ worktree (git giữ branch); in nhắc branch còn | Người biết branch cứu được |

## Postconditions
- Không có uncommitted change nào bị xoá mà không có `--force` tường minh của người/agent
- Item không đổi stage khi bị từ chối

## Business Rules
- Dirty check là gate RIÊNG của teardown, không phải artifact gate — không đi qua `--force` của `kf stage`/`archive`
- `--force` chỉ tồn tại trên `kf worktree remove`, không trên archive/cancel

## Data
- `git -C <wt> status --porcelain` output là nguồn đúng

## Acceptance Criteria
- [ ] Archive trên worktree dirty → exit 1, item không đổi stage, message nêu 2 đường (TC-017)
- [ ] `kf worktree remove --force` gỡ được dirty worktree + route (TC-017)
- [ ] Cancel trên worktree dirty cũng từ chối tương tự (TC-018)

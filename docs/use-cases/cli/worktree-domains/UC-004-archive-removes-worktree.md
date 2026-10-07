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
| ID | UC-004 |
| Name | Archive: gỡ worktree, giữ branch, cảnh báo unmerged |
| Requirement reference | FR-007 |
| Goal | Khi work item đóng, môi trường worktree được dọn sạch nhưng công sức trên branch không mất |
| Primary actor | Agent |

## Supporting Actors
- `git` (worktree remove, rev-list), routes file writer

## Preconditions
- Item ở review với PASS; worktree tồn tại và sạch (không uncommitted/untracked)
- Reviewer đã review diff của `kf/<feature>`

## Trigger
`kf archive <feature>`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | `kf archive <f>` | kf kiểm gate archive như hiện tại |
| 2 | kf | `git worktree remove <path>` | Worktree gỡ (sạch → git cho phép) |
| 3 | kf | Xoá route `<f>.<baseDomain>` khỏi routes file | Domain ngừng phục vụ |
| 4 | kf | Kiểm `git rev-list <base>..kf/<f>` | Nếu có commit chưa merge → in cảnh báo "branch has unmerged commits — merge/PR thủ công" |
| 5 | kf | Xoá field `worktree` trong `.kfw.json`, move sang dones, sync docs | Item đóng, branch `kf/<f>` còn nguyên |

## Alternative Flows
### A1
- Trigger: `kf cancel <f>` thay vì archive

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Cùng bước 2-3, giữ branch không cảnh báo (có thể reopen) | Item về cancelled, worktree đã gỡ |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Worktree dirty | Từ chối archive; message hướng dẫn commit trong worktree hoặc `kf worktree remove --force` | Item giữ stage, không mất code |
| Worktree đã bị xoá tay | Bỏ qua git remove, chỉ gỡ route + registry | Archive tiếp tục |
| Item không có worktree | Không đổi hành vi archive hiện tại | Không no-op error |

## Postconditions
- Worktree và route không còn; branch `kf/<feature>` nguyên vẹn chờ người merge/PR
- Registry `.kfw.json` không còn trỏ worktree chết

## Business Rules
- `kf` không bao giờ xoá branch, không tạo PR, không merge — git history của người
- Cảnh báo unmerged in ra stdout của archive, không chặn archive

## Data
- `git worktree list`, `git rev-list --count`; routes file trừ một entry

## Acceptance Criteria
- [ ] Archive worktree sạch: dir + route biến mất, branch còn, warn unmerged khi đúng (TC-016)
- [ ] Cancel cũng teardown tương tự (TC-018)
- [ ] Item không worktree → archive giữ nguyên hành vi cũ (TC-016)

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
| ID | UC-008 |
| Name | Liệt kê worktree và phát hiện orphan |
| Requirement reference | FR-008 |
| Goal | Người nhìn một lượt mọi worktree `kf` đang quản và phát hiện tài nguyên mồ côi để dọn |
| Primary actor | Người vận hành |

## Supporting Actors
- `git worktree list --porcelain`, routes file, `.kfw.json` scan

## Preconditions
- Repo có `.works/` và đã từng tạo worktree

## Trigger
`kf worktree list` (hoặc `--json`).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người | `kf worktree list` | kf quét `.works/*/*/.kfw.json` lấy registry |
| 2 | kf | Join với `git worktree list --porcelain` + routes file | Bảng: item, stage, path, domain, port, branch, dirty? |
| 3 | kf | Phát hiện orphan hai chiều: registry không có worktree thật; worktree `kf/*` không có item | In mục "orphans" rõ ràng |
| 4 | Người | Quyết định dọn tay | `kf worktree remove` / `git worktree remove` |

## Alternative Flows
### A1
- Trigger: `--json`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | In JSON `{ items: [...], orphans: [...] }` | Cho tooling/agent đọc |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Không có worktree nào | In "no worktrees" rõ ràng, exit 0 | Không lỗi giả |
| `git worktree list` fail (non-git repo) | Chỉ in phần registry, note git unavailable | Báo cáo phần có được |

## Postconditions
- Người có bức tranh đầy đủ tài nguyên worktree; orphan không âm thầm tồn tại

## Business Rules
- List là read-only; không tự dọn orphan — quyết định huỷ là của người
- Orphan definition: (a) path trong registry không còn trong `git worktree list`, (b) worktree với branch `kf/<x>` không có item `.works` tương ứng, (c) route trỏ item đã đi dones

## Data
- Registry `.kfw.json[].worktree`, `git worktree list --porcelain`, routes file

## Acceptance Criteria
- [ ] List in đủ item có worktree kèm stage/path/domain/port (TC-020)
- [ ] Ba loại orphan đều được báo (TC-020)
- [ ] `--json` parse được (TC-020)

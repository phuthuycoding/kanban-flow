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
| ID | UC-002 |
| Name | Vào implementation tự có worktree + domain |
| Requirement reference | FR-001, FR-002 |
| Goal | Khi work item được duyệt vào implementation, môi trường code tách biệt sẵn sàng mà agent không phải làm gì thêm |
| Primary actor | Agent |

## Supporting Actors
- `git` (worktree add), routes file writer

## Preconditions
- Item ở `planning`/`backlog` đã approved; `.kf/config.json` có `worktree.enabled !== false`
- Repo là git repo; branch `kf/<feature>` chưa tồn tại

## Trigger
`kf stage <feature> implementation` (sau quyết định start của người).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | `kf stage <f> implementation` | kf bắt đầu transition |
| 2 | kf | `git worktree add <baseDir>/<f> -b kf/<f>` từ HEAD | Worktree mới, branch `kf/<f>` |
| 3 | kf | Cấp port đầu tiên trống từ `portBase` (quét registry + routes file) | Port duy nhất trên máy |
| 4 | kf | Ghi route `<f>.<baseDomain>` → `127.0.0.1:<port>` vào routes file | Domain sẵn sàng phục vụ khi dev server chạy |
| 5 | kf | Lưu `{path, branch, domain, port}` vào `.kfw.json` của item | Registry đầy đủ |
| 6 | kf | Hoàn tất move folder sang implementation | `kf status` in path/domain/port cho agent |

## Alternative Flows
### A1
- Trigger: Item đã có worktree (resume, re-enter)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bỏ qua bước 2-4, tái dùng registry hiện có | Về bước 6 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Không phải git repo / `git worktree` fail / branch đã tồn tại | Transition THẤT BẠI, item không rời stage; message nêu rõ cause + hint `worktree.enabled: false` | Không cho implement trên checkout chính |
| Không còn port trống trong range | Báo lỗi "port range exhausted" | Item giữ nguyên stage |

## Postconditions
- Worktree tồn tại tại `<baseDir>/<f>`, branch `kf/<f>`, route đăng ký, registry trong `.kfw.json`
- Agent biết path + `http://<domain>` + `localhost:<port>` qua `kf status`

## Business Rules
- Một item chỉ một worktree; idempotent khi gọi lại
- `baseDir` mặc định `<repo>-worktrees/` ngang hàng repo — không nằm trong `.works/`, không pollute git status

## Data
- `.kfw.json` item: `worktree: { path, branch, domain, port, createdAt }`
- `~/.config/kanban-flow/proxy-routes.json`: `{ "<f>.<baseDomain>": { "port": n, "repo": "...", "item": "..." } }`

## Acceptance Criteria
- [ ] Transition sinh worktree + branch + route + registry đủ 4 phần (TC-013)
- [ ] Gọi lại `kf worktree create` trên item đã có → cùng thông tin, không trùng (TC-003, TC-013)
- [ ] Git repo hỏng/non-git → transition fail, stage không đổi (TC-014)
- [ ] Port cấp không trùng route đang tồn tại trong routes file (TC-003)

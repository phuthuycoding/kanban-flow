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
| ID | UC-003 |
| Name | Agent code và tự test qua domain trong worktree |
| Requirement reference | FR-003, FR-004, FR-009 |
| Goal | Agent làm việc hoàn toàn trong worktree: `kf` vẫn hiểu project, dev server được expose qua domain ổn định để tự test |
| Primary actor | Agent |

## Supporting Actors
- `kf proxy serve` (đang chạy)
- App dev server trong worktree (do agent khởi động)

## Preconditions
- UC-002 đã xong: worktree + route tồn tại
- Hạ tầng domain đã setup (UC-001)

## Trigger
Agent `cd` vào worktree path và bắt đầu implement; khi cần test UI/API, chạy dev server trên port được cấp và hit `http://<domain>`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | `cd <worktree path>`; chạy `kf status --change <f>` | `findWorksRoot` fallback qua `git --git-common-dir` → main checkout `.works/`; status hiển thị đúng item |
| 2 | Agent | Code, commit lên `kf/<feature>` | Thay đổi cách ly khỏi checkout chính |
| 3 | Agent | Chạy dev server trên `<port>` được cấp | App listen `127.0.0.1:<port>` |
| 4 | Agent | `curl http://<f>.<baseDomain>/` hoặc Playwright | kf proxy đọc Host → route → forward tới port, response trả về |
| 5 | kf proxy | Websocket upgrade (HMR) forward nguyên vẹn | Live reload hoạt động |
| 6 | Agent | `kf` commands khác (stage, instruct…) từ trong worktree | Hoạt động như ở checkout chính |

## Alternative Flows
### A1
- Trigger: App dev server chưa chạy / chết

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Proxy trả 502 body liệt kê route + port | Agent biết cần start server; `localhost:<port>` vẫn là fallback trực tiếp |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Host không có route và `fallbackUpstream` set | Forward nguyên request về upstream (Valet trong giai đoạn sống chung), kèm `X-Forwarded-By` | Site cũ phục vụ bình thường |
| `fallbackUpstream: null` hoặc upstream loop về chính proxy | 502 kèm danh sách routes | Không loop vô hạn |
| Routes file bị sửa tay ngoài kf | Proxy nhận mtime mới, reload | Route mới có hiệu lực không cần restart |

## Postconditions
- Code nằm trên branch `kf/<feature>` trong worktree; artifact `.works/` ghi ở checkout chính
- Agent tự test được qua domain; kết quả đưa vào testing report

## Business Rules
- `kf` resolve main root chỉ khi upward search `.works/` fail VÀ cwd nằm trong git worktree có common-dir trỏ repo chứa `.works/`
- Proxy không rewrite path/header ngoài `Host`/`X-Forwarded-*` chuẩn

## Data
- Routes file: Host → `{port, repo, item}`; đọc mỗi request hoặc cache theo mtime

## Acceptance Criteria
- [ ] `kf status` trong worktree trả đúng item + worktree info (TC-005, TC-021, TC-022)
- [ ] Request Host đúng forward tới port (TC-006); unknown host fallback/502 (TC-007)
- [ ] Routes file sửa ngoài process có hiệu lực không restart (TC-008)
- [ ] Websocket upgrade forward được (TC-009); self-forward bị chặn (TC-010)

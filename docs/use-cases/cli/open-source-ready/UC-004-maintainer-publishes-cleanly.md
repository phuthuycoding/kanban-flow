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
| ID | UC-004 |
| Name | Maintainer publish khi muốn, không phải sửa thêm |
| Requirement reference | FR-003, FR-006, FR-007 |
| Goal | Mọi thứ cần cho `npm publish` đã sẵn; lệnh publish là việc của người, không phải của agent |
| Primary actor | Đại ca (maintainer) |

## Supporting Actors
- npm registry

## Preconditions
- Đã đăng nhập npm

## Trigger
Maintainer quyết định phát hành.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Maintainer | `npm pack --dry-run` | Danh sách đúng: dist, skills, docs, templates, review rules, README, LICENSE |
| 2 | Maintainer | Kiểm tên và phiên bản | `kanban-flow`, `0.3.0` |
| 3 | Maintainer | `npm publish` | Gói lên registry |
| 4 | Người dùng | `npm install -g kanban-flow` | Chạy được |

## Alternative Flows
### A1
- Trigger: Maintainer đổi tên repo GitHub

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Cập nhật `repository`, `homepage`, `bugs` cho khớp | Về bước 1 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Gói lọt `.works/` hoặc `.kf/` | `files` là whitelist; acceptance kiểm bằng `npm pack --dry-run` | Nhật ký nội bộ không lên registry |
| Tên gói bị người khác lấy trước | Kiểm lại khi publish; cả hai tên còn trống tính tới 2026-09-19 | Chọn lại tên, sửa một chỗ trong package.json |

## Postconditions
- Gói phát hành được bất cứ lúc nào mà không phải sửa thêm

## Business Rules
- Agent không chạy `npm publish`; đó là hành động ra ngoài, thuộc quyền người
- Binary vẫn là `kf`; thư mục dữ liệu `.kf`/`.works` không đổi nên project hiện có vẫn chạy

## Data
- `package.json`, `LICENSE`, `CHANGELOG.md`, `BACKLOG.md`

## Acceptance Criteria
- [ ] Metadata và LICENSE đủ (TC-004)
- [ ] `npm pack --dry-run` đúng và không thừa (TC-007)
- [ ] Tên gói, phiên bản, docs khớp; không còn chuỗi `kaban` (TC-008)

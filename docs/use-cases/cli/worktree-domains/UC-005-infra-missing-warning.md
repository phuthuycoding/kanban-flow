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
| ID | UC-005 |
| Name | Hạ tầng chưa setup: doctor/validate cảnh báo |
| Requirement reference | FR-006 |
| Goal | Người/agent biết ngay khi máy chưa onboard domain infra, với lệnh chính xác để fix — không lỗi chung chung |
| Primary actor | Người vận hành |

## Supporting Actors
- `kf doctor`, `kf validate`

## Preconditions
- `.kf/config.json` có `worktree.enabled: true` (mặc định)
- Máy chưa chạy `kf worktree setup` (hoặc proxy chết)

## Trigger
`kf doctor` hoặc `kf validate` (bất kỳ transition nào chạy validate).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người/Agent | `kf validate --change <f>` | Validator chạy artifact + directional gate như cũ |
| 2 | kf | Probe: DNS `<probe>.<zone>` resolve? TCP `<loopback>:80` listen? Routes file đọc được? | Phát hiện thiếu |
| 3 | kf | Phát WARNING `worktree_infra_missing` kèm hint `kf worktree setup` | Report in ra, exit code không đổi (warning, không error) |
| 4 | Người | `kf doctor` | Mục worktree infra liệt kê từng probe pass/fail + fix hint |

## Alternative Flows
### A1
- Trigger: `worktree.enabled: false`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bỏ qua mọi probe | Không warning, không check |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Probe DNS timeout / không có mạng | Đếm là "chưa setup" với note "probe failed" | WARNING chứ không ERROR; không làm hỏng gate |
| Routes file corrupt JSON | Probe báo file lỗi riêng biệt với DNS/proxy | Người biết xoá/sửa file |

## Postconditions
- Người dùng biết chính xác bước thiếu; agent không bị chặn nhầm vì gate vẫn fail-open ở tầng warning

## Business Rules
- Infra probe là WARNING duy nhất, không bao giờ ERROR — môi trường mạng không nằm trong artifact contract
- Probe có ngân sách thời gian nhỏ (<=1s mỗi check) để không làm chậm validate

## Data
- `~/.config/kanban-flow/config.json`: `proxyListen`, `domainZone` làm đầu vào probe

## Acceptance Criteria
- [ ] `worktree.enabled` + infra thiếu → WARNING `worktree_infra_missing` + hint (TC-019)
- [ ] `worktree.enabled: false` → không probe, không warning (TC-019)
- [ ] `kf doctor` liệt kê từng probe riêng (TC-019)

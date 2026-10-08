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
| ID | UC-001 |
| Name | Onboard hạ tầng domain lần đầu |
| Requirement reference | FR-005 |
| Goal | Người vận hành cài wildcard DNS + kf proxy daemon một lần để mọi worktree sau đó có domain tự động |
| Primary actor | Người vận hành |

## Supporting Actors
- `kf proxy serve` (daemon sẽ được cài)
- dnsmasq, launchd (hệ thống)

## Preconditions
- macOS có homebrew; dnsmasq đã cài hoặc setup in hướng dẫn cài
- `kf` trên PATH; người chạy có quyền sudo

## Trigger
Người vận hành chạy `sudo kf worktree setup` (hoặc `kf worktree setup --print` trước để xem).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Người | `kf worktree setup --print` | In toàn bộ lệnh sẽ chạy (dnsmasq conf, resolver, plist, kickstart), không ghi gì |
| 2 | Người | `sudo kf worktree setup` | kf ghi `address=/<zone>/<loopback>` vào dnsmasq.d, tạo `/etc/resolver/<zone>` khi thiếu, cài LaunchDaemon `kf proxy serve` trên `<loopback>:80` |
| 3 | kf | Reload dnsmasq + kickstart daemon | Proxy listen, wildcard `*.<zone>` resolve về `<loopback>` |
| 4 | kf | Tự verify: probe DNS + TCP connect | In "domain infra ready" hoặc bước còn thiếu |
| 5 | Người | `kf doctor` | Mục worktree infra xanh |

## Alternative Flows
### A1
- Trigger: Zone TLD đã có `/etc/resolver/<zone>` sẵn (vd `.test` của Valet)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bỏ qua tạo resolver | Resolver hiện hữu đã trỏ dnsmasq 127.0.0.1, cover luôn zone; về bước 3 |

### A2
- Trigger: Platform không phải macOS

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | In hướng dẫn manual (dnsmasq/systemd tương đương) | Không tự cài; exit 0 với hướng dẫn |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| dnsmasq.d có rule cùng zone trỏ IP khác (Valet cũ) | Từ chối ghi, in file gây xung đột + lệnh gỡ | Không đè conf; exit 1 |
| Chạy setup không sudo | Phát hiện thiếu quyền ghi `/etc` hoặc load daemon | Message "run with sudo" + phần `--print` |
| Port/IP `<loopback>:80` đã bị chiếm bởi process khác | Báo xung đột listen | Setup dừng ở bước daemon, conf DNS vẫn hợp lệ |

## Postconditions
- `*.<zone>` resolve về kf loopback; `kf proxy serve` chạy và tự khởi động lại khi chết
- `kf validate` không còn WARNING `worktree_infra_missing`

## Business Rules
- Setup idempotent: chạy lại ghi đè conf giống hệt, không duplicate, không lỗi
- Không bao giờ sửa hay xoá file conf không phải của kf tạo

## Data
- `~/.config/kanban-flow/config.json`: `proxyListen`, `domainZone`, `fallbackUpstream`
- `/opt/homebrew/etc/dnsmasq.d/kanban-flow.conf`, `/etc/resolver/<zone>`, `/Library/LaunchDaemons/ai.kaban-flow.proxy.plist`

## Acceptance Criteria
- [ ] `--print` in đủ lệnh, không side effect (TC-011)
- [ ] Setup phát hiện rule xung đột và từ chối (TC-012)
- [ ] Chạy hai lần liên tiếp exit 0, conf không đổi (TC-011)

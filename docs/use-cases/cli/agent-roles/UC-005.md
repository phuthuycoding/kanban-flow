---
feature: "agent-roles"
context: "cli"
created: "20260919_2220"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Hai role dùng chung runner nhưng session tách biệt |
| Requirement reference | FR-005 |
| Goal | `architect` và `coder` cùng chạy claude nhưng không lẫn ngữ cảnh của nhau |
| Primary actor | Main agent |

## Supporting Actors
- Worker agent (cùng một CLI, hai phiên khác nhau)

## Preconditions
- Hai role trỏ cùng một runner có `resume`

## Trigger
`kf run` cho hai stage khác nhau của cùng work item, mỗi stage một role.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | kf | Chạy role `coder`: chưa có `sessions.coder` → `start`, lưu session theo key `coder` | Một phiên |
| 2 | kf | Chạy role `reviewer` (cùng runner): chưa có `sessions.reviewer` → `start` riêng | Phiên thứ hai, không dính ngữ cảnh code |
| 3 | kf | Vòng sửa: `kf run` lại stage implementation → resume đúng `sessions.coder` | Worker nhớ code mình viết |

## Alternative Flows
### A1
- Trigger: `--fresh`

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Bỏ session của role đó, start mới | Về bước 3 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Resume hỏng | Reset một lần rồi start (như harness hiện tại), thông điệp nêu role | Session mới cho role đó |
| Meta cũ có `runs[].agent` | `readFeatureMeta` throw `Invalid feature metadata` | Không tự migrate |

## Postconditions
- `sessions` có một key cho mỗi role đã chạy

## Business Rules
- Session key là role, không phải runner
- Session không dùng chéo giữa các work item

## Data
- `.kfw.json.sessions`, `runs[].role`, `runs[].runner`

## Acceptance Criteria
- [ ] Hai role cùng runner có hai session riêng, resume đúng của mình (TC-006)
- [ ] `runs[]` có `role` và `runner`; meta cũ bị từ chối (TC-007)

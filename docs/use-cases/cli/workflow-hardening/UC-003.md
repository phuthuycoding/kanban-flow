---
feature: "workflow-hardening"
context: "cli"
created: "20260919_1206"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Agent bypass gate, dấu vết được ghi và hiển thị |
| Requirement reference | FR-003 |
| Goal | Mọi lần dùng `--force`/`--skip-hooks` mà thực sự bỏ qua một gate hoặc hook đều được ghi vào metadata và hiện ra ở status, validate, view, dashboard |
| Primary actor | Agent |

## Supporting Actors
- Người vận hành (đọc dấu vết khi review)

## Preconditions
- Feature tồn tại, metadata hợp lệ

## Trigger
`kf stage <feature> <stage> --force` hoặc `--skip-hooks`; `kf archive <feature>` với các flag tương ứng.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Agent | Chạy `kf stage` với `--force` khi validation hoặc direction gate fail | CLI xác định danh sách mã lỗi bị bỏ qua |
| 2 | CLI | Ghi `bypasses[]` vào `.kfw.json` trước khi rename folder: `at`, `from`, `to`, `flag`, `codes` | Metadata có bản ghi |
| 3 | CLI | Thực hiện transition | Folder chuyển stage; stdout ghi chú "gate bypassed (recorded)" |
| 4 | Validator | Khi validate feature có `bypasses` | WARNING `gate_bypassed` kèm số lần |
| 5 | CLI | `kf status` in `Bypasses: N`; `--json` có mảng `bypasses` | Người đọc thấy ngay |
| 6 | Dashboard | `metrics.bypassed` = số work item có ít nhất một bản ghi; KPI note hiển thị | Người vận hành thấy trên tổng quan |

## Alternative Flows
### A1
- Trigger: `--skip-hooks` và có hook resolve được cho stage đích

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Ghi bản ghi `flag: "skip-hooks"`, `codes: ["hook:<path>"]` | Về bước 3 |

### A2
- Trigger: `--force` nhưng gate pass, hoặc `--skip-hooks` nhưng không có hook

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Không ghi gì | Về bước 3 không ghi chú bypass |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Ghi metadata thất bại | Rollback như logic hiện có của `stage.ts`/`archive.ts`; lỗi nổi lên | Feature ở stage cũ, không có bản ghi mồ côi |

## Postconditions
- Lịch sử bypass tồn tại cùng feature đến khi archive; không tự xoá

## Business Rules
- Chỉ ghi khi thực sự có gate/hook bị bỏ qua
- Bản ghi là append-only về phía CLI; CLI không có lệnh xoá
- Đây là truy vết, không phải bảo đảm: agent vẫn có thể sửa file JSON tay (ghi rõ trong docs)

## Data
- `Bypass`: `{ at: string; from: Stage | null; to: Stage; flag: "force" | "skip-hooks"; codes: string[] }`

## Acceptance Criteria
- [ ] Force khi gate fail ghi bản ghi đúng và hiển thị ở validate/status (TC-005)
- [ ] Không ghi khi không có gì bị bỏ qua; skip-hooks ghi khi có hook (TC-006)
- [ ] View/dashboard đếm đúng (TC-007)
- [ ] Metadata cũ không có `bypasses` vẫn hợp lệ; sai kiểu bị từ chối (TC-013)

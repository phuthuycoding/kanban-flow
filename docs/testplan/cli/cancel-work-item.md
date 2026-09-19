---
feature: "cancel-work-item"
context: "cli"
created: "20260919_2245"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

Counts match the detailed cases below. TC-011 kiểm docs bằng shell. Đây là contract; kết quả thực thi thuộc `phase-4-testing-result.md`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | cancel-work-item |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), `npm run typecheck`, `npm run lint`, shell checks |
| Coverage target | N/A (không có coverage tooling; gate = suite xanh + typecheck + lint) |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 4 | 4 | TC-002, TC-004, TC-008, TC-010 |
| Integration | 7 | 7 | TC-001, TC-003, TC-005, TC-006, TC-007, TC-009 vitest; TC-011 shell |
| UI / E2E | 0 | 0 | Không có UI |
| **Total** | **11** | **11** | Suite hiện có (209) cũng phải xanh |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-002, FR-003 | TC-001, TC-002, TC-003 | 3 | Metadata đủ, reason bắt buộc, hook |
| UC-002 | FR-004 | TC-005 | 1 | Liệt kê docs, purge có confirm |
| UC-003 | FR-005 | TC-007 | 1 | Mở lại đúng stage |
| UC-004 | FR-007 | TC-009, TC-010 | 2 | Hiển thị và mẫu số |
| UC-005 | FR-001, FR-006 | TC-004, TC-006, TC-008 | 3 | Gate tắt, cancellation_missing, chặn archive |
| UC-006 | FR-008 | TC-011 | 1 | Docs và skill |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-005 | TC-004 | yes | — |
| FR-002 | UC-001 | TC-001, TC-002 | yes | — |
| FR-003 | UC-001 | TC-003, TC-006 | yes | — |
| FR-004 | UC-002 | TC-005 | yes | Prompt TTY test qua nhánh `--force` |
| FR-005 | UC-003 | TC-007 | yes | — |
| FR-006 | UC-005 | TC-004, TC-008 | yes | — |
| FR-007 | UC-004 | TC-009, TC-010 | yes | Dashboard HTML kiểm bằng chuỗi |
| FR-008 | UC-006 | TC-011 | yes | Shell check |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Work item `demo` ở `implementation` |
| Input | `kf cancel demo --reason "đổi hướng"` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy | exit 0; stdout nêu stage cũ, lý do và cách mở lại |
| 2 | Đọc meta | `cancellation` có `at` (ISO hoặc `YYYYMMDD_HHmm`), `by`, `reason`, `fromStage: "implementation"`; `status: "cancelled"` |
| 3 | Đọc thư mục | Folder nằm trong `.works/cancelled/`, không còn ở `implementation` |
| 4 | `--by "Quyen"` | `cancellation.by === "Quyen"`; không truyền thì lấy `reviewer` của config, không có thì `human` |
| 5 | `runs[]`/`bypasses[]` có sẵn trước đó | giữ nguyên sau khi cancel |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Work item tồn tại |
| Input | Các dạng `--reason` sai và trạng thái sai |
| Steps | See steps table below |
| Expected outcome | Mọi trường hợp exit 1, item không đổi stage |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Không truyền `--reason` | exit 1 nêu reason bắt buộc |
| 2 | `--reason "   "` | exit 1 |
| 3 | `--reason` chứa token thật (`ghp_` + 36 ký tự) | exit 1 nêu secret, không ghi metadata |
| 4 | Cancel item đã ở `cancelled` | exit 1 |
| 5 | Feature không tồn tại | exit 1 |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item có run harness `running` với pid sống |
| Input | `kf cancel`, `kf cancel --force` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Cancel khi có run đang chạy | exit 1 nêu run id; item giữ stage |
| 2 | `--force` | exit 0, chuyển sang cancelled, `bypasses[]` có bản ghi `force` |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001, FR-006 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item ở `cancelled` |
| Input | `validateFeature` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Item cancelled từ `implementation` (đã approve, chưa đủ artifact về sau) | `valid === true`, không có issue `artifact_missing`/`approval_required`/`testing_stale` |
| 2 | Item cancelled từ `planning` chưa approve | `valid === true` |
| 3 | Xoá `cancellation` khỏi meta, giữ stage cancelled | ERROR `cancellation_missing` |
| 4 | `cancellation.reason` là chuỗi rỗng | ERROR `cancellation_missing` |
| 5 | `STAGE_INDEX.cancelled` | bằng `-1`; `STAGES` có 8 phần tử, `STAGES[6] === "dones"` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item ở `dones` đã sync canonical docs (requirement, use-cases/, testplan, testplan-result) |
| Input | `kf cancel`, `kf cancel --purge-docs --force` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Cancel không cờ | exit 0; stdout liệt kê đủ 4 nhóm docs; mọi file vẫn tồn tại trên đĩa |
| 2 | Item khác ở dones, `--purge-docs --force` | docs của đúng item đó bị xoá; docs của item khác cùng context còn nguyên |
| 3 | `--purge-docs` không `--force` trên non-TTY | exit 1 yêu cầu `--force` |
| 4 | Item chưa từng archive | stdout không có phần liệt kê docs |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | `.kf/hooks/cancelled.sh` exit 9 |
| Input | `kf cancel`, `kf cancel --skip-hooks` |
| Steps | See steps table below |
| Expected outcome | Hook chặn; skip-hooks qua được và ghi bypass |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Cancel | exit 1, in output hook, item giữ stage |
| 2 | `--skip-hooks` | exit 0; `bypasses` có bản ghi `flag: "skip-hooks"`, `codes[0]` bắt đầu bằng `hook:` |
| 3 | Hook exit 0 | cancel chạy bình thường |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item cancelled với `fromStage: "planning"` |
| Input | `kf stage demo planning`, `kf stage demo testing` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `kf stage demo planning` | exit 0; folder về `.works/planning/`; meta không còn `cancellation` và `status` |
| 2 | Cancel lại rồi `kf stage demo testing` | exit 1 nêu chỉ được về `planning` |
| 3 | Xoá `cancellation` khỏi meta rồi `kf stage demo planning` | exit 1 hướng dẫn `--force` |
| 4 | `runs[]`/`sessions` trước khi cancel | còn nguyên sau khi mở lại |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-006 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Item ở `cancelled` |
| Input | `kf archive demo` |
| Steps | See steps table below |
| Expected outcome | exit 1 nêu item đã bị bỏ; không đụng docs |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy | như expected |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-007 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item cancelled với reason nhiều dòng |
| Input | `kf list`, `kf status --change`, `--json` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `kf list` | dòng của item có stage `cancelled` |
| 2 | `kf status --change demo` | có `Cancelled: <at> by <by> — <dòng đầu của reason>`, nêu `fromStage`, không có dòng `Next:` |
| 3 | `--json` | có `cancellation` đủ trường với reason nguyên vẹn (cả xuống dòng) |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-007 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | 4 item: 2 `dones`, 1 `cancelled`, 1 `testing` |
| Input | `dashboardData`, `cmdView` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `metrics` | `cancelled === 1`, `completed === 2`, `total === 4`, `completionRate === 67` (2/3) |
| 2 | Mọi item đều cancelled | `completionRate === null` |
| 3 | `cmdView` text | có dòng Cancelled |
| 4 | `renderDashboardHtml()` | chứa nhãn Cancelled |
| 5 | `dashboardData().stages` | có 8 phần tử, gồm `cancelled` |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-008 |
| Use case reference | UC-006 |
| Test type | Integration (shell) |
| Priority | Low |
| Preconditions | Repo sau implement |
| Input | Shell |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `grep -n "cancel" docs/workflow/lifecycle.md docs/workflow/state-machine.md docs/workflow/gates.md` | cả ba có nhánh cancelled |
| 2 | `grep -n "kf cancel" docs/workflow/cli-reference.md README.md` | có |
| 3 | `grep -n "cancel" skills/kanban-flow/SKILL.md` | nêu agent đề xuất, người quyết |
| 4 | `grep -n "cancel" CHANGELOG.md BACKLOG.md` | CHANGELOG có mục Added; BACKLOG có `kf supersede` |

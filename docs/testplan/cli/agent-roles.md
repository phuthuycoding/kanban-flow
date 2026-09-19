---
feature: "agent-roles"
context: "cli"
created: "20260919_2220"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

Counts match the detailed cases below. TC-013 kiểm docs bằng shell. CLI giả bash trên PATH hermetic. Đây là contract; kết quả thực thi thuộc `phase-4-testing-result.md`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | agent-roles |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), `npm run typecheck`, `npm run lint`, CLI giả bash, shell checks |
| Coverage target | N/A (không có coverage tooling; gate = suite xanh + typecheck + lint) |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 5 | 5 | TC-001, TC-002, TC-003, TC-005, TC-007 |
| Integration | 8 | 8 | TC-004, TC-006, TC-008, TC-009, TC-010, TC-011, TC-012 vitest; TC-013 shell |
| UI / E2E | 0 | 0 | Không có UI |
| **Total** | **13** | **13** | Suite hiện có (195) cũng phải xanh sau khi cập nhật fixture sang role |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-007, FR-008 | TC-001, TC-002, TC-011 | 3 | Validate, seed, `kf harness` ba bảng |
| UC-002 | FR-003, FR-004, FR-006 | TC-004, TC-005, TC-008, TC-009 | 4 | Chuỗi chạy đúng thứ tự, prompt đủ, skill theo runner |
| UC-003 | FR-003 | TC-008, TC-010 | 2 | Dừng chuỗi, `--role`, bỏ `--agent` |
| UC-004 | FR-001, FR-008 | TC-002, TC-012 | 2 | Đổi runner một dòng, `byRole` |
| UC-005 | FR-005 | TC-006, TC-007 | 2 | Session theo role, runs có role+runner |
| UC-006 | FR-002, FR-009 | TC-003, TC-013 | 2 | Lỗi runner-vs-role, docs migration |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001, UC-004 | TC-001, TC-002 | yes | — |
| FR-002 | UC-001, UC-006 | TC-001, TC-003 | yes | — |
| FR-003 | UC-002, UC-003 | TC-004, TC-008, TC-010 | yes | — |
| FR-004 | UC-002 | TC-005 | yes | — |
| FR-005 | UC-005 | TC-006, TC-007 | yes | — |
| FR-006 | UC-002 | TC-009 | yes | — |
| FR-007 | UC-001 | TC-002 | yes | — |
| FR-008 | UC-001, UC-004 | TC-011, TC-012 | yes | Dashboard HTML ngoài scope |
| FR-009 | UC-006 | TC-013 | yes | Shell check nội dung docs |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001, FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Temp dir có `.kf/config.json` |
| Input | Các biến thể `harness` sai |
| Steps | See steps table below |
| Expected outcome | Mỗi biến thể throw nêu đúng field |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `roles.writer.runner` trỏ runner không tồn tại | throw nêu `harness.roles.writer.runner` |
| 2 | `roles.writer.output` là `../escape.md` | throw nêu `harness.roles.writer.output` |
| 3 | `main` là tên runner chứ không phải role | throw nêu `harness.main` |
| 4 | `stages.brainstorm` là `[]` | throw nêu chuỗi rỗng |
| 5 | `stages.brainstorm` là `["writer", "writer"]` | throw nêu role trùng |
| 6 | `stages.backlog` được gán | throw nêu stage không hợp lệ |
| 7 | Config hợp lệ dạng ngắn `"coder": "claude"` | chuẩn hoá thành `{ runner: "claude" }`, `stages` string thành mảng một phần tử |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001, FR-007 |
| Use case reference | UC-001, UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | Temp dir trống |
| Input | `cmdInit` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cmdInit --defaults` | `harness.main === "architect"`; `roles` có đúng 6 key architect/researcher/writer/coder/tester/reviewer; mỗi role có `runner` trỏ runner tồn tại và `brief` không rỗng; `stages` rỗng |
| 2 | Đổi `roles.writer.runner` thành `gemini`, chạy `cmdInit` lại | `harness` giữ nguyên, `stages` vẫn rỗng |
| 3 | `cmdInit --minimal` trên dir mới | cũng seed `roles` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | Config có `runners.gemini`, không có role nào tên `gemini` |
| Input | `stages: { testing: "gemini" }` |
| Steps | See steps table below |
| Expected outcome | Thông điệp chứa `is a runner, not a role` và gợi ý khai báo trong `harness.roles` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Đọc config | throw với thông điệp trên |
| 2 | `stages: { testing: "khong-ton-tai" }` | throw nêu danh sách role hợp lệ |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | `stages: { brainstorm: ["researcher", "writer"] }`, researcher→codex, writer→gemini, CLI giả cả hai in `STATUS: DONE` |
| Input | `kf run demo` (work item ở brainstorm) |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy | exit 0; stdout có hai khối kết quả theo thứ tự researcher rồi writer |
| 2 | Đọc meta | `runs` dài 2; `runs[0].role === "researcher"`, `runs[0].runner === "codex"`; `runs[1].role === "writer"`, `runs[1].runner === "gemini"` |
| 3 | Đọc argv hai CLI giả | cả hai đều được gọi, mỗi cái đúng template runner của nó |
| 4 | Đọc log | mỗi run một file `runs/<id>.log` riêng |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | researcher có `brief` và `output: "research.md"` |
| Input | Prompt của hai role trong chuỗi |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Prompt role đầu | chứa `"researcher"`, nội dung `brief`, yêu cầu ghi `research.md`; không có mục Previous step |
| 2 | Prompt role sau | chứa `"writer"`, mục Previous step nêu `researcher`, đường dẫn `research.md` và đường dẫn log của run trước |
| 3 | Role không có `output` | prompt không có dòng yêu cầu ghi file phụ |
| 4 | Cả hai prompt | vẫn giữ contract cũ: không `kf stage`, kết thúc `STATUS:` |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-005 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | `coder` và `reviewer` cùng trỏ runner `claude` (có resume) |
| Input | `kf run` cho stage implementation rồi review |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy implementation (coder) | `sessions.coder` được lưu |
| 2 | Chạy review (reviewer) | `sessions.reviewer` khác `sessions.coder`, argv dùng `--session-id` chứ không resume phiên của coder |
| 3 | Chạy lại implementation | resume đúng `sessions.coder` |
| 4 | `--fresh` cho coder | chỉ `sessions.coder` đổi, `sessions.reviewer` giữ nguyên |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-005 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | — |
| Input | `.kfw.json` với `runs[]` các dạng |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `runs[0]` có `role` và `runner` hợp lệ | đọc được |
| 2 | `runs[0]` kiểu cũ chỉ có `agent` | throw `Invalid feature metadata` |
| 3 | `sessions` là map string→string | hợp lệ |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-002, UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Chuỗi hai role; CLI giả role đầu in `STATUS: BLOCKED` |
| Input | `kf run demo` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Role đầu BLOCKED | exit 1; stdout nêu chuỗi dừng ở role đầu |
| 2 | Kiểm tra CLI giả role sau | không có file argv (chưa từng được gọi) |
| 3 | `runs` | chỉ 1 bản ghi |
| 4 | Role đầu `DONE_WITH_CONCERNS` | chuỗi tiếp tục, 2 bản ghi, exit 0 |
| 5 | Role đầu exit 1 | dừng chuỗi như bước 1 |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Role `writer` trỏ runner `gemini`; xoá `.gemini/skills/kanban-brainstorm` |
| Input | `kf run demo` |
| Steps | See steps table below |
| Expected outcome | exit 1; thông điệp nêu cả role `writer` và runner `gemini`, gợi ý `kf install --agent gemini`; không tạo run; đường dẫn skill là `.gemini/skills/...` chứ không phải `.writer/skills/...` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy | như expected |
| 2 | Runner có `skillsDir` tuỳ chỉnh | dùng đúng thư mục đó |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Chuỗi hai role |
| Input | `--role`, `--agent`, `--dry-run` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `--role writer` | chỉ writer chạy; researcher không có argv; 1 run |
| 2 | `--role khong-co` | exit 1 nêu chuỗi hợp lệ của stage |
| 3 | `--agent gemini` | exit 1, thông điệp chỉ sang `--role` |
| 4 | `--dry-run` | in hai khối argv + prompt, không spawn, không ghi run |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-008 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Config đầy đủ ba lớp; chỉ `gemini` có trên PATH |
| Input | `kf harness`, `kf harness --json` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Text | có `main: architect`; bảng stage in `brainstorm → researcher → writer`; bảng role in `writer → gemini` kèm brief rút gọn; bảng runner in `gemini on PATH`, `codex missing` |
| 2 | JSON | có `main`, `stages[].roles`, `roles[].runner`, `runners[].available` |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-008 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Work item có runs của hai role |
| Input | `kf status`, `kf view`, `kf runs` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `kf status --change demo` | `Assigned: researcher (codex) → writer (gemini)`; `Runs: 2 (researcher×1, writer×1)` |
| 2 | `kf status --json` | `assignedRoles` là mảng hai phần tử |
| 3 | `kf view --json` | `metrics.runs.byRole.writer.runs === 1`; không còn key `byAgent` |
| 4 | `kf runs demo` | mỗi dòng có cả role và runner |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-009 |
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
| 1 | `grep -n "role" docs/workflow/harness.md` | có mục giải thích role và ba lớp |
| 2 | `grep -n "Migration\|migration" docs/workflow/harness.md` | có mục chuyển đổi từ config cũ |
| 3 | `grep -n "role" skills/kanban-flow/SKILL.md` | mô tả chuỗi role và việc dừng chuỗi |
| 4 | `grep -n "role" CHANGELOG.md README.md` | có ghi breaking change và mục harness cập nhật |

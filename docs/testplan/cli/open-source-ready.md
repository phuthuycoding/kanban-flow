---
feature: "open-source-ready"
context: "cli"
created: "20260919_2340"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

Counts match the detailed cases below. TC-005, TC-006, TC-007, TC-008 kiểm bằng shell vì đối tượng là file tài liệu và gói npm. Đây là contract; kết quả thực thi thuộc `phase-4-testing-result.md`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | open-source-ready |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), `npm run typecheck`, `npm run lint`, `npm pack --dry-run`, shell grep |
| Coverage target | N/A (không có coverage tooling; gate = suite xanh + typecheck + lint) |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 5 | 5 | TC-001, TC-002, TC-004, TC-009, TC-010 — vitest |
| Integration | 5 | 5 | TC-003 vitest; TC-005, TC-006, TC-007, TC-008 shell |
| UI / E2E | 0 | 0 | Không có UI ngoài dashboard HTML kiểm bằng chuỗi |
| **Total** | **10** | **10** | Suite hiện có (226) cũng phải xanh |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-004 | TC-005, TC-006 | 2 | README tiếng Anh, mở bằng vấn đề, positioning trung thực |
| UC-002 | FR-005 | TC-005 | 1 | Cài một dòng, bỏ câu repo private |
| UC-003 | FR-001, FR-002 | TC-001, TC-002, TC-003 | 3 | Không còn tiếng Việt ở bề mặt |
| UC-004 | FR-003, FR-006, FR-007, FR-009 | TC-004, TC-007, TC-008 | 3 | Tên gói, phiên bản, LICENSE, pack không mang docs nội bộ |
| UC-005 | FR-008 | TC-009, TC-010 | 2 | Docs tiếng Anh, liên kết còn sống |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-003 | TC-001, TC-003 | yes | — |
| FR-002 | UC-003 | TC-002 | yes | — |
| FR-003 | UC-004 | TC-004, TC-007 | yes | — |
| FR-004 | UC-001 | TC-005, TC-006 | yes | Chất lượng văn phong không tự động kiểm được |
| FR-005 | UC-002 | TC-005 | yes | — |
| FR-006 | UC-004 | TC-008 | yes | — |
| FR-007 | UC-003, UC-004 | TC-003, TC-004, TC-008 | yes | — |
| FR-008 | UC-005 | TC-009, TC-010 | yes | Chất lượng bản dịch không tự động kiểm được |
| FR-009 | UC-004 | TC-007 | yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | Nội dung mọi file `.ts` dưới `src/` trừ `src/tests/` |
| Steps | See steps table below |
| Expected outcome | Không file nào chứa ký tự có dấu tiếng Việt; danh sách vi phạm rỗng |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Đọc đệ quy `src/**/*.ts`, bỏ `src/tests/` | Có danh sách file |
| 2 | Khớp từng file với tập ký tự tiếng Việt có dấu | Không khớp ở đâu |
| 3 | Khi fail, thông báo nêu tên file và dòng đầu tiên vi phạm | Người sửa biết đi đâu |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | `skills/*/SKILL.md`, `kanban-flow/templates/*.md` |
| Steps | See steps table below |
| Expected outcome | Không file nào chứa ký tự tiếng Việt; 8 skill vẫn tồn tại đủ |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Đọc 8 SKILL.md và toàn bộ template | Có nội dung |
| 2 | Khớp ký tự tiếng Việt | Không khớp |
| 3 | Kiểm mỗi skill vẫn có frontmatter `name` và `description` | Đủ, không hỏng cấu trúc khi dịch |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001, FR-007 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Work item ở `backlog` và một item ở `cancelled` |
| Input | `renderDashboardHtml()`, `kf status --change` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `renderDashboardHtml()` | Chứa `lang="en"`, không chứa ký tự tiếng Việt, tiêu đề mang tên `kanban-flow` |
| 2 | `dashboardData()` nhãn context rỗng và nhãn approval | Tiếng Anh |
| 3 | `kf status` cho item ở backlog | Tên phase tiếng Anh, không còn "Chờ quyết định triển khai" |
| 4 | `kf status` cho item cancelled | Tên phase tiếng Anh |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-003, FR-007 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | `package.json`, `LICENSE` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Đọc `package.json` | `name === "kanban-flow"`, `version === "0.3.0"`, `bin.kf` giữ nguyên |
| 2 | Kiểm metadata | Có `repository`, `homepage`, `bugs`, `keywords` (mảng không rỗng), `publishConfig` |
| 3 | Đọc `LICENSE` | Tồn tại, là MIT, có năm và tên chủ sở hữu |
| 4 | Đọc `package-lock.json` | `name` khớp `kanban-flow` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-004, FR-005 |
| Use case reference | UC-001, UC-002 |
| Test type | Integration (shell) |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | `README.md` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `wc -l README.md` | ≤ 120 dòng |
| 2 | Khớp ký tự tiếng Việt | Không có |
| 3 | `grep -n "npm install -g kanban-flow"` | Có |
| 4 | `grep -ci "repo private"` | 0 |
| 5 | Đọc 15 dòng đầu | Nói về vấn đề (agent tự khai đã test) trước khi nói tính năng |
| 6 | `grep -n "docs/workflow"` | Có mục trỏ sang tài liệu chi tiết |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Integration (shell) |
| Priority | Medium |
| Preconditions | Repo sau implement |
| Input | `README.md` |
| Steps | See steps table below |
| Expected outcome | Không có khẳng định độc quyền sai; có nêu execution id và tổ hợp |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Tìm các cụm kiểu "no other tool", "nobody else", "first tool", "only tool" | Không xuất hiện cạnh traceability, role routing, hash approval, cancelled, placeholder |
| 2 | `grep -in "execution id"` | Có, được nêu là cơ chế không tìm thấy ở nơi khác |
| 3 | Tìm từ diễn đạt tổ hợp (combination/together) | Có, phần khác biệt dựa trên tổ hợp |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-003 |
| Use case reference | UC-004 |
| Test type | Integration (shell) |
| Priority | High |
| Preconditions | Đã build `dist/` |
| Input | `npm pack --dry-run` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `npm pack --dry-run` | Liệt kê `dist/`, `skills/`, `docs/workflow/`, `kanban-flow/templates/`, `kanban-flow/review/`, `README.md`, `LICENSE`, `package.json` |
| 2 | Kiểm danh sách | Không chứa `src/`, `.works/`, `.kf/`, `.claude/`, `node_modules/`, `.github/`, `docs/requirement`, `docs/use-cases`, `docs/testplan` |
| 3 | Kiểm tên file gói | Bắt đầu bằng `kanban-flow-0.3.0` |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-006, FR-007 |
| Use case reference | UC-004 |
| Test type | Integration (shell) |
| Priority | Medium |
| Preconditions | Repo sau implement, đã build |
| Input | Shell |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `grep -rn "kaban" src README.md docs/README.md docs/workflow package.json .gitignore` | Chỉ còn `USER_KABAN_DIR` trong `src/shared/paths.ts` và nơi dùng nó |
| 2 | `node dist/index.js --version` | `0.3.0` |
| 3 | `node dist/index.js help` | Banner mang tên `kanban-flow` |
| 4 | `grep -n "Unreleased" CHANGELOG.md` | Có mục cho đợt này |
| 5 | `grep -in "docs/workflow" BACKLOG.md` | Có mục dịch tài liệu còn lại |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-008 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | `docs/README.md` và mọi file `docs/workflow/*.md` |
| Steps | See steps table below |
| Expected outcome | Không file nào chứa ký tự tiếng Việt; số file kiểm đúng 10 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Đọc `docs/README.md`, `docs/workflow/*.md` và `kanban-flow/README.md` | Đúng 11 file |
| 2 | Khớp ký tự tiếng Việt từng file | Không khớp ở đâu |
| 3 | Khi fail, nêu tên file và dòng đầu tiên vi phạm | Người sửa biết đi đâu |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-008 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | Liên kết markdown nội bộ trong `README.md`, `docs/README.md`, `docs/workflow/*.md` |
| Steps | See steps table below |
| Expected outcome | Mọi liên kết tương đối trỏ tới file tồn tại; không có liên kết chết sau khi dịch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Trích mọi `[text](path)` không phải `http` và không phải mailto | Có danh sách |
| 2 | Bỏ phần anchor sau `#`, resolve tương đối theo file chứa nó | Đường dẫn tuyệt đối |
| 3 | Kiểm file tồn tại | Tồn tại hết |
| 4 | Với liên kết có anchor, kiểm tiêu đề tương ứng tồn tại trong file đích | Anchor còn sống sau khi dịch tiêu đề |

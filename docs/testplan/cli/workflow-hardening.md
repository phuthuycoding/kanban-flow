---
feature: "workflow-hardening"
context: "cli"
created: "20260919_1206"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

Counts match the detailed cases below. TC-008, TC-009 và TC-012 chạy bằng shell (không có test tự động hợp lý cho file CI/kích thước file/CHANGELOG); evidence ghi trong testing-result. Đây là contract; kết quả thực thi thuộc về `phase-4-testing-result.md`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | workflow-hardening |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), `npm run typecheck`, `npm run lint`, shell checks |
| Coverage target | N/A (không có coverage tooling; gate = suite xanh + typecheck + lint) |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 5 | 5 | TC-001, TC-003, TC-004, TC-010, TC-013 — vitest |
| Integration | 8 | 8 | TC-002, TC-005, TC-006, TC-007, TC-011 vitest trên temp dir; TC-008, TC-009, TC-012 shell |
| UI / E2E | 0 | 0 | Test Level unit+integration, không có UI |
| **Total** | **13** | **13** | Toàn bộ suite hiện có (136 test) cũng phải xanh |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001 | TC-001, TC-002 | 2 | Mọi dòng `kf ...` trong guide parse được; stacks từ config |
| UC-002 | FR-002, FR-005 | TC-003, TC-004, TC-009 | 3 | Secret thật flag, placeholder không, validator đã tách |
| UC-003 | FR-003 | TC-005, TC-006, TC-007, TC-013 | 4 | Bypass ghi đúng lúc, hiển thị ở status/validate/view, meta cũ an toàn |
| UC-004 | FR-004 | TC-008 | 1 | ci.yml đúng cấu trúc; typecheck bắt lỗi trong test |
| UC-005 | FR-006, FR-005 | TC-010 | 1 | PASS cần exit code 0 và ≥ 1 lệnh |
| UC-006 | FR-007 | TC-011 | 1 | AGENTS.md tạo đúng, không ghi đè |
| UC-007 | FR-008 | TC-012 | 1 | CHANGELOG, version, README note có mặt |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-001, TC-002 | yes | — |
| FR-002 | UC-002 | TC-003, TC-004 | yes | — |
| FR-003 | UC-003 | TC-005, TC-006, TC-007, TC-013 | yes | Dashboard HTML chỉ kiểm tra qua data + render string |
| FR-004 | UC-004 | TC-008 | yes | Chạy thật trên GitHub chỉ kiểm chứng được sau push |
| FR-005 | UC-002, UC-005 | TC-009 | yes | Refactor được bảo vệ bởi suite hiện có |
| FR-006 | UC-005 | TC-010 | yes | — |
| FR-007 | UC-006 | TC-011 | yes | — |
| FR-008 | UC-007 | TC-012 | yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Temp dir có `package.json` |
| Input | `cmdAutoconfig` stdout |
| Steps | See steps table below |
| Expected outcome | Mọi dòng bắt đầu bằng `kf ` trong mục Workflow guide, sau khi lấy usage tối giản (bỏ `[...]`, thay `<x>` bằng giá trị mẫu), parse bằng `parseArgsCli` không throw; guide không chứa `--to` hay `--change <c/n>` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdAutoconfig` trên temp dir | code 0, có `## Workflow guide` |
| 2 | Trích các dòng `kf <cmd> ...` | ≥ 8 dòng, mỗi `<cmd>` nằm trong `allCommands()` |
| 3 | Với mỗi dòng, dựng argv tối giản rồi `parseArgsCli` | không throw |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Temp dir có `package.json` (detect = node) và `.kf/config.json` với `stacks: ["go"]` |
| Input | `cmdAutoconfig` |
| Steps | See steps table below |
| Expected outcome | Briefing in `Detected stacks: go` (config thắng auto-detect); khi config không có `stacks` thì in `node` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Ghi config có `stacks: ["go"]`, chạy autoconfig | stdout chứa `stacks: go`, không chứa `stacks: node` |
| 2 | Xoá `stacks` khỏi config, chạy lại | stdout chứa `stacks: node` |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | — |
| Input | Chuỗi nhiều dòng chứa secret thật kèm từ placeholder trên cùng dòng |
| Steps | See steps table below |
| Expected outcome | `findSecretLike` trả về đúng các dòng chứa secret thật; hit không chứa nguyên giá trị secret (bị cắt/che) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `TOKEN=ghp_` + 36 ký tự + `  # example for prod` | 1 hit |
| 2 | `Authorization: Bearer ` + JWT thật + ` (sample request)` | 1 hit |
| 3 | AWS access key id thật (`AKIA` + 16 ký tự) trên dòng có chữ `example` | 1 hit (pattern cao không miễn) |
| 4 | `PASSWORD=…` với giá trị thật, kèm `# changeme later` | 1 hit |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | — |
| Input | Chuỗi chứa placeholder |
| Steps | See steps table below |
| Expected outcome | `findSecretLike` trả về mảng rỗng |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `API_KEY={key}`, `Authorization: Bearer <token>`, `TOKEN=changeme` | 0 hit (test cũ giữ nguyên) |
| 2 | `TOKEN=ghp_` + 36 chữ `x` | 0 hit |
| 3 | `SECRET=************` và `PASSWORD=your_password_here` | 0 hit |
| 4 | Header PEM private key thật (BEGIN ... PRIVATE KEY) | 1 hit (kiểm soát: pattern cao vẫn bắt) |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Feature ở brainstorm với spec chưa confirmed |
| Input | `cmdStage(demo, planning, { force: true })` |
| Steps | See steps table below |
| Expected outcome | Transition thành công; `.kfw.json.bypasses` có 1 bản ghi `flag: "force"`, `from: brainstorm`, `to: planning`, `codes` chứa `requirement_unconfirmed`; `validateFeature` có WARNING `gate_bypassed`; `renderStatusText` chứa `Bypasses: 1`; `statusToJson().bypasses.length === 1` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Tạo feature, ghi spec `status: draft` | gate fail khi stage thường |
| 2 | Stage với `force: true` | code 0, folder ở planning |
| 3 | Đọc meta | `bypasses[0]` đúng như expected |
| 4 | validate + status | WARNING `gate_bypassed`, text có `Bypasses: 1` |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Feature có spec hợp lệ (gate pass); không có hook nào |
| Input | `cmdStage(demo, planning, { force: true, "skip-hooks": true })` |
| Steps | See steps table below |
| Expected outcome | Transition thành công và meta **không** có `bypasses` (không ghi nhiễu) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Stage với cả hai flag khi gate pass và không có hook | `meta.bypasses` undefined |
| 2 | Thêm hook `planning.sh` exit 9, stage với `skip-hooks` | code 0, `bypasses[0].flag === "skip-hooks"` |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Hai work item: một có `bypasses`, một không |
| Input | `dashboardData(root)`, `cmdView --json` |
| Steps | See steps table below |
| Expected outcome | `metrics.bypassed === 1`; `renderDashboardHtml()` chứa nhãn bypass; view text có dòng `Bypassed: 1` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Ghi meta trực tiếp bằng `writeFeatureMeta` với `bypasses` | `dashboardData().metrics.bypassed` = 1 |
| 2 | `cmdView` json và text | có `bypassed`; text có `Bypassed: 1` |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | `.github/workflows/ci.yml`, `npm run typecheck` |
| Steps | See steps table below |
| Expected outcome | ci.yml có `on: [push, pull_request]`, matrix `[20, 22]`, ba bước typecheck/lint/test; typecheck bắt lỗi kiểu cố ý trong test; `npm run build` không emit `dist/tests` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cat .github/workflows/ci.yml` | các chuỗi trên có mặt |
| 2 | Thêm `const x: number = "a"` vào một test, `npm run typecheck` | exit ≠ 0; hoàn tác |
| 3 | `npm run build && ls dist` | không có `tests/` |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-005 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Repo sau implement |
| Input | `wc -l src/workflow/*.ts`, `npm test` |
| Steps | See steps table below |
| Expected outcome | Mọi file `src/workflow/*.ts` < 500 dòng; suite hiện có pass không sửa test cũ; `validate.ts` vẫn export đủ tên cũ |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `wc -l src/workflow/*.ts` | max < 500 |
| 2 | `git diff --stat src/tests/` | chỉ có thêm test mới, không sửa assertion cũ |
| 3 | `npm test` | pass |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-006 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Feature ở testing với execution id hợp lệ |
| Input | `phase-4-testing-result.md` theo template gốc, bảng Commands and Evidence khác nhau |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | PASS, một dòng `\| npm test \| 0 \| ok \|` | không có `testing_exit_code` |
| 2 | PASS, một dòng exit `1` | ERROR `testing_exit_code` |
| 3 | PASS, bảng không có dòng dữ liệu | ERROR `testing_exit_code` |
| 4 | PASS, ô exit là `N/A` | ERROR `testing_exit_code` |
| 5 | FAIL, một dòng exit `1` | không có `testing_exit_code` |
| 6 | PASS, hai dòng `0` và `0`, bảng có dòng dữ liệu ở section khác | không có `testing_exit_code` (chỉ đọc bảng dưới heading đúng) |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-007 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Temp dir có `package.json` với scripts `build`, `test`, `lint` |
| Input | `cmdInit` |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cmdInit` (defaults) | `AGENTS.md` tồn tại, chứa `npm test`, `npm run build`, `npm run lint`, `kf autoconfig`, `kanban ` |
| 2 | Sửa `AGENTS.md`, chạy `cmdInit` lần hai | nội dung sửa giữ nguyên |
| 3 | Temp dir mới chỉ có `CLAUDE.md` | `cmdInit` không tạo `AGENTS.md` |
| 4 | Temp dir không có manifest, `cmdInit --minimal` | `AGENTS.md` được tạo, có chỉ dẫn điền commands |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-008 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | Low |
| Preconditions | Repo sau implement |
| Input | Shell |
| Steps | See steps table below |
| Expected outcome | Như bảng bước |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `head CHANGELOG.md` | có `## [Unreleased]` và các mục FR |
| 2 | `node -p "require('./package.json').version"` | `0.2.0`; `kf --version` sau build cũng `0.2.0` |
| 3 | `grep -n "bash" README.md` | có ghi chú hooks cần bash / Windows |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | — |
| Input | `.kfw.json` không có `bypasses`; `.kfw.json` có `bypasses` sai kiểu |
| Steps | See steps table below |
| Expected outcome | Thiếu field → hợp lệ, validate không WARNING, status không in `Bypasses`; sai kiểu → `readFeatureMeta` throw `Invalid feature metadata` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Meta hợp lệ không có `bypasses` | không có issue `gate_bypassed`, text không có `Bypasses:` |
| 2 | Meta có `bypasses: "x"` | throw `Invalid feature metadata` |

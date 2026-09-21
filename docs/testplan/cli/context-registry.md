---
feature: "context-registry"
context: "cli"
created: "20260920_1350"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

Counts match the detailed cases below. Đây là contract; kết quả thực thi thuộc `phase-4-testing-result.md`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | context-registry |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), `npm run typecheck`, `npm run lint` |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 4 | 4 | TC-001 tới TC-004 |
| Integration | 9 | 9 | TC-005 tới TC-013, gọi thẳng các `cmd*` trong thư mục tạm |
| UI / E2E | 0 | 0 | Không có giao diện |
| **Total** | **13** | **13** | Suite hiện có (237) cũng phải xanh |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-003, FR-005, FR-006, FR-007 | TC-003, TC-004, TC-011, TC-012, TC-013 | 5 | Config hợp lệ sau init, cấu hình sai bị bắt, project cũ không bị đổi hành vi |
| UC-002 | FR-002 | TC-001, TC-002, TC-005, TC-006, TC-007 | 5 | Gõ nhầm bị chặn, gõ đúng vẫn chạy, chưa khai vẫn tự do |
| UC-003 | FR-004 | TC-008 | 1 | Brief có đủ ba ý |
| UC-004 | FR-004 | TC-009, TC-010 | 2 | Liệt kê đúng, nêu chỗ lệch, không ghi gì |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-003 | yes | — |
| FR-002 | UC-002 | TC-001, TC-002, TC-005, TC-006, TC-007 | yes | — |
| FR-003 | UC-001 | TC-004 | yes | — |
| FR-007 | UC-001 | TC-013 | yes | — |
| FR-004 | UC-003, UC-004 | TC-008, TC-009, TC-010 | yes | Chất lượng câu chữ trong brief không tự động kiểm được, chỉ kiểm được các ý bắt buộc có mặt |
| FR-005 | UC-001 | TC-011 | yes | — |
| FR-006 | UC-001 | TC-012 | yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Không |
| Input | `normalizeContext` với các biến thể hoa thường |
| Steps | See steps table below |
| Expected outcome | Chuẩn hoá về cùng một dạng, so sánh không phân biệt hoa thường |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chuẩn hoá `auth`, `Auth`, `AUTH` | Cả ba ra cùng một giá trị |
| 2 | Chuẩn hoá chuỗi đã chuẩn | Không đổi |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Không |
| Input | `suggestContext(input, declared)` |
| Steps | See steps table below |
| Expected outcome | Gợi ý đúng khi gần, im lặng khi xa |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `biling` với danh sách `[auth, billing, catalog]` | Gợi ý `billing` |
| 2 | `Auth` với cùng danh sách | Gợi ý `auth` |
| 3 | `zzzzzz` với cùng danh sách | Không gợi ý gì |
| 4 | Danh sách rỗng | Không gợi ý gì, không ném lỗi |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Không |
| Input | `.kf/config.json` với các giá trị `contexts` khác nhau |
| Steps | See steps table below |
| Expected outcome | Nhận cấu hình đúng, từ chối cấu hình sai kèm tên trường |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `contexts` vắng mặt | Đọc được, chế độ tự do |
| 2 | `contexts: ["auth","billing"]` với `defaultContext: "auth"` | Đọc được |
| 3 | `contexts: []` | Ném lỗi nêu `contexts` |
| 4 | `contexts: "auth"` (không phải mảng) | Ném lỗi nêu `contexts` |
| 5 | `contexts: ["auth","Auth"]` | Ném lỗi vì trùng sau chuẩn hoá |
| 6 | `contexts: ["au th"]` | Ném lỗi vì không qua `assertPathName` |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Không |
| Input | `effectiveDefaultContext(cfg)` với các hình dạng config khác nhau |
| Steps | See steps table below |
| Expected outcome | Đúng một nguồn sự thật cho context mặc định, không có hình dạng nào tạo ra cấu hình tự chặn chính nó |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `contexts: ["auth","billing"]`, không có `defaultContext` | Trả `auth` |
| 2 | `contexts: ["auth"]`, `defaultContext: "billing"` | Trả `auth`; `defaultContext` bị bỏ qua, **không** ném lỗi |
| 3 | `contexts` vắng mặt, `defaultContext: "legacy"` | Trả `legacy` |
| 4 | Cả hai vắng mặt | Trả giá trị mặc định cũ của công cụ |
| 5 | Với mọi hình dạng trên, kết quả luôn được rào chắn của `kf new` chấp nhận | Không tồn tại config nào mà mặc định bị chính nó từ chối |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm đã khai `contexts: ["auth","billing","catalog"]` |
| Input | `cmdNew` với `--context biling` |
| Steps | See steps table below |
| Expected outcome | Exit 1, không tạo gì, thông báo đủ ba phần |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdNew payment-retry --context biling` | Trả code 1 |
| 2 | Kiểm `.works/brainstorm/` | Không có thư mục nào được tạo |
| 3 | Đọc output | Có `biling`, có gợi ý `billing`, và có cả ba tên đã khai |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm đã khai `contexts: ["auth"]` |
| Input | `cmdNew` với `--context Auth` |
| Steps | See steps table below |
| Expected outcome | Bị từ chối, không sinh thư mục thứ hai |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdNew x --context Auth` | Trả code 1 |
| 2 | Đọc output | Gợi ý `auth` |
| 3 | Kiểm `.works/brainstorm/` | Rỗng |
| 4 | Chạy `cmdNew x --context auth` | Trả code 0, tạo được |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm **không** khai `contexts` |
| Input | `cmdNew` với một context bất kỳ |
| Steps | See steps table below |
| Expected outcome | Hành xử y hệt hôm nay |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdNew x --context anythinggoes` | Trả code 0 |
| 2 | Kiểm thư mục work item | Được tạo với context đó |
| 3 | Chạy `cmdNew y` không cờ | Dùng `defaultContext`, tạo được |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm chưa khai `contexts`, có sẵn vài work item |
| Input | `cmdContexts` |
| Steps | See steps table below |
| Expected outcome | Brief có đủ ba ý bắt buộc và danh sách đang dùng |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdContexts` | Trả code 0 |
| 2 | Đọc output | Nói rõ nhóm theo miền nghiệp vụ, không theo tầng kỹ thuật |
| 3 | Đọc output | Nêu số lượng đề xuất trong khoảng 3 tới 7 |
| 4 | Đọc output | Nói rõ trình cho người chốt, agent không tự ghi config |
| 5 | Đọc output | Có danh sách context đang dùng trên đĩa kèm số work item |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm khai `contexts: ["auth","billing"]`, có work item ở `auth` |
| Input | `cmdContexts` và `cmdContexts --json` |
| Steps | See steps table below |
| Expected outcome | Liệt kê đủ kèm số đếm, JSON trả cùng dữ liệu |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdContexts` | Có dòng `auth` kèm số work item lớn hơn 0 |
| 2 | Đọc tiếp | Có dòng `billing` kèm số 0, không coi là lỗi |
| 3 | Chạy `cmdContexts --json` | JSON parse được, chứa cùng hai context và cùng số đếm |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm khai `contexts: ["auth"]` nhưng có work item ở `legacy` tạo từ trước |
| Input | `cmdContexts` |
| Steps | See steps table below |
| Expected outcome | Nêu chỗ lệch, không ghi gì |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdContexts` | Đánh dấu `legacy` là đang dùng mà chưa khai |
| 2 | Đọc lại `.kf/config.json` | Nội dung không đổi, lệnh không tự thêm `legacy` |
| 3 | Chạy `cmdNew z --context legacy` | Vẫn bị từ chối, vì `legacy` chưa khai |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Thư mục tạm trống |
| Input | `cmdInit` với `--defaults`, và với câu trả lời giả lập |
| Steps | See steps table below |
| Expected outcome | Chỉ khai khi người nêu rõ; không nêu thì để tự do |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy `cmdInit --defaults` không cờ trên thư mục trống | `.kf/config.json` **không** có khoá `contexts`; `kf new --context bất-kỳ` vẫn chạy |
| 2 | Kiểm cấu hình vừa ghi | Đọc lại được, không invalid |
| 3 | Chạy `cmdInit --defaults --context cli` | `contexts` là `["cli"]` và `defaultContext` là `cli` |
| 4 | Chạy lại `cmdInit --defaults` trên project đã có `contexts` do người sửa tay | Giữ nguyên, không ghi đè |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-006 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Hai project tạm: một đã khai `contexts`, một chưa |
| Input | `cmdAutoconfig` |
| Steps | See steps table below |
| Expected outcome | Dòng checklist phản ánh đúng hai trạng thái |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Chạy trên project đã khai | Dòng checklist đánh dấu đã xong và liệt kê các context |
| 2 | Chạy trên project chưa khai | Dòng checklist đánh dấu chưa xong và gợi ý chạy `kf contexts` |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-007 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Project tạm đã có `.kf/config.json` kiểu cũ: có `defaultContext`, **không** có `contexts`, và có work item ở vài context khác nhau |
| Input | `cmdInit` với `--defaults` |
| Steps | See steps table below |
| Expected outcome | Nâng cấp công cụ rồi chạy lại init không được bật chế độ chặn trên dữ liệu đã có |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Đọc config trước khi chạy | Không có khoá `contexts` |
| 2 | Chạy `cmdInit --defaults` | Trả code 0 |
| 3 | Đọc lại config | Vẫn **không** có khoá `contexts`; project giữ chế độ tự do |
| 4 | Chạy `cmdNew x --context mộtcontextkhác` | Trả code 0, vì chưa khai thì không chặn |
| 5 | So sánh phần còn lại của config trước và sau | Không trường nào khác bị đổi ngoài những gì init vốn đã ghi |

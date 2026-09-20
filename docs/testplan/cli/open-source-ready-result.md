---
feature: "open-source-ready"
context: "cli"
tested: "20260920_1330"
execution: "63843775-2e01-4f9d-9e3f-84a399ec92a1"
status: PASS
---

# Testing Result

## Feature
open-source-ready

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node 20 tại chỗ; CI chạy lại trên Node 20 và 22
- Tooling: vitest 2.1, tsc 5.7, oxlint 1.81, npm pack, npm ci, bash script kiểm README và tarball

## Execution Time
Suite vitest 11.19s; script shell và smoke test harness chạy trong cùng lượt.

## Summary
| Metric | Result |
|---|---:|
| Total | 10 |
| Passed | 10 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | Không file `.ts` nào ngoài `src/tests/` chứa ký tự tiếng Việt | Danh sách vi phạm rỗng trên hơn 20 file | `leaves no Vietnamese in the shipped source` |
| TC-002 | Unit | PASS | 8 skill và mọi template sạch tiếng Việt, frontmatter còn nguyên | 8 skill đủ, mỗi file vẫn có `name` và `description` | `leaves no Vietnamese in the skills or the templates, and keeps every skill intact` |
| TC-003 | Integration | PASS | Dashboard `lang="en"`, tiêu đề mang tên gói mới, nhãn context và approval tiếng Anh, tên phase tiếng Anh | Work item thật không context cho nhãn `Unassigned`; ba nhãn approval đúng tiếng Anh; tám `PHASE_NAMES` sạch | `the dashboard page` (hai test) + `names every phase in English` |
| TC-004 | Unit | PASS | `name` `kanban-flow`, `version` `0.3.0`, `bin.kf` giữ nguyên, metadata đủ, LICENSE MIT, lock khớp | Đúng cả sáu; `node dist/index.js version` in `0.3.0` | `the published package` (bốn test) |
| TC-005 | Integration (shell) | PASS | README ≤120 dòng, tiếng Anh, có lệnh cài một dòng, giữ đường cài từ nguồn, bỏ câu repo private, mở bằng vấn đề, trỏ docs | 119 dòng; bảy kiểm tra đều ok | `verify.sh` mục TC-005 |
| TC-006 | Integration (shell) | PASS | Không khẳng định độc quyền; có nêu execution id và tổ hợp | Không khớp cụm độc quyền nào; cả hai cụm còn lại có mặt | `verify.sh` mục TC-006 |
| TC-007 | Integration (shell) | PASS | Tarball không chứa `src/`, `.works/`, `.kf/`, `.claude/`, `node_modules/`, `.github/`, ba thư mục canonical docs | Chín kiểm tra loại trừ đều ok | `verify.sh` mục TC-007 |
| TC-008 | Integration (shell) | PASS | Tarball có `dist/`, `skills/`, `docs/workflow/`, hai thư mục package, README, LICENSE, package.json | Tám kiểm tra bao gồm đều ok | `verify.sh` mục TC-008 |
| TC-009 | Unit | PASS | Không file tài liệu người đọc nào chứa tiếng Việt | 13 file, danh sách vi phạm rỗng | `leaves no Vietnamese in the documentation a reader reaches` |
| TC-010 | Unit | PASS | Mọi liên kết nội bộ trỏ tới file tồn tại, anchor còn sống | Kiểm hơn 10 liên kết, không cái nào hỏng | `point at files that exist, at anchors that exist` |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` | 0 | `Test Files 20 passed (20)` / `Tests 237 passed (237)` |
| `npm run typecheck` | 0 | `tsc -p tsconfig.json --noEmit` không in lỗi |
| `npm run lint` | 0 | `oxlint src` không in lỗi |
| `npm ci` rồi `npm test` | 0 | Cài sạch từ lockfile sau khi đổi tên gói, suite vẫn 237 pass |
| `npm run build && node dist/index.js version` | 0 | In `0.3.0` |
| `bash verify.sh` | 0 | `ALL SHELL CHECKS PASS`, 26 kiểm tra ok, 0 FAIL |
| `npm pack --dry-run` | 0 | `kanban-flow@0.3.0`, 89 file, 112.0 kB |
| Smoke test khối JSON trong README | 0 | Parse khối `harness` thẳng từ README, ghi vào `.kf/config.json` của project `kf init` thật, `kf harness` in `main role: architect (claude)` và chuỗi `brainstorm researcher → writer` |
| `bash e2e.sh` — chạy trọn khối lệnh README | 0 | Project tạm mới: viết đủ bảy artifact rồi chạy hết chuỗi, kết thúc `✓ Archived 'user-login' review → dones` với sáu canonical docs sync. Chạy lại sau các sửa vòng bốn, vẫn về đích. Đây là bằng chứng FR-004 "một ví dụ chạy được" đã thật sự chạy được. |

Mutation test cho nhãn dashboard nằm ngoài bảng trên vì nó **cố tình** tạo một lần fail, nên không có exit code 0 để ghi: đặt lại `"Không xác định"` trong `dashboard.ts` thì test `labels an item with no context…` fail (`Tests 1 failed | 10 skipped`), khôi phục thì pass (`Tests 1 passed | 10 skipped`). Đó là bằng chứng test không còn rỗng.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| Không có | — | — | — |

Sáu finding của review vòng một (execution `9c1007b0`) đã sửa và kiểm chứng lại từng cái:

| Finding | Sửa | Bằng chứng |
|---|---|---|
| FINDING-001 luật định tuyến bị làm hẹp | `skills/kanban-bug/SKILL.md:51` nói lại "FAIL hoặc REJECT, ở testing hoặc review" | Khớp `validate-reports.ts:80,105` áp cùng `/^(FAIL\|REJECT)/i` cho cả hai stage |
| FINDING-002 khối harness trong README không chạy | Thêm `runners` và đưa `architect` vào `roles` | Smoke test ở bảng trên: `kf harness` chấp nhận khối lấy thẳng từ README |
| FINDING-003 test không thể fail | Dựng work item thật không context trong thư mục tạm, assert `Unassigned` và ba nhãn approval | Mutation test nêu ngay dưới bảng lệnh |
| FINDING-004 chuỗi lệnh thiếu hai bước | Thêm `kf stage user-login testing` và `review` | `grep` xác nhận, và chuỗi giờ khớp sơ đồ ngay phía trên |
| FINDING-005 mất tên khoá `stages` | `dashboard.md:29` gọi lại đúng tên khoá | `kf view --json` thật sự trả khoá `stages` |
| FINDING-006 "a run of `xxx`" | Đổi thành "four or more `x`" | Khớp `x{4,}` trong `secrets.ts:19` |

FINDING-007 (CHANGELOG và BACKLOG còn tiếng Việt) nằm ngoài FR-008 nên để lại: đã ghi BACKLOG, và README nói thẳng CHANGELOG còn tiếng Việt thay vì để người đọc tự vấp.

Sáu finding của review vòng hai (execution `8f3282ad`) đều nằm trong README và đều đã sửa:

| Finding | Sửa | Bằng chứng |
|---|---|---|
| FINDING-008 chuỗi lệnh dừng ở bước thứ năm | Thêm dòng nói rõ phải tự đặt frontmatter `status: confirmed`, và đánh số ba quyết định của người dùng ngay trong khối lệnh | Chạy thật trên project tạm: viết spec với `status: confirmed` rồi `kf stage user-login planning` trả `✓ Moved 'user-login' brainstorm → planning`, exit 0 |
| FINDING-009 "`kf stage` là cách duy nhất" | Đổi thành "only the CLI moves it between stages" | Khớp `cancel.ts:107` và `archive.ts:226` cũng `rename` trực tiếp |
| FINDING-010 hứa usage ở bản text | `kf runs user-login --json` | `run.ts:151-152` không in usage ở bản text; `--json` thì có |
| FINDING-011 "Each stage owes an artifact" | "Most stages owe an artifact" | Khớp `gates.md:20`: implementation không có artifact bắt buộc |
| FINDING-012 "sends the item back to planning" | Nói đúng là chặn mọi transition cho tới khi approve lại | Khớp cơ chế `approval_changed` |
| FINDING-013 mất quyết định start/backlog | Nêu đủ ba quyết định của người dùng | Khớp `skills/kanban-plan/SKILL.md` mục 4 |

Bảy finding của review vòng ba (execution `1254064f`) đều nằm trong README và đều đã sửa:

| Finding | Sửa | Bằng chứng |
|---|---|---|
| FINDING-014 khối lệnh vẫn gãy ba chỗ | Trình bày lại đúng bản chất: chuỗi lệnh xen kẽ bảy bước viết artifact, nêu đủ cả feature report | `e2e.sh` chạy trọn tới `dones`, không vấp bước nào |
| FINDING-015 "every further transition is refused" | Nói đúng: không stage nào **tiến lên** nhận item cho tới khi quay về planning và approve lại | Khớp `stage.ts:61` validate như `brainstorm` khi đích là `planning`, và `cmdCancel` không gọi validate |
| FINDING-016 `DONE_WITH_CONCERNS` vẫn đi tiếp | Nêu đủ hai trạng thái được đi tiếp | Khớp `run.ts:272` `startsWith("DONE")` |
| FINDING-017 output file chỉ truyền khi role khai | Thêm điều kiện "a role that declares an `output` file" | Khớp `prompt.ts:135` |
| FINDING-018 "The CLI does not read the agent's summary" | Thu hẹp về đúng gate: "the gates do not read the agent's summary" | Harness vẫn đọc `STATUS:`, và mục harness nói rõ chuỗi phụ thuộc vào nó |
| FINDING-019 tuyệt đối hoá gate | Nêu `--force` và việc nó bị ghi vào `.kfw.json` | Khớp bypass trail |
| FINDING-020 sơ đồ thiếu `cancelled` | Thêm dòng `any stage → cancelled, with a reason on the record` | Khớp state machine |

Bốn finding của review vòng bốn (execution `ad140b10`) đã sửa:

| Finding | Sửa | Bằng chứng |
|---|---|---|
| FINDING-021 cả hai đường cài đều 404 | Đảo mục Install: đường cài từ nguồn lên trước vì nó chạy được, nói thẳng "not on npm yet", và giữ đúng chuỗi `npm install -g kanban-flow` cho lúc publish | `npm view kanban-flow` và `api.github.com/repos/phuthuycoding/kaban-flow` đều 404; đã ghi BACKLOG việc publish và mở repo |
| FINDING-022 `kf status` không liệt kê cái đang chặn | Nói đúng vai trò: `kf status` là checklist artifact, `kf validate` mới báo cái chặn | `status.ts` chỉ import `ARTIFACTS`; ghi BACKLOG vì `prompt.ts:131` bảo mọi worker tin vào `kf status` |
| FINDING-023 usage không phải run nào cũng có | "usage where reported" | Chỉ `config.ts:154,160` khai `usage: "json"`, tức claude và codex |
| FINDING-024 "a CLI plus a model plus its permission flags" | Mô tả runner đúng là một cách gọi CLI; nói rõ trỏ role sang runner có sẵn mới là một dòng | Không preset nào mang cờ model |

Cắt thêm hai dòng README để giữ trần 120 sau khi sáu sửa trên thêm dòng: gộp hai đoạn mở đầu, và rút gọn câu cuối đoạn "What is actually different". Không mất phát biểu nào. Một chỗ tự bắt được trong lúc sửa: bản nháp viết "ba quyết định, không cái nào là lệnh CLI", sai vì `kf approve` đúng là lệnh; đã bỏ mệnh đề đó.

Cắt bớt README để giữ trần 120 dòng sau khi hai finding thêm dòng: bỏ một câu trùng lặp về `kf init` seed preset, và một câu đã được nói ở mục "How it works". Không mất thông tin nào.

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage | N/A | N/A | Dự án không cài coverage tooling; gate của đợt này là suite xanh cộng typecheck cộng lint, đúng Test Strategy đã chốt ở Phase 1. |

## Regression
Suite cũ vẫn xanh sau khi sửa bốn assert chuỗi đã lỗi thời. Không assert nào bị nới lỏng: mỗi cái chỉ đổi sang chuỗi tiếng Anh tương ứng. Tổng test 226 lên 237. Thêm một bằng chứng regression mới: mutation test chứng minh bộ test bắt được việc lùi nhãn dashboard về tiếng Việt, điều mà bản test trước đó không làm được.

## Conclusion
- Cả 10 test case PASS trên execution `63843775`. Hai mươi ba finding qua bốn vòng review đã sửa, mỗi cái có bằng chứng riêng chứ không chỉ khai là đã sửa. Một finding (CHANGELOG và BACKLOG còn tiếng Việt) nằm ngoài contract nên được hoãn công khai, không giấu.

---
feature: "kf-doctor"
context: "cli"
tested: "20260921_1415"
execution: "20ef740f-789f-4cfe-8746-a798fe03a125"
status: PASS
---

# Testing Result

## Feature
kf-doctor

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node 20
- Tooling: vitest 2.1, tsc 5.7, oxlint 1.81, cộng hai lần chạy tay trên CLI đã build

## Execution Time
Suite 12s; bảy mutant chạy tuần tự sau đó.

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
| TC-001 | Integration | PASS | Chạy được từ thư mục con; ngoài project thì báo rõ, exit 1, không stack trace | Đúng cả hai | `runs from a subdirectory and refuses politely outside a project` |
| TC-002 | Integration | PASS | Thiếu stage dir → ERROR nêu đúng tên; file thay thư mục cũng tính là thiếu | Đúng cả hai | `names the stage directory that is missing`, `treats a file sitting where a stage directory belongs as missing` |
| TC-003 | Integration | PASS | Config JSON hỏng: không ném, ERROR nêu file, exit 1 | Đúng | `survives a config it cannot parse, which is the case it exists for` |
| TC-004 | Integration | PASS | Metadata rác → ERROR nêu tên item và đường dẫn | Đúng | `names the work item whose metadata cannot be read` |
| TC-005 | Integration | PASS | Skills bị xoá → ERROR kèm `kf install --agent claude` | Đúng | `reports skills that were installed and then deleted` |
| TC-006 | Integration | PASS | `defaultContext` cạnh `contexts` → WARNING, verdict vẫn pass | Đúng, exit 0 | `warns that defaultContext is ignored, without failing the verdict` |
| TC-007 | Integration | PASS | Item invalid không làm fail | `invalidItems > 0` mà `findings` rỗng và exit 0 | `does not call an invalid work item a broken project` |
| TC-008 | Integration | PASS | Lành exit 0; có ERROR exit 1 | Đúng | `finds nothing and exits 0`, `survives a config it cannot parse…` |
| TC-009 | Integration | PASS | `--json` cùng findings và cùng verdict | Mọi message trong JSON đều có trong bản text; exit code khớp | `gives --json the same findings and the same verdict as the text` |
| TC-010 | Integration | PASS | Chỉ đọc | Chụp toàn bộ cây (đường dẫn → nội dung) trước/sau: giống hệt | `changes nothing on disk` |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` | 0 | `Test Files 22 passed (22)` / `Tests 360 passed (360)` |
| `npm run typecheck` | 0 | Không in lỗi |
| `npm run lint` | 0 | Không in lỗi |
| `kf doctor` trên chính repo này | 0 | `No problems found.` / `Work items: 11, 0 not currently valid` / `✓ Healthy.` |
| `kf doctor` trên project dựng hỏng bốn chỗ, rồi `test $? -eq 1` | 0 | Phép khẳng định exit 0, tức doctor trả đúng mã 1. Bản thân doctor exit 1 ở đây là **kết quả đúng**. Output in đủ **bốn** ERROR trong một lượt (thiếu stage `testing`, config JSON hỏng, thiếu skill `kanban-plan`, metadata rác ở `junk_20260101_0000`), mỗi cái kèm lệnh sửa, rồi `✗ Problems found`. |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| Không có | — | — | — |

**Test mới bắt được một lỗi có sẵn, và phải sửa để feature này đạt chính AC của nó.** Ca "một file nằm chỗ stage directory" làm `listFeatures` ném `ENOTDIR`: `existsSync` trả true nên vòng lặp không bỏ qua, rồi `readdirSync` chết. Cùng họ với lỗi symlink đã vá ở `listfeatures-symlink-crash`, khác đường kích hoạt. Đã thêm `isDirectory()` (dùng `statSync(..., { throwIfNoEntry: false })`) để `listFeatures` bỏ qua stage path không phải thư mục — doctor báo riêng chuyện thiếu stage, nên không mất thông tin gì. Mutant J7 canh đúng chỗ này.

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code bao phủ | N/A | N/A | Không có coverage tooling; guard chứng minh bằng mutation. |

## Regression

| Mutant | Kết quả |
|---|---|
| J1 bỏ `try/catch` quanh `readProjectConfig` (config hỏng thì ném ra ngoài) | **chết** (3 failed) |
| J2 để item invalid làm fail verdict | **chết** (1 failed) |
| J3 để WARNING cũng làm fail | **chết** (2 failed) |
| J4 dừng chẩn đoán sau lỗi đầu tiên | **chết** (1 failed) |
| J5 không bao giờ cảnh báo `defaultContext` bị bỏ qua | **chết** (1 failed) |
| J6 cảnh báo cả khi chưa khai `contexts` | **chết** (1 failed) |
| J7 `listFeatures` vẫn đi qua stage path là file | **chết** (1 failed) |

Bảy mutant, không cái nào sống sót. J5 và J6 ở lượt đầu trả "no tests" vì bản mutant **không compile** — TypeScript tự chặn chúng qua type narrowing. Không tính đó là chết: đã viết lại thành bản compile được rồi mới kết luận.

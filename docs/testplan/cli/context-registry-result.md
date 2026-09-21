---
feature: "context-registry"
context: "cli"
tested: "20260921_1235"
execution: "ad5c08e5-de09-4667-9b16-1bb11f9583da"
status: PASS
---

# Testing Result

## Feature
context-registry

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node 20
- Tooling: vitest 2.1, tsc 5.7, oxlint 1.81

## Execution Time
Suite 12s; ma trận mutation sáu mutant chạy tuần tự sau đó.

## Summary
| Metric | Result |
|---|---:|
| Total | 70 |
| Passed | 70 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| F-081 | Integration | PASS | `--minimal --context` ghi `defaultContext` trên project đã có harness, và không dựng lại harness | `defaultContext: payments`, harness giữ nguyên, `kf new` đi về `payments` | `records and seeds a named context on a project kf init has already touched` |
| F-082 | Integration | PASS | Cả ba cây docs seed tại context người nêu | `requirement`, `use-cases`, `testplan` đều có `payments` | cùng test trên |
| F-083 | Integration | PASS | `countOf` khớp đúng chính tả | `Legacy` đếm 0, `legacy` nằm ở `undeclared` với 1 | `counts a declared name by its exact spelling, not by a case-folded match` |
| F-084 | Integration | PASS | Brief im lặng khi không có va chạm, và text khớp JSON | Không có `Before you write the list`, `json.brief === text` | `says nothing about collisions when there are none` |
| F-085 | Unit | PASS | Xoá nhánh chết không đổi hành vi case-only | Mọi test case-only vẫn đúng, gợi ý vẫn trả đúng tên đã khai | 69/69 xanh sau khi xoá |
| F-086 | Integration | PASS | Không ghi `defaultContext` khi `contexts` đã khai; docs vẫn seed tại context người nêu; mặc định không đổi | `defaultContext` vắng mặt, `docs/requirement/billing` có, `kf new` vẫn đi `auth` | `does not write a default the declared list would override` |
| F-089 | Manual | PASS | Hai khối comment gộp một, hành vi không đổi | 325/325 vẫn xanh sau khi gộp | `npm test` |
| Nhánh TTY | Integration | PASS | Có terminal thì hỏi thật, và `--context` được truyền vào câu hỏi | `onboardAnswers(dir, "payments")`, output không có `non-interactive` | `takes an explicit context to the question, and asks it when there is a terminal` |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` | 0 | `Test Files 21 passed (21)` / `Tests 325 passed (325)` |
| `npm run typecheck` | 0 | Không in lỗi |
| `npm run lint` | 0 | Không in lỗi |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| Không có | — | — | — |

Vòng review trước tìm ra FINDING-086 ngay trong chính bản vá F-081: `defaultContext` được ghi cả khi `contexts` đã khai, trong khi `declaredDefaultContext` trả `contexts[0]` trước nên trường đó không ai đọc. Đã thu hẹp guard và thêm ca test cho hình dạng "đã khai danh sách" — hình dạng mà tám mutant trước đó không chạm tới được vì không test nào dựng nó.

Vòng trước nữa em tuyên bố nhánh TTY "không test được" và bỏ qua. Reviewer chứng minh ngược lại; em nhận và đã viết test đó. Cách làm: `Object.defineProperty(process.stdin/stdout, "isTTY", { value: true, configurable: true })` để hai stream trông như terminal, `vi.spyOn` trên namespace module bootstrap để đứng thay câu hỏi, và khôi phục cả hai property descriptor trong `finally` để không rò sang test khác.

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code bao phủ | 80% | N/A | Dự án không cài coverage tooling; thay bằng mutation, xem Regression. |

## Regression

Ma trận mutation chạy tuần tự, backup theo đường dẫn đầy đủ trong thư mục tạm:

| Mutant | Kết quả |
|---|---|
| M1 `--minimal` bỏ qua khi đã có harness (đúng lỗi F-081) | **chết** (1 failed) |
| M2 cây docs bỏ qua `--context` | **chết** (3 failed) |
| M3 `countOf` fold case | **chết** (1 failed) |
| M4 cảnh báo va chạm luôn hiện | **chết** (1 failed) |
| M5 có TTY vẫn dùng defaults | **chết** (1 failed) |
| M6 không truyền `--context` vào câu hỏi | **chết** (1 failed) |
| M7 ghi `defaultContext` cả khi đã khai danh sách (đúng lỗi F-086) | **chết** (1 failed) |
| M8 không bao giờ ghi `defaultContext` | **chết** (2 failed) |

Tám mutant, không cái nào sống sót.

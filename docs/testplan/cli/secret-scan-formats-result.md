---
feature: "secret-scan-formats"
context: "cli"
tested: "20260921_1440"
execution: "dbc0b48e-249c-4e9d-a8e8-4fff0b1debc6"
status: PASS
---

# Testing Result

## Feature
secret-scan-formats

## Environment
- OS: macOS (Darwin 25.5.0, arm64)
- Runtime: Node 20
- Tooling: vitest 2.1, tsc 5.7, oxlint 1.81

## Execution Time
Suite 12s; sáu mutant chạy tuần tự sau đó.

## Summary
| Metric | Result |
|---|---:|
| Total | 6 |
| Passed | 6 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | JWT đủ ba đoạn bị bắt; một đoạn `eyJ` thì không | Đúng cả hai | `flags a JWT but not a lone base64 segment that merely starts with eyJ` |
| TC-002 | Unit | PASS | Slack và Discord webhook bị bắt; URL slack thường thì không | Đúng cả ba | `flags Slack and Discord webhook URLs` |
| TC-003 | Unit | PASS | Có mật khẩu thì bắt (kể cả không username); không mật khẩu thì không | Đúng cả bốn | `flags a connection string only when it actually carries a password` |
| TC-004 | Unit | PASS | Không hit nào chứa giá trị đầy đủ | `jwt` và `hunter2` đều vắng mặt trong hit | `never echoes the value it found` |
| TC-005 | Unit | PASS | `example` không miễn cho JWT/Slack; placeholder ở vị trí mật khẩu thì được miễn | Đúng cả hai chiều | `does not let a nearby word excuse…`, `lets documentation describe the connection-string format…` |
| TC-006 | Unit | PASS | Không false positive trên artifact thật của repo | 0 hit trên hơn 200 file `.md` trong `docs/`, `skills/`, `kanban-flow/`, `.works/` | `stays silent on every real work item and doc` |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm test` | 0 | `Test Files 22 passed (22)` / `Tests 367 passed (367)` |
| `npm run typecheck` | 0 | Không in lỗi |
| `npm run lint` | 0 | Không in lỗi |
| Quét tay toàn bộ `.md` của repo bằng `findSecretLike` | 0 | `quét 206 file, 0 hit` sau khi che ví dụ trong chính spec này |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| Không có | — | — | — |

**Feature này tự bắt lỗi thiết kế của chính nó, và đó là phần đáng giá nhất của lượt test.** Bản đầu đánh dấu cả bốn mẫu là high-confidence. Khi quét toàn repo để kiểm FR-006, tám hit hiện ra — **tất cả nằm trong spec của chính feature này**, vì nó mô tả định dạng connection string. Em che các ví dụ đi, rồi còn đúng một hit: dòng FR-003 viết `scheme://user:<password>@host`.

Đó không phải nhiễu, mà là bằng chứng mẫu sai. Ba mẫu kia (`eyJ…`, host Slack, host Discord) có **tiền tố chỉ credential thật mới mang**, nên không lời lẽ nào nên miễn cho chúng. Connection string thì không có dấu hiệu nào như vậy — nó thuần là hình dạng URL, thứ mà template lương thiện cũng có. Để nó high-confidence nghĩa là **gate từ chối chính tài liệu giải thích nó**. Đã chuyển sang `high: false`; hợp đồng được sửa để thêm FR-005b nêu rõ lý do, `Approval: changed` bật lên, item quay về `planning` duyệt lại.

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code bao phủ | N/A | N/A | Không có coverage tooling; chứng minh bằng mutation. |

## Regression

| Mutant | Kết quả |
|---|---|
| K1 JWT chỉ cần tiền tố `eyJ`, không đòi ba đoạn | **chết** (1 failed) |
| K2 connection string trở lại high-confidence | **chết** (2 failed) |
| K3 bắt mọi URL thay vì chỉ URL có mật khẩu | **chết** (3 failed) |
| K4 bỏ hẳn mẫu JWT | **chết** (1 failed) |
| K5 bỏ hẳn mẫu connection string | **chết** (2 failed) |
| K6 bắt mọi URL trên host Slack, không chỉ webhook | **chết** (1 failed) |

Sáu mutant, không cái nào sống sót. K3 và K6 là hai cái quan trọng nhất: chúng dựng mẫu **quá tham**, và cả hai bị test quét-toàn-repo bắt. Một gate báo nhầm sẽ dạy người ta `--force` đi qua, và lúc đó nó tệ hơn cả không có.

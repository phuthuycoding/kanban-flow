---
feature: "workflow-hardening"
context: "cli"
tested: "20260919_1748"
execution: "9457b8cc-75bb-448d-ad7d-1c49fa0242d8"
status: PASS
---

# Testing Result

## Feature
workflow-hardening

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0 (engines floor 20; Node 20 chỉ được chạy trên CI sau push)
- Tooling: vitest 2.1.9, tsc 5.7, oxlint 1.81, bash

## Execution Time
2026-09-19 17:45 – 17:48, execution thứ hai sau review REJECT (toàn bộ suite 1.16s)

## Summary
| Metric | Result |
|---|---:|
| Total | 13 |
| Passed | 13 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | 9 dòng `kf ...` trong guide parse được, không còn `--to`/`ctx/name` | 9/9 parse, hai chuỗi sai không xuất hiện | `autoconfig.test.ts > prints a workflow guide whose commands the CLI parser accepts` |
| TC-002 | Integration | PASS | Config `stacks` thắng auto-detect | `Configured stacks: go`, không có `node`; bỏ config → `Detected stacks: node` | `autoconfig.test.ts > prefers configured stacks over auto-detection` |
| TC-003 | Unit | PASS | 4 secret thật kèm từ placeholder đều bị flag, hit che giá trị | 4/4 hit, hit chứa `ghp_…` không chứa token | `secrets.test.ts > flags real secrets even when the line mentions a placeholder word` (5 test) |
| TC-004 | Unit | PASS | 7 placeholder không flag, PEM header vẫn flag | 7/7 = 0 hit, PEM = 1 hit | `secrets.test.ts > keeps accepting placeholder values` (8 test) |
| TC-005 | Integration | PASS | `--force` khi gate fail ghi `bypasses[0]` đúng, validate WARNING, status/json hiển thị | Đúng như expected, `codes` chứa `requirement_unconfirmed` | `bypass.test.ts > records --force when the gate actually failed and surfaces it everywhere` |
| TC-006 | Integration | PASS | Không ghi khi không bỏ qua gì; `--skip-hooks` ghi `hook:<path>` | `bypasses` undefined; sau đó `["force","skip-hooks"]` | `bypass.test.ts > records nothing when --force/--skip-hooks skipped nothing, and records a skipped hook` |
| TC-007 | Integration | PASS | `metrics.bypassed` = 1, view text `Bypassed: 1`, HTML có KPI | Đúng | `bypass.test.ts > counts bypassed items in view and dashboard data` |
| TC-008 | Integration (shell) | PASS | ci.yml đúng cấu trúc; typecheck bắt lỗi kiểu trong test; build không emit test | `node: [20, 22]`, 3 step có mặt; typecheck với lỗi cố ý exit 2; `dist/` không có `tests/` | Bảng lệnh bên dưới |
| TC-009 | Integration (shell) | PASS | Mọi file `src/workflow/*.ts` < 500 dòng, suite cũ pass | File lớn nhất 200 dòng (`features.ts`); 136 test cũ pass, chỉ đổi fixture (xem Regression) | Bảng lệnh bên dưới |
| TC-010 | Unit | PASS | 6 tình huống exit code | 7 test pass (6 tình huống + parser đọc đúng heading) | `reports.test.ts > testing_exit_code` (7 test) |
| TC-011 | Integration | PASS | AGENTS.md tạo đúng, không ghi đè, bỏ qua khi có CLAUDE.md, --minimal có bảng TODO | 5 test pass: node scripts + không ghi đè, `npm install` khi không có lockfile, bỏ qua khi có CLAUDE.md, --minimal, package.json hỏng → throw `Invalid JSON` | `agents-file.test.ts > kf init seeds AGENTS.md` |
| TC-012 | Integration (shell) | PASS | CHANGELOG Unreleased, version 0.2.0, README ghi chú bash/Windows | `## [Unreleased]` có; `kf --version` = 0.2.0; README có "Git Bash" | Bảng lệnh bên dưới |
| TC-013 | Unit | PASS | Meta thiếu `bypasses` hợp lệ; sai kiểu bị từ chối | Đúng, kể cả `from: "nowhere"` bị từ chối | `bypass.test.ts > treats missing bypasses as none and rejects a malformed list` |

Toàn bộ suite: 14 file, 167 test pass (136 cũ + 31 mới). Tên test mô tả hành vi, không nhúng mã TC (theo review FINDING-001); mapping TC → test nằm ở bảng này.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npm run typecheck | 0 | tsc trên `src/` gồm `src/tests/**`, không lỗi |
| npm run lint | 0 | oxlint `src`, không cảnh báo |
| npx vitest run | 0 | Test Files 14 passed, Tests 167 passed, Duration 1.16s |
| npm run build | 0 | `dist/` gồm cli dashboard index.js integrations project shared workflow; không có `tests/` |
| node dist/index.js --version | 0 | `0.2.0` |
| wc -l src/workflow/*.ts | 0 | max 200 dòng (`features.ts`), tổng 1062 |
| grep -cE 'node: \[20, 22\]' .github/workflows/ci.yml | 0 | `1`; các step typecheck/lint/test có mặt (dòng 21–23) |

Kiểm tra ngược (không đưa vào bảng vì exit code kỳ vọng khác 0): thêm `const wrong: number = "a"` vào `args.test.ts` → `npm run typecheck` exit 2 với 1 `error TS`; hoàn tác, `git diff --quiet` xác nhận file về nguyên trạng.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — | Không có | — | — |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Overall code coverage | N/A | N/A | Repo không có coverage tooling (theo Test Strategy đã duyệt); gate thay thế = suite xanh + typecheck + lint, cả ba đạt |

Do not equate test pass rate with code coverage. Use `N/A` with a reason for an unrequired metric; required but unmeasured coverage blocks PASS.

## Regression
- 136 test có sẵn pass. Ba fixture phải cập nhật do contract mới, không sửa assertion: `workflow.test.ts` và `status.test.ts` thêm bảng Commands and Evidence vào report PASS mẫu (FR-006); `dashboard.test.ts` thêm `bypassed: 0` vào object metrics kỳ vọng (FR-003). Không có assertion cũ nào bị nới.
- Dogfood: gate mới chặn chính contract của feature này (3 dòng ví dụ token trong spec/test plan) → quay về planning, sửa cách diễn đạt, duyệt lại. Không dùng `--force`; `kf status` không ghi bypass nào cho work item này.
- CI trên GitHub chỉ chạy được sau push; chưa kiểm chứng trên Node 20 thật (chỉ Node 22 local).
- Repair loop 1 (review REJECT): đổi tên test bỏ mã TC-###, `AGENTS.md` seed `npm install` khi không có lockfile (+1 test). Toàn bộ suite chạy lại cho execution này.

## Conclusion
- PASS: 13/13 TC đạt, suite 167/167, typecheck (gồm test) + lint + build sạch, `kf --version` 0.2.0. Giới hạn: Node 20 và CI runner chưa chạy thật cho tới khi push.

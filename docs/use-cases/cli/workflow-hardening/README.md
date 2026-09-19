---
feature: "workflow-hardening"
context: "cli"
created: "20260919_1206"
status: planning
---

# Use Case Index

Mỗi use case là một file riêng trong thư mục `use-cases/`, không viết narrative gộp trong file này.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Agent đọc briefing autoconfig và chạy lệnh trong guide | [UC-001](UC-001.md) | Agent | planned |
| UC-002 | Validator chặn secret thật dù dòng có từ placeholder | [UC-002](UC-002.md) | Agent | planned |
| UC-003 | Agent bypass gate, dấu vết được ghi và hiển thị | [UC-003](UC-003.md) | Agent | planned |
| UC-004 | CI chạy typecheck, lint, test trên push/PR | [UC-004](UC-004.md) | GitHub Actions runner | planned |
| UC-005 | Validator chặn report PASS có exit code khác 0 | [UC-005](UC-005.md) | Agent | planned |
| UC-006 | `kf init` seed AGENTS.md, giữ nguyên file đã có | [UC-006](UC-006.md) | Người vận hành | planned |
| UC-007 | Người vận hành đọc CHANGELOG và version mới | [UC-007](UC-007.md) | Người vận hành | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001 | TC-001, TC-002 | Guide parse được; stacks lấy từ config |
| UC-002 | FR-002, FR-005 | TC-003, TC-004, TC-009 | Secret thật bị flag, placeholder không; validator đã tách và suite xanh |
| UC-003 | FR-003 | TC-005, TC-006, TC-007, TC-013 | Bypass ghi/không ghi đúng lúc; status, validate, view hiển thị; meta cũ an toàn |
| UC-004 | FR-004 | TC-008 | Workflow tồn tại; typecheck bắt lỗi trong test |
| UC-005 | FR-006, FR-005 | TC-010 | PASS cần exit code 0 và ít nhất một lệnh |
| UC-006 | FR-007 | TC-011 | AGENTS.md được tạo đúng, không ghi đè |
| UC-007 | FR-008 | TC-012 | CHANGELOG, version, README note có mặt |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 7 |
| Actors | 3 |
| Functional requirements covered | 8 |
| Test cases linked | 13 |

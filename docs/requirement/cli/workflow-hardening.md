---
feature: workflow-hardening
context: cli
created: 20260919_1205
kind: feature
status: archived
---
# Spec Requirement

## Feature
workflow-hardening

## Objective
Đóng các lỗ hổng làm `kf` không còn "fail-closed" như README hứa (agent bypass gate không dấu vết, secret scan bị lách, briefing dạy sai cú pháp), thêm CI và tách validator để codebase đạt chuẩn bàn giao.

## Problem Statement
Review ngày 2026-09-19 trên `main` tìm thấy 3 lỗi đã kiểm chứng (autoconfig in sai cú pháp lệnh, `--force`/`--skip-hooks` không để lại dấu vết, secret exemption kiểm tra cả dòng nên một từ `example` là lách được), cộng với các thiếu sót cấu trúc: không có CI, test không được typecheck, `validate.ts` 521 dòng với một hàm ~400 dòng, `kf init` chưa seed `AGENTS.md`, chưa có CHANGELOG và version vẫn 0.0.1. Công cụ bán ý tưởng "gate như CI" nhưng bản thân chưa có CI và chưa dogfood.

## Scope
### In Scope
- Sửa 3 lỗi đã kiểm chứng: autoconfig guide, secret exemption, audit trail cho bypass flag.
- GitHub Actions chạy typecheck, lint, test trên Node 20 và 22; test files được typecheck.
- Tách `src/workflow/validate.ts` theo trách nhiệm, không đổi hành vi.
- Validator ép exit code 0 cho report testing-result có `status: PASS`.
- `kf init` seed `AGENTS.md` khi chưa có.
- CHANGELOG.md, bump version, ghi chú Windows trong README.
- Dogfood: work item này đi qua đúng pipeline kaban-flow trong repo này.

### Out of Scope
- `kf` tự chạy test command (BACKLOG P1) — scope lớn, cần quyết định mức tin agent riêng.
- Locking multi-agent (BACKLOG P2).
- Đổi ngôn ngữ README sang tiếng Anh — quyết định của đại ca, không tự làm.
- Ghi tty/argv vào `kf approve` để phân biệt người và agent — chưa có cách chứng minh, không làm nửa vời.
- Đổi hành vi của bất kỳ gate hiện có ngoài các FR bên dưới.

## Actors
- Agent (Claude/Codex/...) chạy `kf` để đi qua pipeline.
- Người vận hành (đại ca) duyệt contract, đọc CHANGELOG, chạy CI.
- GitHub Actions runner.

## Functional Requirements
### FR-001
- Requirement: `kf autoconfig` sinh phần "Workflow guide" từ chuỗi help đã đăng ký trong `src/cli/args.ts`, không còn khối text viết tay; mọi lệnh in ra phải parse được bởi `parseArgsCli`. Phần "Detected stacks" ưu tiên `stacks` trong `.kf/config.json` khi có, chỉ auto-detect khi config chưa đặt.
- Priority: must
- Notes: Lỗi hiện tại: guide in `kf stage --to <stage> --change <c/n>`, `kf approve --change`, `kf new <context> <name>` — CLI không nhận. Đây là briefing cho agent mới nên sai ngay bước đầu.

### FR-002
- Requirement: Secret scan chỉ miễn (placeholder exemption) khi **chính giá trị bắt được** trông giống placeholder, không phải khi bất kỳ chỗ nào trên dòng có từ như `example`. Các pattern độ tin cậy cao (`ghp_`/`github_pat_`, `sk-`, `AKIA`, `xox*-`, `-----BEGIN ... PRIVATE KEY-----`) không bao giờ được miễn.
- Priority: must
- Notes: Dòng dạng `TOKEN=…  # example for prod` (GitHub token thật kèm comment example) hiện đi qua validate với kết quả valid. Giữ nguyên tắc: không flag placeholder thật, không echo giá trị secret ra output.

### FR-003
- Requirement: Khi `kf stage`/`kf archive` chạy với `--force` hoặc `--skip-hooks` (và thực sự có gate/hook bị bỏ qua), CLI ghi một bản ghi vào `.kfw.json` (`bypasses[]`: thời điểm, from/to, flag, mã lỗi gate bị bỏ qua). `kf validate` báo WARNING `gate_bypassed` khi có bản ghi; `kf status` hiển thị số lần bypass; `kf view --json` và dashboard đếm số work item có bypass.
- Priority: must
- Notes: Đây là răn đe và truy vết, không phải bảo đảm: agent vẫn sửa được file JSON. Ghi rõ giới hạn này trong docs/gates.md.

### FR-004
- Requirement: Repo có workflow GitHub Actions chạy `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` trên Node 20 và 22 cho mọi push và pull request. Lệnh `npm run typecheck` phải bao gồm cả `src/tests/**/*.test.ts`.
- Priority: must
- Notes: Hiện `tsconfig.json` exclude test; vitest không type-check. Build (`npm run build`) vẫn không emit test.

### FR-005
- Requirement: `src/workflow/validate.ts` được tách thành các module theo trách nhiệm (secret scan, artifact/gate, approval, report semantics, traceability, direction gate) sao cho không file nào vượt 500 dòng và không hàm nào vượt ~120 dòng. Public API hiện có (`validateFeature`, `checkDirectionGate`, `findSecretLike`, `renderValidateText`, `validateToJson`, types) giữ nguyên đường import `../workflow/validate.js`. Toàn bộ test hiện có pass không sửa.
- Priority: must
- Notes: Refactor thuần; các fix FR-002/FR-006 đặt vào module mới sau khi tách.

### FR-006
- Requirement: Với `phase-4-testing-result.md` có `status: PASS`, validator yêu cầu bảng "Commands and Evidence" có ít nhất một dòng lệnh và mọi cột "Exit code" bằng `0`; vi phạm là ERROR `testing_exit_code`. Report không PASS không bị ràng buộc này.
- Priority: should
- Notes: Không chứng minh test thật đã chạy, nhưng bắt được report bịa nhanh: PASS mà exit code khác 0 hoặc không có lệnh nào.

### FR-007
- Requirement: `kf init` (cả onboarding lẫn `--minimal`) tạo `AGENTS.md` ở project root khi file chưa tồn tại, gồm: build/test/lint commands suy ra từ stack đã detect (node: đọc `package.json` scripts), quy ước workflow kaban-flow (một lệnh `kanban {context} {feature}`, hai human gate), và pointer tới `kf autoconfig`. Không bao giờ ghi đè `AGENTS.md` hoặc `CLAUDE.md` đã có.
- Priority: should
- Notes: BACKLOG P2. Checklist trong `kf autoconfig` đã coi `AGENTS.md`/`CLAUDE.md` là mục cần có.

### FR-008
- Requirement: Thêm `CHANGELOG.md` (Keep a Changelog, mục Unreleased liệt kê thay đổi của feature này và các thay đổi chưa release trên `main`), bump `package.json` version lên `0.2.0`, README ghi rõ phase hooks cần `bash` (Windows: dùng WSL/Git Bash). BACKLOG.md cập nhật các mục đã xong.
- Priority: should
- Notes: Tag git đang ở `v2.0.0` từ thời bản shell; bản TypeScript rewrite đang 0.0.1. Đại ca quyết ở planning: `0.2.0` — bản TypeScript rewrite giữ dòng `0.x`, không nối tiếp tag `v2.0.0` của bản shell.

## Non-Functional Requirements
- Zero runtime dependency giữ nguyên; chỉ được thêm devDependency nếu thật sự cần (không cần cho scope này).
- `kf status --all` vẫn dưới 100ms trên repo nhỏ; không thêm I/O đáng kể vào đường validate.
- Không đổi format `.kfw.json` theo cách làm metadata cũ bị invalid: `bypasses` là optional.
- Output không echo giá trị secret.

## Main Use Cases
- UC-001 Agent mới vào project đọc `kf autoconfig` và chạy lệnh trong guide thành công
- UC-002 Validator chặn secret thật dù trên dòng có từ placeholder
- UC-003 Agent bypass gate bằng `--force`/`--skip-hooks`, dấu vết được ghi và hiển thị
- UC-004 CI chạy typecheck, lint, test trên push/PR
- UC-005 Validator chặn report PASS có exit code khác 0
- UC-006 `kf init` seed `AGENTS.md` cho project mới, giữ nguyên file đã có
- UC-007 Người vận hành đọc CHANGELOG và version mới

## Constraints
- Tuân thủ quy tắc repo: không reformat, không đổi tên hàm/file ngoài phạm vi, không nuốt lỗi, file dưới 500 dòng.
- Không commit/push tự động; kết thúc pipeline báo trạng thái uncommitted.
- Không đụng 10 file đang sửa dở trên working tree ngoài phần liên quan trực tiếp tới FR (autoconfig.ts, args.ts, README.md, docs/workflow/cli-reference.md nằm trong số đó — chỉ sửa đúng dòng cần).

## Assumptions
- Lời "ok tách branch rồi làm tất cả các mục" của đại ca là xác nhận requirement Phase 1 cho đúng danh sách đã trình bày; spec này chỉ chuyển danh sách đó thành FR, không thêm mục mới.
- Branch làm việc: `feat/hardening-and-ci`, đã tách từ `main`.
- Node 20 là floor (`engines.node >= 20`), CI thêm 22 để khớp máy dev.

## Acceptance Criteria
- [ ] `kf autoconfig` in guide mà mọi dòng `kf ...` đều parse được bởi `parseArgsCli` (test tự động lặp qua từng dòng).
- [ ] `TOKEN=ghp_<36 ký tự>  # example for prod` bị flag `artifact_secret`; `API_KEY={key}`, `Bearer <token>`, `TOKEN=changeme` vẫn không bị flag.
- [ ] Sau `kf stage x planning --force` trên spec chưa đạt gate, `.kfw.json` có `bypasses[0].flag === "force"`; `kf validate` in WARNING `gate_bypassed`; `kf view --json` có `metrics.bypassed >= 1`.
- [ ] `--force` khi gate đang pass không tạo bản ghi bypass.
- [ ] `.github/workflows/ci.yml` tồn tại, matrix node 20/22, ba bước typecheck/lint/test; `npm run typecheck` báo lỗi khi cố tình đưa lỗi kiểu vào một file test.
- [ ] `wc -l` mọi file dưới `src/workflow/` dưới 500; `npm test` pass không sửa test hiện có.
- [ ] testing-result `status: PASS` với dòng `| npm test | 1 | ... |` bị `testing_exit_code`; với `| npm test | 0 | ... |` không bị; `status: FAIL` với exit code 1 không bị.
- [ ] `kf init --defaults` trên project node tạo `AGENTS.md` có các script từ `package.json`; chạy lần hai không ghi đè nội dung đã sửa.
- [ ] `CHANGELOG.md` có mục Unreleased; `package.json` version `0.2.0`; README có ghi chú bash/Windows.

## Edge Cases
- `.kfw.json` cũ không có `bypasses`: validate/status coi như không bypass.
- `--force` nhưng cả validation lẫn direction gate đều pass: không ghi bypass (tránh nhiễu).
- `--skip-hooks` nhưng không có hook nào resolve được: không ghi bypass.
- Secret value chính là placeholder (`ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`): pattern cao chỉ khớp ký tự hợp lệ, `x` lặp được coi là placeholder nhờ regex placeholderish áp lên **value** — cần test riêng.
- Bảng Commands and Evidence có ô Exit code là `N/A` hoặc trống khi PASS: coi là vi phạm (PASS phải có bằng chứng số).
- `AGENTS.md` không có nhưng `CLAUDE.md` có: vẫn tạo `AGENTS.md`? Quyết định: **không tạo** khi đã có `CLAUDE.md` (tránh hai file hướng dẫn agent lệch nhau); ghi trong output.
- Project không detect được stack: `AGENTS.md` vẫn được tạo với phần commands để trống kèm chỉ dẫn điền.

## Open Questions
- Version: đã quyết `0.2.0`.
- `.claude/skills/` và `.kf/` do `kf init` tạo trong chính repo này: commit hay ignore? Mặc định: `.kf/` commit (config + templates của repo), `.claude/skills/` ignore vì trùng `skills/` gốc.

## Test Strategy
- Level: unit+integration
- UI Tests: none (CLI, không có UI ngoài dashboard HTML đã có test sẵn)
- Tools: vitest (`npm test`), `npm run typecheck`, `npm run lint`; integration = command handlers chạy trên temp dir như test hiện có
- Coverage Target: N/A — repo không có coverage tooling; gate là toàn bộ suite xanh + typecheck + lint

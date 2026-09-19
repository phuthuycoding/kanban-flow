# Changelog

Format theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/). Version theo SemVer; dòng `0.x` là bản TypeScript rewrite (tag `v1.x`/`v2.x` cũ thuộc bản shell install).

## [Unreleased]

## [0.2.0] - 2026-09-19

### Added
- `.kfw.json` ghi `bypasses[]` mỗi lần `--force`/`--skip-hooks` thực sự bỏ qua gate hoặc hook; `kf validate` cảnh báo `gate_bypassed`, `kf status` in `Bypasses:`, `kf view --json` và dashboard có `metrics.bypassed`.
- Validator lỗi `testing_exit_code`: report testing `PASS` phải có bảng Commands and Evidence với ít nhất một lệnh và mọi exit code bằng `0`.
- `kf init` seed `AGENTS.md` (commands từ manifest + quy ước workflow); không ghi đè `AGENTS.md`/`CLAUDE.md` có sẵn.
- GitHub Actions CI: typecheck, lint, test trên Node 20 và 22.
- `CHANGELOG.md`.

### Changed
- `kf autoconfig` sinh mục Workflow guide từ help string của parser (trước đây text viết tay in sai cú pháp `kf stage --to`, `kf approve --change`, `kf new <context> <name>`); ưu tiên `stacks` trong `.kf/config.json` trước auto-detect.
- Secret scan: placeholder exemption chỉ áp lên giá trị bắt được, không áp lên cả dòng; nhóm pattern độ tin cậy cao (`ghp_`, `sk-`, `AKIA`, `xox*-`, PRIVATE KEY) chỉ được miễn khi giá trị bị che (`xxxx`/`****`). Hit trả về đã che giá trị.
- `npm run typecheck` bao gồm `src/tests/**`; build dùng `tsconfig.build.json` nên `dist/` không đổi.
- `src/workflow/validate.ts` tách thành `findings`, `secrets`, `validate-artifacts`, `validate-approval`, `validate-reports`, `validate-traceability`, `direction`; import path và API giữ nguyên.
- Help string của `kf status`, `kf instruct`, `kf validate` có mô tả.
- README: ghi chú hook `.sh` cần `bash` (Windows: WSL/Git Bash), nhắc `npm run build` sau `git pull`.

### Unreleased on `main` before this version
- Project-only skills, `kf install`/`uninstall --purge`, `kf autoconfig`, monorepo stack detect + `kf rules`, secret scan `artifact_secret`, AI-risk lens trong kanban-review, placeholder detection bỏ qua code span.

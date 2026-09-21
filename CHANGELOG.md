# Changelog

Format theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/). Version theo SemVer; dòng `0.x` là bản TypeScript rewrite (tag `v1.x`/`v2.x` cũ thuộc bản shell install).

## [Unreleased]

### Added
- **Multi-agent harness theo vai trò.** Block `harness` trong `.kf/config.json` với ba lớp `stage → role → runner`: `roles` map vai (writer, coder, tester…) tới runner kèm `brief` đưa vào prompt và `output` là file vai phải viết; `stages` gán một role hoặc **chuỗi role chạy tuần tự** cho từng stage; `runners` là argv template của từng CLI/model kèm cách lấy session và đọc usage. Đổi model cho một vai chỉ sửa một dòng, stage không đụng tới.
- `kf run <feature>` chạy chuỗi role của stage hiện tại như worker headless (blocking hoặc `--detach` với supervisor), `--role` chạy một vai, `--fresh`, `--timeout`, `--dry-run`. Role không kết thúc `DONE` thì dừng chuỗi, các vai sau không chạy.
- Session giữ theo **work item + role** (`.kfw.json.sessions`) nên vòng sửa resume đúng phiên và hai vai dùng chung một CLI không lẫn ngữ cảnh. `runs[]` ghi role, runner, vị trí trong chuỗi, exit code, `STATUS:` và usage khi CLI trả về.
- `kf runs` liệt kê run kèm tiến độ chuỗi và đánh dấu `chain stopped i/n` khi một chuỗi đứt giữa chừng; `kf harness` in ba lớp và runner nào có CLI trên PATH; `kf status` in vai được gán; `kf view` gom `metrics.runs.byRole` và usage theo vai.
- Preset runner cho claude, codex, devin (đã chạy thật ngày 2026-09-19), gemini, opencode; `kf init` seed sáu vai architect/researcher/writer/coder/tester/reviewer. Docs `docs/workflow/harness.md`.
- **Stage `cancelled` và lệnh `kf cancel`.** Lối ra thứ hai cho work item: dừng hẳn với `--reason` bắt buộc, lưu `cancellation { at, by, reason, fromStage }` trong `.kfw.json`, mở lại bằng `kf stage <feature> <fromStage>`. Stage này nằm ngoài trục tuyến tính (`STAGE_INDEX = -1`) nên không bị đòi artifact, approval hay report; đổi lại thiếu lý do là `cancellation_missing`. Chặn khi còn worker run đang chạy, chạy hook `cancelled.sh`, liệt kê canonical docs của item đã archive và chỉ xoá khi `--purge-docs` kèm xác nhận. `kf view`/dashboard đếm riêng và loại cancelled khỏi mẫu số `completionRate`.
- Vitest `globalSetup` build `dist/` trước khi test (test detach cần CLI thật).

### Fixed
- **Item huỷ từ `brainstorm` không bao giờ validate được.** Kiểm tra `requirement_unconfirmed` nằm ngoài vòng lặp gate và không có guard theo stage, nên nó bắn cả với `cancelled` — mà huỷ từ `brainstorm` là lúc requirement còn `pending`. Hậu quả: `kf validate --all` hỏng vĩnh viễn trong CI, và **chính lệnh mở lại mà `kf cancel` in ra bị từ chối**. Nay `cancelled` chỉ bị hỏi đúng hai thứ: lý do huỷ, và bản ghi bypass nếu có; và kiểm tra requirement được giới hạn vào những stage thật sự nợ nó.
- Mở lại một item huỷ từ `dones` từng **kẹt vĩnh viễn**: `kf stage <x> dones` định tuyến sang archive, mà archive từ chối item đã huỷ trước cả khi nhìn tới `--force`. Nay mở lại là trả item về chỗ cũ: `status: "archived"` được khôi phục và canonical docs được archive re-sync, vì `--purge-docs` có thể đã xoá chúng.
- `requirement_unconfirmed` không còn bắn nhầm ở `dones`, `review` và `backlog` với câu chữ "before leaving brainstorm", nhưng vẫn giữ nguyên độ chặt ở `planning`, nơi `kf approve` validate.

### Changed
- **Đổi tên gói `kaban-flow` → `kanban-flow`**, version `0.3.0`. Binary vẫn là `kf`, thư mục dữ liệu vẫn là `.kf/` và `.works/`. Gỡ CLI: `npm rm -g kanban-flow`.
- **Bề mặt người dùng chuyển hết sang tiếng Anh**: `PHASE_NAMES` cho `backlog`/`cancelled`, nhãn context và approval của dashboard, toàn bộ HTML dashboard (`lang="en"`), ba skill `kanban-bug`/`kanban-brainstorm`/`kanban-plan`, template `phase-2-use-case-specification.md`, `README.md`, `docs/README.md`, `kanban-flow/README.md` và chín file `docs/workflow/`.
- **README viết lại**: mở bằng vấn đề (agent tự khai đã test) trước khi nói cơ chế, cài một dòng, và phần khác biệt trung thực theo khảo sát thị trường — không tuyên bố độc quyền cho những mechanic đã có người làm, chỉ nêu execution id và tổ hợp.
- `files` trong `package.json` chỉ còn `docs/workflow`, nên 35 file canonical docs nội bộ (~220KB) không còn lọt vào gói npm.
- Dashboard hiển thị giờ theo locale của trình duyệt thay vì cố định `vi-VN`.

### Added
- `LICENSE` MIT ở root, và metadata publish trong `package.json`: `author`, `repository`, `homepage`, `bugs`, `keywords`, `publishConfig.access`.

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

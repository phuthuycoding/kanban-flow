# CLI reference

Binary chính là `kf`. Các lệnh tìm `.works/` từ thư mục hiện tại đi ngược lên project root, vì vậy có thể chạy từ root hoặc subdirectory.

## Khởi tạo và feature

| Lệnh | Tác dụng |
| --- | --- |
| `kf init [path]` | Onboarding: trên TTY hỏi context, stack, reviewer, agent, gitignore và seed feature; non-TTY tự dùng defaults. Tạo `.works/`, `docs/{requirement,use-cases,testplan}`, `.kf` và cài skill cấp project. |
| `kf init --defaults` | Onboarding không tương tác bằng giá trị mặc định (dùng cho agent/script). |
| `kf init --minimal` | Chỉ tạo `.works/` + docs roots + cài skill; không seed config/templates. |
| `kf new <feature> [--context <ctx>] [--goal <text>] [--type feature|bug]` | Tạo feature/bug ở `brainstorm`; bug dùng `kanban-bug`; tên feature/context chỉ nhận `[a-z0-9][a-z0-9_-]*`. |
| `kf list [--json]` | Liệt kê work item, kind và state. |
| `kf show <feature> [--json]` | Xem requirement/bug report của work item. |
| `kf view [--json]` | Thống kê workflow ở terminal; JSON gồm metrics, charts và chi tiết stages. |
| `kf dashboard [--port <1-65535>]` | Dashboard KPI + charts có filter context/feature/bug, mặc định cổng `8787`; xem [cách tính số liệu](dashboard.md). |

## Điều hành workflow

| Lệnh | Tác dụng |
| --- | --- |
| `kf status --change <feature> [--json]` | Xem trạng thái một feature. |
| `kf status --all [--json]` | Xem toàn bộ work item, gồm cả `backlog` và `dones`. |
| `kf instruct <artifact|use-case> [--change <feature>] [--id UC-###] [--json]` | Render template artifact; `use-case` tạo instruction cho đúng một file `use-cases/UC-###.md`. |
| `kf templates [--json]` | Liệt kê template đang được resolve và nguồn của chúng. |
| `kf validate --change <feature> [--strict] [--json]` | Kiểm tra artifact, placeholder, traceability và gate. Exit code `1` khi fail. |
| `kf validate --all [--strict] [--json]` | Validate toàn bộ feature. |
| `kf approve <feature> [--by <name>]` | Human gate cho execution contract ở planning; lưu approver, thời điểm và contract hash. |
| `kf stage <feature> <next-stage> [--force] [--skip-hooks]` | Thực hiện transition hợp lệ và chạy hook của state đích. Planning có thể vào `backlog` hoặc `implementation`; `dones` được chuyển qua archive. |
| `kf archive <feature> [--force] [--skip-specs] [--skip-hooks]` | Archive từ review sang dones và cập nhật metadata; feature nhận canonical copies, bug giữ docs hiện có. |
| `kf rules [--stack <id> ...] [--list] [--force]` | Copy stack best-practice review rules vào `.kf/review/rules/`; tự detect stacks (monorepo cài nhiều packs), `--list` xem packs, `--force` ghi đè khi file đã sửa. |
| `kf autoconfig` | In ra stdout một briefing cho agent: project context, checklist config (done/missing kèm lệnh gợi ý), effective review rules và workflow guide — để agent tự config project. |

`--force` bỏ qua gate có chủ đích; khi archive lại work item trong `dones`, nó cũng cho phép ghi đè canonical docs đã được chỉnh sửa bằng snapshot archive. `--skip-hooks` bỏ qua hook phase đích; `--skip-specs` không chạm bất kỳ canonical doc nào khi archive.

## Skill installation

Skills tồn tại ở hai scope: **user** (`~/.claude/skills`, `~/.agents/skills`, ...) và **project** (`{root}/.claude/skills`, `{root}/.agents/skills`, ...). `kf init` cài ở project scope; `kf install`/`kf uninstall` mặc định thao tác ở user scope — dùng `--project` để chọn project scope hoặc `--all` cho cả hai. Project scope resolve về `.works/` root gần nhất từ cwd.

| Lệnh | Tác dụng |
| --- | --- |
| `kf install [--agent <id> ...] [--project \| --all]` | Cài 8 skill vào skill directory của từng agent; mặc định `claude`, user scope. Agent hỗ trợ: `claude`, `codex`, `gemini`, `kiro`, `cursor`, `opencode`. |
| `kf uninstall [--agent <id> ...] [--project \| --all] [--purge] [--force]` | Gỡ đúng 8 skill do kaban-flow quản lý ở scope đã chọn, không xóa skill khác. Cần `--project` để gỡ skill mà `kf init` đã cài vào repo. `--purge` xoá thêm `.works/`, `.kf/`, `docs/{requirement,use-cases,testplan}/` — hỏi xác nhận trên TTY, non-TTY bắt buộc `--force`. |

Uninstall chỉ gỡ skill; gỡ hẳn CLI khỏi PATH: `npm rm -g kaban-flow`.

## Quy ước lỗi

- Thành công trả exit code `0`; input sai, gate fail, hook fail, feature không tồn tại hoặc exception trả `1` và thông báo ở stderr.
- CLI không tự chạy migration, update database, deploy hay publish.
- Hook resolve theo thứ tự project `.kf/hooks` → user `~/.kf/hooks` → package hooks. Environment truyền vào hook gồm `KFW_FEATURE`, `KFW_CONTEXT`, `KFW_FROM_STAGE`, `KFW_TO_STAGE`, `KFW_FEATURE_DIR`, `KFW_WORK_ROOT` và `KFW_APPROVAL`.

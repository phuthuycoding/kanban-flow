---
feature: cancel-work-item
context: cli
created: 20260919_2239
kind: feature
status: archived
---
# Spec Requirement

## Feature
cancel-work-item

## Objective
Cho work item một lối ra thứ hai ngoài `dones`: stage `cancelled` kèm lệnh `kf cancel <feature> --reason`. Bỏ một việc phải để lại lý do và dấu vết, không phải `rm -rf`; và item đã bỏ không được làm bẩn danh sách hay bóp méo tỷ lệ hoàn thành.

## Problem Statement
Pipeline hiện chỉ có một lối ra là `dones`. Việc bị bỏ giữa chừng có hai lựa chọn, cả hai đều tệ: để nguyên tại stage cũ thì nằm mãi trong `kf list`, `kf status --all` và luôn bị tính vào mẫu số của `completionRate`; hoặc xoá tay thì mất lý do, lần sau có người đề xuất lại đúng ý tưởng đó không ai biết nó đã bị loại vì sao. Ba tình huống đã gặp thật trong ngày 2026-09-19: một work item bị bỏ ở planning khi đổi hướng, một work item bị work item sau viết đè, và `REQUIREMENT_BUG` ở review chặn mọi chuyển stage mà không có cửa nào để dừng hẳn.

## Scope
### In Scope
- Stage `cancelled` là stage thứ tám, nằm **ngoài** trục tuyến tính (không artifact nào due, không đòi approval).
- `kf cancel <feature> --reason "<text>" [--by <name>] [--purge-docs] [--force] [--skip-hooks]`.
- Metadata `cancellation { at, by, reason, fromStage }` và `status: "cancelled"`.
- Mở lại: từ `cancelled` chỉ được về đúng `fromStage` bằng `kf stage`.
- Hook `cancelled.sh` chạy trước khi chuyển.
- Liệt kê canonical docs liên quan khi bỏ một item đã ở `dones`; `--purge-docs` mới xoá, có confirm trên TTY.
- Hiển thị: `kf list`, `kf status` (lý do + thời điểm), `kf view`/dashboard (đếm riêng, loại khỏi mẫu số `completionRate`).
- Validator: item ở `cancelled` chỉ cần metadata hợp lệ có `cancellation.reason`.
- Docs (`lifecycle`, `state-machine`, `gates`, `cli-reference`, README) và skill `kanban-flow` (khi nào dừng hẳn thay vì loop).

### Out of Scope
- `kf supersede <old> --by <new>` (liên kết hai work item thay thế nhau) — để backlog.
- Tự dọn CHANGELOG hay docs khác ngoài canonical docs của chính item đó.
- Tự động cancel theo tuổi hoặc theo trạng thái (ví dụ backlog quá 90 ngày).
- Khôi phục item đã bị xoá tay trước đây.
- Cancel hàng loạt.

## Actors
- Người vận hành: quyết định bỏ một việc và ghi lý do.
- Main agent: đề xuất dừng hẳn khi gặp `REQUIREMENT_BUG` hoặc scope chết, nhưng không tự cancel.

## Functional Requirements
### FR-001
- Requirement: Thêm `cancelled` vào `STAGES` ở **cuối mảng** (giữ nguyên index của các stage cũ vì `ARTIFACTS.dueFromStage` là số cứng 0/1/4/5/6) với `STAGE_INDEX.cancelled = -1`, `STAGE_GATES.cancelled = []`, `PHASE_NAMES.cancelled` mô tả rõ, `TRANSITIONS.cancelled = []`. Mọi stage khác được phép đi tới `cancelled` (qua `kf cancel`, không qua `kf stage`).
- Priority: must
- Notes: `-1` làm mọi so sánh `stageIndex >= dueFromStage` và `>= STAGE_INDEX.planning` thành false, nên validator tự động bỏ qua artifact gate, approval, traceability và report semantics mà không cần thêm nhánh `if` rải rác.

### FR-002
- Requirement: `kf cancel <feature> --reason "<text>"` chuyển work item sang `.works/cancelled/`, ghi `cancellation: { at, by, reason, fromStage }` và `status: "cancelled"` vào `.kfw.json`. `--reason` bắt buộc và không được rỗng sau khi trim; thiếu hoặc rỗng → exit 1. `--by` mặc định lấy `reviewer` trong `.kf/config.json`, rồi tới `"human"`. Item đã ở `cancelled` → exit 1. Feature không tồn tại → exit 1.
- Priority: must
- Notes: Lý do là toàn bộ giá trị của tính năng; không có lý do thì bằng xoá.

### FR-003
- Requirement: `kf cancel` chạy hook `cancelled.sh` (resolve project → user → package) trước khi chuyển, đúng cơ chế của `kf stage`; hook exit non-zero chặn việc cancel, `--skip-hooks` bỏ qua và ghi `bypasses[]` như các lệnh khác. `--force` bỏ qua các chặn khác (xem FR-004) và cũng ghi `bypasses[]`.
- Priority: must
- Notes: Dùng lại `runHook` và `recordBypasses` sẵn có, không viết cơ chế mới.

### FR-004
- Requirement: Cancel một item đang ở `dones`: CLI liệt kê canonical docs thuộc item đó (`docs/requirement/{ctx}/{name}.md`, `docs/use-cases/{ctx}/{name}/`, `docs/testplan/{ctx}/{name}.md`, `{name}-result.md`) và **không xoá**; `--purge-docs` xoá chúng sau khi confirm trên TTY (non-TTY bắt buộc `--force`). Item chưa từng archive thì không có bước này.
- Priority: must
- Notes: Xoá docs là destructive nên không bao giờ ngầm; đây đúng là việc phải làm tay khi bỏ một feature đã archive.

### FR-005
- Requirement: Mở lại: `kf stage <feature> <stage>` từ `cancelled` chỉ hợp lệ khi `<stage>` bằng `cancellation.fromStage`; stage khác → exit 1 nêu stage hợp lệ. Khi mở lại, CLI xoá `cancellation` và `status: "cancelled"` khỏi metadata, giữ nguyên `runs[]`/`bypasses[]`/`sessions`. Item không có `cancellation` (metadata bị sửa tay) → exit 1 hướng dẫn dùng `kf stage --force`.
- Priority: must
- Notes: Một đường ra, một đường vào; không thêm lệnh `kf reopen` cho một thao tác hiếm.

### FR-006
- Requirement: Validator: item ở `cancelled` bỏ qua toàn bộ artifact/approval/traceability/report gate (hệ quả của FR-001) và thêm kiểm tra riêng: thiếu `cancellation` hoặc `cancellation.reason` rỗng → ERROR `cancellation_missing`. `kf archive` trên item `cancelled` → exit 1.
- Priority: must
- Notes: Không để tồn tại item nằm trong `.works/cancelled/` mà không ai biết vì sao.

### FR-007
- Requirement: Hiển thị. `kf list` in stage `cancelled`. `kf status --change <f>`: dòng `Cancelled: <at> by <by> — <reason>` (từ stage cũ `<fromStage>`), không in `Next:`; `--json` thêm `cancellation`. `kf view`/`dashboard`: `metrics.cancelled` là số item ở `cancelled`, và `completionRate` tính trên mẫu số **không gồm** cancelled (`completed / (total - cancelled)`, `null` khi mẫu số 0); text và KPI của dashboard hiển thị thêm ô Cancelled.
- Priority: must
- Notes: Nếu vẫn tính cancelled vào mẫu số thì tỷ lệ hoàn thành sai vĩnh viễn, đúng cái lý do người ta ngại đánh dấu bỏ.

### FR-008
- Requirement: Docs và skill. `docs/workflow/lifecycle.md` + `state-machine.md` thêm nhánh cancelled và đường mở lại; `gates.md` nêu cancelled không có gate artifact nhưng bắt buộc lý do; `cli-reference.md` thêm `kf cancel`; README nhắc một dòng. Skill `kanban-flow`: khi `REQUIREMENT_BUG` hoặc người dùng quyết bỏ, **đề xuất** `kf cancel` kèm lý do nhưng không tự chạy (đây là quyết định của người). CHANGELOG ghi mục Added; BACKLOG thêm `kf supersede`.
- Priority: should
- Notes: Agent không được tự bỏ việc; đó là quyết định của người, giống hai human gate hiện có.

## Non-Functional Requirements
- Không thêm dependency; không đổi hành vi của item không bị cancel.
- Metadata cũ không có `cancellation` vẫn hợp lệ (field optional).
- File nguồn dưới 500 dòng; `kf cancel` là module riêng `src/cli/commands/cancel.ts`.
- Không nuốt lỗi; xoá docs chỉ sau confirm.

## Main Use Cases
- UC-001 Bỏ một việc đang dở, ghi lý do
- UC-002 Bỏ một việc đã archive và quyết định số phận canonical docs
- UC-003 Mở lại một việc đã bỏ nhầm
- UC-004 Item đã bỏ không làm bẩn danh sách và không bóp méo tỷ lệ hoàn thành
- UC-005 Gate và hook cư xử đúng với stage cancelled
- UC-006 Agent đề xuất dừng hẳn khi gặp REQUIREMENT_BUG, người quyết

## Constraints
- Tuân quy tắc repo: file < 500 dòng, không reformat, không catch nuốt lỗi.
- Không commit/push tự động.
- Không sửa artifact của các work item đã archive.

## Assumptions
- "ừ thêm cancelled đi em" sau khi em trình bày thiết kế (stage thứ tám ngoài trục tuyến tính, reason bắt buộc, không tự xoá docs, loại khỏi mẫu số metrics) là xác nhận requirement Phase 1 cho đúng thiết kế đó.
- Branch: tiếp tục branch hiện tại; `agent-roles` vẫn chưa commit nên diff tiếp tục trộn. Em đã nêu hai lần và sẽ đề xuất cách commit khi xong.
- `STAGE_INDEX = -1` an toàn với mọi chỗ đang so sánh (đã rà: validate-artifacts, validate-approval, validate-reports, validate-traceability, status, dashboard).

## Acceptance Criteria
- [ ] `kf cancel demo --reason "đổi hướng"` chuyển folder sang `.works/cancelled/`, ghi `cancellation` đủ 4 trường và `status: "cancelled"`.
- [ ] Thiếu `--reason` hoặc reason chỉ có khoảng trắng → exit 1, item không đổi stage.
- [ ] Item ở `cancelled`: `kf validate` valid (không đòi artifact nào) khi có reason; xoá `cancellation` khỏi metadata → ERROR `cancellation_missing`.
- [ ] Cancel item đang ở planning đã approve: không đòi approval, không đòi 4 artifact planning.
- [ ] Cancel item ở `dones`: stdout liệt kê đủ canonical docs, docs vẫn còn trên đĩa; với `--purge-docs --force` thì docs bị xoá.
- [ ] Hook `cancelled.sh` exit 9 chặn cancel; `--skip-hooks` qua được và ghi `bypasses[0].flag === "skip-hooks"`.
- [ ] `kf stage <f> <fromStage>` từ cancelled mở lại được, `cancellation` và `status` bị xoá khỏi metadata; `kf stage <f> <stage khác>` exit 1.
- [ ] `kf archive` trên item cancelled → exit 1.
- [ ] `kf list` in `cancelled`; `kf status` in dòng `Cancelled: … — <reason>` và không in `Next:`; `--json` có `cancellation`.
- [ ] Với 4 item (2 dones, 1 cancelled, 1 testing): `metrics.cancelled === 1`, `completionRate === 67` (2/3), `kf view` text có dòng Cancelled, dashboard HTML có ô Cancelled.
- [ ] Suite hiện có (209 test) pass; mọi file `src/**` dưới 500 dòng.

## Edge Cases
- Cancel item ở `brainstorm` chưa có artifact nào: hợp lệ, không đòi gì.
- Cancel item đang có run `running` (harness): chặn như `kf run`, nêu run id, trừ khi `--force`.
- `fromStage` là `dones` rồi mở lại: quay về `dones`, `status` trở lại `"archived"`? Không: mở lại về `dones` thì `status` để trống và người dùng chạy `kf archive` lại nếu muốn. Ghi rõ trong docs.
- Reason chứa ký tự xuống dòng: lưu nguyên, hiển thị dòng đầu trong `kf list`/`kf status`, đầy đủ trong `--json`.
- Reason trông như secret (token): `findSecretLike` chặn, exit 1 (nhất quán với artifact).
- Hai item cùng tên, một ở cancelled một đang chạy: `findFeature` hiện báo ambiguous; giữ nguyên hành vi đó.
- `.works/cancelled/` chưa tồn tại (project cũ): `ensureWorksStructure` tạo; `kf cancel` tự tạo nếu thiếu.
- Canonical docs của item cancel trùng tên với item khác cùng context: chỉ liệt kê đúng đường dẫn theo tên item, không dò rộng.

## Open Questions
- Không còn: thiết kế đã chốt trong thảo luận 2026-09-19.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`), `npm run typecheck`, `npm run lint`
- Coverage Target: N/A — repo không có coverage tooling; gate = suite xanh + typecheck + lint

---
feature: agent-roles
context: cli
created: 20260919_2212
kind: feature
status: archived
---
# Spec Requirement

## Feature
agent-roles

## Objective
Thay ánh xạ `stage → runner` của harness bằng ba lớp `stage → role → runner`, cho phép một stage chạy **chuỗi role** (ví dụ brainstorm: researcher khảo sát rồi writer viết spec) và cho mỗi role một `brief` mô tả vai để đưa vào prompt. Mục tiêu: điều phối theo **thế mạnh** (văn phong, chiều rộng khảo sát, code, review) thay vì theo tên hãng, và đổi model chỉ sửa một dòng.

## Problem Statement
Bản harness đầu tiên gán thẳng `stages: { testing: "gemini" }` (stage trỏ tên runner). Ba hệ quả: (1) một stage chỉ một agent, không diễn tả được "khảo sát trước, viết sau" trong cùng brainstorm; (2) tên trong `stages` là tên runner nên đổi model phải sửa mọi stage đang trỏ tới nó; (3) worker không biết nó được gọi vì thế mạnh nào, prompt chỉ nói stage. Thế mạnh model đổi theo tháng còn vai trò trong quy trình thì ổn định, nên lớp trung gian `role` là chỗ đúng để hấp thụ thay đổi.

## Scope
### In Scope
- `harness.roles`: map role → `{ runner, brief?, output? }` (hoặc dạng ngắn `"coder": "claude-opus"`).
- `harness.stages`: stage → role hoặc mảng role chạy tuần tự. **Bỏ** dạng trỏ thẳng runner.
- `harness.main`: là tên role.
- `kf run` chạy chuỗi role của stage; `--role <name>` chạy đúng một role; bỏ `--agent`.
- Role sau trong chuỗi nhận đường dẫn output và log của role trước trong prompt.
- `brief` của role được chèn vào prompt worker; `output` là file phụ role phải viết trong feature dir.
- Session và run ghi theo **role** (`sessions[role]`, `runs[].role` + `runs[].runner`).
- `skillsDirFor` dùng tên **runner**, không dùng tên role.
- `kf init` seed roles mặc định; `kf harness` in ba lớp; `kf status`/`kf view`/`kf runs` hiển thị role.
- Docs `harness.md`, skills, CHANGELOG cập nhật; migration note cho config cũ.

### Out of Scope
- Backward compatibility cho `stages: { testing: "<runner>" }` (đại ca chốt bỏ). Config cũ báo lỗi kèm hướng dẫn chuyển đổi, không tự migrate.
- Main agent tự chọn role theo capability (đã bàn và loại: mất tính tái lập). Ánh xạ stage → role là cố định trong config.
- Chạy song song các role trong một stage; luôn tuần tự.
- `kf run --task "<mô tả>"` ad-hoc ngoài stage (để backlog, cần thiết kế riêng cho output path).
- Role riêng cho bug flow khác feature flow.
- Đo chất lượng/so sánh model tự động.

## Actors
- Người vận hành: khai báo roles, gán stage → role, đổi runner khi đổi model.
- Main agent (role `architect`): điều phối, giữ hai human gate, gọi `kf run`.
- Worker agent: CLI headless chạy một role cho một stage.

## Functional Requirements
### FR-001
- Requirement: `harness.roles` là map `role → RoleConfig`, với `RoleConfig` = string (tên runner) hoặc `{ runner: string, brief?: string, output?: string }`. `runner` phải tồn tại trong `harness.runners`. `output` là đường dẫn tương đối trong feature dir, không được chứa `..` hay bắt đầu bằng `/`. `harness.main` phải là tên role. Sai kiểu hoặc trỏ runner không tồn tại → `readProjectConfig` throw nêu đúng field.
- Priority: must
- Notes: Dạng string ngắn cho role không cần brief; dạng object khi cần mô tả vai hoặc file output riêng.

### FR-002
- Requirement: `harness.stages` nhận `stage → role` hoặc `stage → role[]` (chuỗi tuần tự, ít nhất một phần tử, không trùng role trong cùng chuỗi). Mọi giá trị phải là tên role có trong `harness.roles`. Giá trị trỏ tới một runner (không phải role) → lỗi nêu rõ: `"gemini" is a runner, not a role; declare a role in harness.roles`. Stage `backlog` vẫn không gán được.
- Priority: must
- Notes: Thông điệp lỗi phải đủ để người dùng config cũ biết cách sửa.

### FR-003
- Requirement: `kf run <feature>` chạy **tuần tự** toàn bộ chuỗi role của stage hiện tại. Mỗi role là một run riêng với id riêng, ghi `runs[]` riêng. Một role không kết thúc `DONE`/`DONE_WITH_CONCERNS` (exit khác 0, thiếu `STATUS:`, `BLOCKED`, `NEEDS_CONTEXT`, timeout) → **dừng chuỗi**, các role sau không chạy, `kf run` exit 1 và nêu role nào dừng. `--role <name>` chạy đúng một role trong chuỗi (phải thuộc chuỗi của stage đó, hoặc bất kỳ role nào khi kèm `--stage`). Cờ `--agent` bị bỏ; dùng `--agent` → lỗi chỉ sang `--role`.
- Priority: must
- Notes: `--dry-run` in kế hoạch cả chuỗi (mỗi role một khối argv + prompt), không chạy.

### FR-004
- Requirement: Prompt worker thêm: dòng vai `You are the "<role>" worker` kèm `brief` của role khi có; khi role có `output`, một dòng yêu cầu ghi kết quả vào đúng file đó (ngoài artifact chuẩn của stage); khi là role thứ hai trở đi trong chuỗi, một mục "Previous step" liệt kê role trước, file `output` của nó (nếu có) và đường dẫn log của nó để đọc khi cần. Contract cũ (không chuyển stage, kết thúc `STATUS:`) giữ nguyên.
- Priority: must
- Notes: Vẫn chỉ truyền đường dẫn, không nhúng nội dung, để giữ chi phí token.

### FR-005
- Requirement: Session theo work item + **role**: `.kfw.json.sessions[role]`. Hai role dùng chung một runner không dùng chung session. `runs[]` ghi thêm `role` và đổi `agent` thành `runner` (`RunRecord.role`, `RunRecord.runner`). Metadata cũ có `runs[].agent` → `readFeatureMeta` báo `Invalid feature metadata` nêu field (không tự migrate; work item cũ đã archive nên không ảnh hưởng luồng đang chạy).
- Priority: must
- Notes: Tách session theo role là lý do chính để hai vai khác nhau của cùng một CLI không lẫn ngữ cảnh.

### FR-006
- Requirement: `skillsDirFor` nhận tên **runner** để resolve thư mục skill (`.claude/skills`, `.gemini/skills`, …); `runner.skillsDir` vẫn ghi đè. Thông điệp thiếu skill nêu cả role và runner: `Skill <path> is missing for role "writer" (runner gemini) — run: kf install --agent gemini`.
- Priority: must
- Notes: Đây là bug sẽ phát sinh nếu bê nguyên code cũ: role name không map được sang thư mục skill.

### FR-007
- Requirement: `kf init` seed `harness.roles` mặc định: `architect`, `researcher`, `writer`, `coder`, `tester`, `reviewer`, tất cả trỏ runner mặc định (agent đầu tiên có preset, thường `claude`), kèm `brief` mô tả vai; `main: "architect"`; `stages` rỗng. Không ghi đè `harness` đã có.
- Priority: must
- Notes: Seed để đại ca chỉ việc đổi `runner` của từng role, không phải tự nghĩ cấu trúc.

### FR-008
- Requirement: `kf harness [--json]` in ba lớp: `main` (role), bảng stage → chuỗi role, bảng role → runner + brief rút gọn + output, bảng runner → CLI/on PATH/resume/session. `kf status --change <f>` in `Assigned: <role> (runner) [→ <role2> …]` cho chuỗi; `Runs: N (role×n, …)`; `--json` có `assignedRoles`. `kf runs` hiển thị cột role và runner. `kf view --json` đổi `metrics.runs.byAgent` thành `byRole` (giữ `usage` theo role).
- Priority: should
- Notes: Đổi tên field trong `kf view --json` là breaking, chấp nhận vì mới thêm hôm nay và chưa ai dùng.

### FR-009
- Requirement: Docs `docs/workflow/harness.md` viết lại phần config theo ba lớp, thêm mục "Role là gì và vì sao ba lớp", ví dụ chuỗi brainstorm researcher → writer, và mục migration từ `stages: { x: "<runner>" }`. README mục harness cập nhật. Skill `kanban-flow` mô tả chuỗi role và việc một role fail thì dừng chuỗi. `CHANGELOG.md` ghi breaking change. `BACKLOG.md` thêm `kf run --task` ad-hoc.
- Priority: should
- Notes: Phần chi phí token và điều khoản trong `harness.md` giữ nguyên, bổ sung lưu ý chuỗi role nhân chi phí theo số bước.

## Non-Functional Requirements
- Không thêm dependency; không đổi hành vi khi `harness.stages` rỗng (main làm hết như hiện nay).
- File nguồn dưới 500 dòng; `src/harness/run.ts` đang 261 dòng, phần chạy chuỗi tách sang module riêng nếu vượt.
- Không nuốt lỗi; lỗi config nêu đúng field.
- Chuỗi role không được chạy song song, không tự retry.

## Main Use Cases
- UC-001 Khai báo roles và gán stage → role, kiểm tra bằng `kf harness`
- UC-002 Một stage chạy chuỗi role, kết quả bước trước là đầu vào bước sau
- UC-003 Một role trong chuỗi không DONE thì dừng chuỗi
- UC-004 Đổi model cho một role mà không đụng stage mapping
- UC-005 Hai role dùng chung runner nhưng session tách biệt
- UC-006 Config kiểu cũ báo lỗi kèm hướng dẫn chuyển đổi

## Constraints
- Tuân quy tắc repo: file < 500 dòng, không reformat, không catch nuốt lỗi, không comment thừa.
- Không commit/push tự động.
- Không sửa artifact của hai work item đã archive.

## Assumptions
- "Ừ chơi theo vai trò... hoặc theo role" + "làm luôn, cái cũ bỏ đi cũng ô kê" là xác nhận requirement Phase 1: làm role-based, bỏ backward compat với `stages → runner`.
- Preset runner giữ nguyên (claude/codex/devin đã smoke thật; gemini/opencode không resume).

## Acceptance Criteria
- [ ] `roles` sai kiểu, trỏ runner không tồn tại, `output` có `..`, `main` không phải role → lỗi nêu đúng field.
- [ ] `stages: { testing: "gemini" }` (gemini là runner) → lỗi chứa `is a runner, not a role`.
- [ ] `stages: { brainstorm: ["researcher", "writer"] }` → `kf run` chạy hai run tuần tự, `runs[]` có 2 bản ghi đúng thứ tự, role thứ hai có prompt chứa tên role trước, file output của nó và đường dẫn log.
- [ ] Role đầu trả `BLOCKED` → role sau không chạy (CLI giả thứ hai không có file argv), `kf run` exit 1 nêu role dừng.
- [ ] `--role writer` chạy đúng một role; `--agent x` → lỗi chỉ sang `--role`.
- [ ] `brief` của role xuất hiện trong prompt; role có `output` → prompt yêu cầu ghi đúng file đó.
- [ ] Hai role cùng runner `claude`: `sessions` có hai key riêng, run thứ hai của mỗi role resume đúng session của role đó.
- [ ] `runs[]` có `role` và `runner`; meta cũ dạng `runs[].agent` bị từ chối nêu field.
- [ ] Thiếu SKILL.md → thông điệp nêu cả role và runner, gợi ý `kf install --agent <runner>`.
- [ ] `kf init --defaults` seed 6 role trỏ runner mặc định, `main: architect`, `stages` rỗng; chạy lại không ghi đè.
- [ ] `kf harness` in đủ ba bảng; `kf status` in `Assigned:` dạng chuỗi; `kf view --json` có `metrics.runs.byRole`.
- [ ] `docs/workflow/harness.md` có mục role; suite cũ (195 test) pass sau khi cập nhật fixture sang role.

## Edge Cases
- Chuỗi role rỗng `[]` → lỗi config.
- Role trùng trong một chuỗi (`["writer", "writer"]`) → lỗi config (session sẽ đụng nhau).
- `--role` không thuộc chuỗi của stage hiện tại và không kèm `--stage` → lỗi nêu chuỗi hợp lệ.
- Role có `output` nhưng worker không tạo file → `kf run` báo cảnh báo trong run (`warning`), không tự fail nếu `STATUS: DONE` (worker chịu trách nhiệm; gate artifact của stage mới là thứ chặn).
- Stage gán một role mà runner của nó không có CLI trên PATH → lỗi khi chạy (ENOENT như hiện tại), `kf harness` đã cảnh báo trước.
- `main` role trùng với role trong `stages` → hợp lệ (main có thể tự làm một stage nào đó qua `kf run --role`).
- Work item đã archive có `runs[].agent` → không đọc tới trong luồng thường; nhưng `kf runs` quét mọi item không ở dones nên không chạm.

## Open Questions
- Không còn: cấu trúc ba lớp, bỏ backward compat và phạm vi đã chốt trong thảo luận 2026-09-19.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`), `npm run typecheck`, `npm run lint`; CLI giả bash trên PATH hermetic
- Coverage Target: N/A — repo không có coverage tooling; gate = suite xanh + typecheck + lint

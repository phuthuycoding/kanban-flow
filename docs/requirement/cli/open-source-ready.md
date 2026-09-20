---
feature: open-source-ready
context: cli
created: 20260919_2332
kind: feature
status: archived
---
# Spec Requirement

## Feature
open-source-ready

## Objective
Đưa repo về trạng thái mở mã được cho người lạ: mọi thứ người dùng nhìn thấy bằng tiếng Anh, cài một dòng qua npm, và README kể đúng câu chuyện khác biệt dựa trên khảo sát thị trường ngày 2026-09-19. Mục tiêu là dùng cho mình và kiếm chút chú ý, không phải bán.

## Problem Statement
Ba rào cản cụ thể. Một, output người dùng thấy đang lẫn tiếng Việt: hai tên phase trong `kf status`, toàn bộ dashboard HTML, ba nhãn trong dữ liệu dashboard, ba skill và một template. Người lạ gặp ngay ở màn hình đầu. Hai, cài đặt hiện là clone rồi install rồi build rồi npm link; repo public cần một dòng. Ba, README hiện dài 203 dòng, 74 dòng có tiếng Việt, mở đầu bằng tính năng chứ không bằng vấn đề, và nêu vài điểm khác biệt mà khảo sát cho thấy đã có người làm.

Khảo sát ngày 2026-09-19 (hai lượt độc lập, đọc trực tiếp mã nguồn chứ không chỉ đọc mô tả) cho thấy: traceability làm gate đã có (`specgate`), role → runner khai báo trong config đã có (`agent-flow`), approval buộc theo hash của plan đã có (`agent-flow`), trạng thái huỷ kèm lý do đã có (`trackfw`), chặn placeholder đã có (`OpenSpec`). Thứ không tìm thấy ở đâu sau hai lượt: execution id khiến bằng chứng test cũ không qua được gate, và quét secret ngay tại cổng chuyển stage. Cũng đáng biết: ba công cụ điều phối đa hãng đã chết hoặc đang đóng cửa trong mười hai tháng.

## Scope
### In Scope
- Tiếng Anh hoá mọi chuỗi người dùng thấy trong `src/` (2 tên phase, 3 nhãn dashboard data, toàn bộ dashboard HTML/JS).
- Tiếng Anh hoá 3 skill còn lẫn tiếng Việt và 1 template.
- Chuẩn bị publish npm: metadata `package.json` (repository, keywords, engines, homepage, bugs, publishConfig), kiểm tra `files` đóng gói đủ, thêm `.npmignore` nếu cần, thêm file `LICENSE` (hiện chưa có, chỉ có trường trong package.json).
- README viết lại bằng tiếng Anh, mở đầu bằng vấn đề, positioning trung thực theo khảo sát.
- `CHANGELOG.md` ghi mục Unreleased; `BACKLOG.md` cập nhật.

### Out of Scope
- Dịch nội dung artifact đã archive trong `.works/` và canonical docs của các work item cũ: chúng là nhật ký nội bộ, và sau FR-009 thì không còn được đóng gói lên npm nữa.
- Quay ảnh động demo: em không tạo được, đây là việc của người.
- Thực sự chạy `npm publish`: cần tài khoản npm của đại ca, chỉ chuẩn bị tới bước sẵn sàng.
- Đổi license khỏi MIT.
- Thêm CONTRIBUTING, issue template, code of conduct: để sau khi có người quan tâm thật.

## Actors
- Người lạ ghé repo: đọc README trong 30 giây rồi quyết định thử hay bỏ qua.
- Người dùng thử: cài một dòng, chạy `kf init`, nhìn `kf status` và dashboard.
- Đại ca: người duy trì, vẫn dùng công cụ hằng ngày.

## Functional Requirements
### FR-001
- Requirement: Mọi chuỗi hiển thị cho người dùng trong `src/**` là tiếng Anh. Cụ thể: `PHASE_NAMES.backlog` và `PHASE_NAMES.cancelled` trong `schema.ts`; ba nhãn trong `dashboard.ts` (`Không xác định`, và bộ `Chờ duyệt`/`Đã duyệt`/`Contract đã đổi`); toàn bộ `dashboard-view.ts` gồm tiêu đề, nút, nhãn bộ lọc, KPI, chú thích, thông điệp lỗi và footer. Sau thay đổi, `grep` ký tự có dấu tiếng Việt trên `src/**` (trừ `src/tests/`) không còn kết quả.
- Priority: must
- Notes: Đây là thứ người lạ gặp đầu tiên; giữ nguyên nghĩa, không đổi bố cục hay hành vi.

### FR-002
- Requirement: Ba skill `kanban-bug`, `kanban-brainstorm`, `kanban-plan` và template `phase-2-use-case-specification.md` chuyển sang tiếng Anh. Nội dung giữ nguyên ý, kể cả các câu hỏi mẫu mà skill bảo agent hỏi người dùng. Các skill còn lại đã là tiếng Anh, không đụng.
- Priority: must
- Notes: Skill được cài vào project của người dùng nên cũng là bề mặt công khai.

### FR-003
- Requirement: `package.json` đủ metadata để publish: `repository`, `homepage`, `bugs`, `keywords`, `engines` (đã có), `publishConfig.access`. Có file `LICENSE` MIT ở root. `npm pack --dry-run` liệt kê đúng `dist/`, `skills/`, `docs/workflow/` (xem FR-009), `kanban-flow/templates`, `kanban-flow/review`, `README.md`, `LICENSE`, và **không** chứa `src/`, `.works/`, `.kf/`, `.claude/`. Tên gói và phiên bản chốt ở planning (xem Open Questions).
- Priority: must
- Notes: `kaban-flow` và `kanban-flow` đều còn trống trên npm tính tới 2026-09-19.

### FR-004
- Requirement: README viết lại bằng tiếng Anh với thứ tự: vấn đề trước, cơ chế sau, cài đặt, một ví dụ chạy được, rồi mới tới chi tiết. Phần khác biệt phải trung thực theo khảo sát: **không** tuyên bố "chưa ai làm X" cho những mechanic đã có người làm (traceability gate, role→runner config, hash-bound approval, cancelled kèm lý do, chặn placeholder); nêu đúng một mechanic chưa tìm thấy ở đâu (execution id chống bằng chứng test cũ) và nêu tổ hợp là điểm khác biệt. Trỏ sang `docs/workflow/` cho chi tiết.
- Priority: must
- Notes: Khẳng định "nobody does X" rất dễ bị bác bằng một lần tìm kiếm; khẳng định về tổ hợp thì đứng vững.

### FR-005
- Requirement: Cài đặt một dòng trong README (`npm install -g <tên gói>`), giữ lại hướng dẫn cài từ mã nguồn cho người muốn sửa. Bỏ câu "repo private nên dùng git clone".
- Priority: must
- Notes: Sau khi publish thì đường cài chính phải là npm.

### FR-008
- Requirement: Dịch toàn bộ tài liệu người đọc sang tiếng Anh: `docs/README.md`, `kanban-flow/README.md` (12 dòng, sót khi đo lần đầu) và chín file trong `docs/workflow/` (`README`, `artifacts`, `cli-reference`, `dashboard`, `gates`, `harness`, `lifecycle`, `skills`, `state-machine`; `source-layout` vốn đã là tiếng Anh). Giữ nguyên cấu trúc mục, bảng, sơ đồ mermaid và mọi đường liên kết nội bộ; chỉ đổi ngôn ngữ. Sau thay đổi, grep ký tự tiếng Việt trên `docs/README.md`, `kanban-flow/README.md` và `docs/workflow/**` trả về rỗng.
- Priority: must
- Notes: 748 dòng, khoảng 319 dòng có tiếng Việt. Nhãn trong sơ đồ mermaid cũng phải dịch vì chúng hiển thị cho người đọc.

### FR-009
- Requirement: `files` trong `package.json` chỉ đóng gói `docs/workflow`, không đóng gói `docs/requirement`, `docs/use-cases`, `docs/testplan`. Ba thư mục đó là canonical docs của work item nội bộ (35 file, khoảng 220KB) và không có lý do gì nằm trong gói người khác cài.
- Priority: must
- Notes: Đây là lỗi thật của cấu hình hiện tại, phát hiện khi đo khối lượng docs.

### FR-007
- Requirement: Đổi tên gói từ `kaban-flow` sang `kanban-flow` ở mọi nơi: `package.json` (`name`), `package-lock.json`, mọi chuỗi người dùng thấy trong `src/**` (banner `kf help`, `kf init`, `kf view`, `kf autoconfig`, dashboard title và eyebrow, prompt worker, dòng `# kaban-flow` mà `kf init` ghi vào `.gitignore`, gợi ý `npm rm -g`), README, `docs/README.md`, `docs/workflow/{README,harness,cli-reference}.md`, và hai test assert chuỗi đó. Bump `version` lên `0.3.0`. Tên binary vẫn là `kf`; thư mục dữ liệu vẫn là `.kf/` và `.works/`; thư mục package `kanban-flow/` vốn đã đúng chính tả nên không đổi.
- Priority: must
- Notes: Không đổi tên hằng nội bộ `USER_KABAN_DIR` trong `shared/paths.ts` vì nó không hiển thị cho người dùng và đổi tên là breaking change không cần thiết; ghi lại để đợt dọn dẹp sau.

### FR-006
- Requirement: `CHANGELOG.md` thêm mục Unreleased mô tả đợt này; `BACKLOG.md` bỏ mục "docs trộn Việt-Anh" đã làm xong phần code và thêm mục dịch `docs/workflow` còn lại; ghi thêm mục "quay ảnh động demo cho README".
- Priority: should
- Notes: Giữ backlog phản ánh đúng thực tế sau đợt này.

## Non-Functional Requirements
- Không đổi hành vi: mọi lệnh, gate, exit code giữ nguyên; chỉ đổi chuỗi hiển thị và metadata.
- Suite hiện có (226 test) phải xanh; test nào assert chuỗi tiếng Việt thì sửa theo chuỗi tiếng Anh mới, không nới assertion.
- Không thêm dependency.
- Không reformat file ngoài phạm vi.

## Main Use Cases
- UC-001 Người lạ đọc README và hiểu vấn đề công cụ giải quyết
- UC-002 Người dùng thử cài một dòng và chạy được ngay
- UC-003 Người dùng thử nhìn `kf status` và dashboard, không gặp ngôn ngữ lạ
- UC-004 Đại ca publish lên npm khi muốn, không phải sửa thêm gì

## Constraints
- Tuân quy tắc repo: không reformat, không đổi tên ngoài phạm vi, file dưới 500 dòng.
- Không commit/push tự động; không `npm publish`.
- Không sửa artifact của work item đã archive.

## Assumptions
- "ừ ok em làm đi" là xác nhận requirement Phase 1 cho đúng ba việc đã trình bày (tiếng Anh hoá, cài một dòng, README), cộng phần chuẩn bị publish đi kèm.
- Branch `feat/open-source-ready` tách từ `main` @ `afa3fd4`.
- Đại ca vẫn giữ license MIT.
- Dashboard chỉ có một ngôn ngữ; không làm i18n vì chưa có nhu cầu thật.

## Acceptance Criteria
- [ ] `grep` ký tự tiếng Việt trên `src/**` trừ `src/tests/` trả về rỗng.
- [ ] `grep` tương tự trên `skills/**` và `kanban-flow/templates/**` trả về rỗng.
- [ ] `kf status` in tên phase tiếng Anh cho cả `backlog` và `cancelled`; dashboard HTML không còn chuỗi tiếng Việt.
- [ ] Có file `LICENSE` MIT; `package.json` có `repository`, `homepage`, `bugs`, `keywords`, `publishConfig`.
- [ ] `npm pack --dry-run` chứa `dist/`, `skills/`, `docs/`, `kanban-flow/{templates,review}`, `README.md`, `LICENSE`; không chứa `src/`, `.works/`, `.kf/`, `.claude/`, `node_modules/`.
- [ ] README bằng tiếng Anh, 120 dòng trở xuống, mở đầu bằng vấn đề, có mục cài một dòng, và phần khác biệt không chứa khẳng định "chưa ai làm" cho năm mechanic đã có người làm.
- [ ] grep ký tự tiếng Việt trên `docs/README.md`, `kanban-flow/README.md` và `docs/workflow/**` trả về rỗng; mọi liên kết nội bộ trong docs vẫn trỏ đúng file tồn tại.
- [ ] `npm pack --dry-run` không chứa `docs/requirement`, `docs/use-cases`, `docs/testplan`.
- [ ] Suite 226 test xanh sau khi cập nhật các assertion chuỗi; typecheck và lint sạch.
- [ ] `CHANGELOG.md` có mục Unreleased cho đợt này; `BACKLOG.md` cập nhật đúng.
- [ ] `grep -rn "kaban"` trên `src/`, `README.md`, `docs/README.md`, `docs/workflow/`, `package.json` không còn kết quả (trừ `USER_KABAN_DIR` đã nêu); `node -p require('./package.json').name` in `kanban-flow`, version `0.3.0`; `kf --version` sau build in `0.3.0`.

## Edge Cases
- Test hiện có assert chuỗi tiếng Việt: `dashboard.test.ts` kiểm `Không xác định`, `cancel.test.ts` kiểm `Đã huỷ`. Phải sửa theo chuỗi mới.
- `docs/workflow/dashboard.md` mô tả nhãn dashboard bằng tiếng Việt: chỉ sửa nếu nhắc đúng chuỗi đã đổi, không dịch cả file.
- Dashboard có `lang="vi"` trong thẻ html: đổi sang `en`.
- Tên gói đổi thì `bin` vẫn là `kf`, và mọi chỗ trong docs nhắc `npm rm -g kaban-flow` phải khớp tên mới.
- `package-lock.json` chứa tên gói ở hai chỗ; đổi bằng `npm install` sau khi sửa `package.json` chứ không sửa tay.
- Dòng `# kaban-flow` mà `kf init` ghi vào `.gitignore` của project người dùng cũng phải đổi; `.gitignore` của chính repo này đã có dòng cũ, sửa luôn.
- Liên kết nội bộ giữa các file docs (`[dashboard](dashboard.md)`, `[gates](gates.md#force-và-recovery)`) có anchor tiếng Việt; dịch tiêu đề mục làm hỏng anchor, phải cập nhật cả hai đầu.

## Open Questions
- Không còn: đại ca đã chốt đổi tên gói thành `kanban-flow` và bump phiên bản lên `0.3.0`.
- Ngoài phạm vi công cụ: tên repo trên GitHub hiện là `phuthuycoding/kaban-flow`. Đổi tên repo là thao tác trên GitHub của đại ca, không phải việc của CLI; nếu đổi thì `repository`/`homepage`/`bugs` trong `package.json` phải khớp. Em sẽ dùng tên repo hiện tại và nêu lại khi bàn giao.

## Test Strategy
- Level: unit+integration
- UI Tests: none (dashboard kiểm bằng chuỗi trong HTML sinh ra, như test hiện có)
- Tools: vitest (`npm test`), `npm run typecheck`, `npm run lint`, `npm pack --dry-run`, shell grep
- Coverage Target: N/A — repo không có coverage tooling; gate = suite xanh + typecheck + lint

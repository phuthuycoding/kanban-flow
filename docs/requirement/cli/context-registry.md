---
feature: context-registry
context: cli
created: 20260920_1344
kind: feature
status: archived
---
# Spec Requirement

## Feature
context-registry

## Objective
Biến `context` từ một chuỗi tự do thành một danh sách khai báo trước, để gõ nhầm bị chặn ngay thay vì lặng lẽ sinh thêm một thư mục docs mới.

## Problem Statement
Hôm nay `context` đi qua bốn nấc — cờ `--context`, `defaultContext` trong config, context của work item gần nhất, rồi chuỗi `"app"` — và không nấc nào kiểm tra giá trị ngoài `assertPathName` (chữ, số, gạch ngang, gạch dưới). Hệ quả: `kf new x --context auth` và `kf new y --context authentication` tạo ra hai cây docs riêng biệt mà không lệnh nào báo. `assertPathName` còn có cờ `i`, nên `Auth` cũng qua được, và trên Linux nó là thư mục khác với `auth`.

Đây là lỗi chậm: nó không làm hỏng gì hôm nay, nó làm docs tản ra sau sáu tháng, đúng lúc người ta cần gom lại để viết hướng dẫn. Repo này đã có sẵn dấu hiệu: thư mục `docs/*/app/` rỗng do `kf init` tạo theo mặc định mà không ai dùng.

Việc đặt tên miền nghiệp vụ là việc của người hiểu sản phẩm, không phải thứ đoán ra từ cấu trúc thư mục. Nên công cụ không tự đặt; nó chỉ đưa cho agent một bản khảo sát để đề xuất, và người chốt.

## Scope
### In Scope
- Trường `contexts` trong `.kf/config.json`: danh sách context hợp lệ.
- `kf new` từ chối context không có trong danh sách, kèm gợi ý tên gần đúng.
- Lệnh mới `kf contexts`: liệt kê context đã khai và context đang thật sự dùng; khi chưa khai thì in bản brief để agent khảo sát repo và đề xuất.
- `kf init` hỏi thêm một câu về danh sách context.

### Out of Scope
- Đổi tên hoặc gộp context đã dùng, kể cả di chuyển docs đã sinh. Đó là thao tác phá vỡ, cần lệnh riêng.
- Sinh mục lục docs theo context. Nó cần danh sách context tin cậy, tức là cần đợt này xong trước.
- Để agent tự ghi `contexts` vào config mà không hỏi người.
- Ràng buộc context cho work item đã tồn tại. Chỉ chặn từ lúc tạo mới trở đi.

## Actors
- Đại ca, người khai danh sách context và chốt đề xuất
- Agent, người khảo sát repo và đề xuất danh sách
- `kf new`, nơi việc chặn thật sự xảy ra

## Functional Requirements
### FR-001
- Requirement: `.kf/config.json` nhận trường tuỳ chọn `contexts`, là mảng chuỗi không rỗng, mỗi phần tử hợp lệ theo `assertPathName`. Vắng mặt trường này nghĩa là chế độ tự do như hiện nay, nên project cũ không bị phá. Cấu hình sai kiểu phải fail với thông báo chỉ đúng tên trường, giống các trường khác trong config.
- Priority: must
- Notes: Thêm vào `ProjectConfig` và bộ validate trong `src/project/config.ts`.

### FR-002
- Requirement: Khi `contexts` đã khai, `kf new --context X` với X không thuộc danh sách phải từ chối với exit code 1, không tạo gì cả, và in ba thứ: X sai, tên gần đúng nhất nếu có, và cả danh sách đã khai. So sánh không phân biệt hoa thường, nên `Auth` bị từ chối kèm gợi ý `auth` thay vì lặng lẽ tạo thư mục thứ hai.
- Priority: must
- Notes: Gợi ý dùng khoảng cách Levenshtein, chỉ gợi ý khi khoảng cách đủ nhỏ để tránh gợi ý bừa.

### FR-003
- Requirement: Khi `contexts` đã khai, **phần tử đầu tiên chính là context mặc định**, và `defaultContext` không được tham khảo nữa. Khi `contexts` vắng mặt, `defaultContext` hoạt động y như hôm nay.
- Priority: must
- Notes: Đây là cách gỡ chứ không phải cách canh. Bản trước bắt `defaultContext` phải thuộc `contexts`, tức là vẫn để hai nguồn sự thật cho cùng một thứ rồi thêm luật giữ chúng đồng bộ. Luật nào cũng có thể bị vi phạm; một nguồn sự thật thì không. Bỏ hẳn khả năng cấu hình tự chặn chính mặc định của nó.

### FR-004
- Requirement: Lệnh mới `kf contexts [--json]`. Khi `contexts` đã khai: liệt kê từng context kèm số work item đang dùng, và đánh dấu riêng context **đang dùng nhưng chưa khai** để người ta biết mà bổ sung. Khi chưa khai: in bản brief hướng dẫn agent khảo sát repo và đề xuất, kèm danh sách context đang dùng trên đĩa.
- Priority: must
- Notes: Brief phải nói rõ nhóm theo miền nghiệp vụ chứ không theo tầng kỹ thuật, và phải nói rõ agent đề xuất cho người chốt chứ không tự ghi.

### FR-005
- Requirement: `kf init` **thay** câu hỏi `Default context for new features` bằng một câu duy nhất nhận danh sách phân tách dấu phẩy, nói rõ phần tử đầu là mặc định. Không thêm câu hỏi thứ bảy vào onboarding. Trên non-TTY hoặc `--defaults`, **chỉ khai danh sách khi có `--context` tường minh**; không có cờ thì để project tự do như trước. Trên TTY, bấm Enter qua câu hỏi cũng để project tự do nếu nó chưa khai gì.
- Priority: must
- Notes: Đại ca chọn hỏi ngay lúc init. Bản trước thêm câu thứ bảy và coi việc onboarding dài thêm là rủi ro phải chấp nhận; gộp hai câu thành một thì rủi ro đó biến mất, vì số câu hỏi không tăng.
- Sửa sau review vòng bốn: bản trước bắt `--defaults` luôn khai một phần tử. Điều đó khoá mọi project mới ngay lệnh thứ hai, làm brief của FR-004 **không bao giờ** hiện được nữa và làm checklist FR-006 luôn báo xong bằng một giá trị công cụ tự bịa. Công cụ không được tự khai thay người: khai là một quyết định, và `--defaults` nghĩa là không ai quyết cả.

### FR-007
- Requirement: Chạy lại `kf init` trên project **đã có** `.kf/config.json` mà chưa khai `contexts` thì không được tự ghi `contexts` vào. Chỉ ghi khi tạo config mới, hoặc khi người trả lời câu hỏi trên TTY.
- Priority: must
- Notes: Đây là cái bẫy em bỏ sót ở bản trước. Không có luật này thì chỉ cần nâng cấp `kf` rồi chạy lại `kf init --defaults` là project cũ lặng lẽ bật chế độ chặn với danh sách một phần tử, và mọi context khác đang dùng bị khoá. Nâng cấp công cụ không được phép đổi hành vi của dữ liệu đã có.

### FR-006
- Requirement: `kf autoconfig` thêm một dòng checklist cho `contexts`: đã khai thì báo đã khai và liệt kê, chưa khai thì báo chưa và gợi ý chạy `kf contexts`.
- Priority: should
- Notes: Giữ `kf autoconfig` là chỗ agent mới vào project đọc một lần biết thiếu gì.

## Non-Functional Requirements
- Không phá project cũ: `contexts` vắng mặt phải hành xử y hệt hôm nay.
- Thông báo từ chối phải đủ để sửa ngay trên dòng lệnh, không bắt người đi mở file config ra đọc mới biết có gì.
- Không thêm dependency. Levenshtein tự viết, vài dòng.

## Main Use Cases
- UC-001 Đại ca khai danh sách context lúc init
- UC-002 Gõ nhầm context bị chặn kèm gợi ý
- UC-003 Agent khảo sát repo rồi đề xuất danh sách context
- UC-004 Nhìn ra context đang dùng mà chưa khai

## Constraints
- `assertPathName` giữ nguyên, không siết thêm, vì nó còn dùng cho tên feature.
- Không đụng work item đã tồn tại và không di chuyển docs đã sinh.
- Giữ `files` trong `package.json` như hiện tại.

## Assumptions
- Một repo có khoảng 3 tới 7 context nghiệp vụ. Nhiều hơn thì danh sách tự nó mất tác dụng cảnh báo.
- Người dùng chấp nhận sửa `.kf/config.json` bằng tay để thêm context sau này; đợt này không làm lệnh thêm context.

## Acceptance Criteria
- [ ] Config có `contexts` sai kiểu thì fail kèm tên trường; `contexts` vắng mặt thì mọi thứ chạy như trước.
- [ ] `contexts` đã khai thì phần tử đầu là mặc định, và `defaultContext` dù có giá trị khác cũng không ảnh hưởng.
- [ ] Chạy lại `kf init --defaults` trên project cũ chưa khai `contexts` thì config không mọc thêm `contexts`.
- [ ] `kf new --context biling` khi đã khai `billing` trả exit 1, không tạo thư mục nào, và in gợi ý `billing` cùng cả danh sách.
- [ ] `kf new --context Auth` khi đã khai `auth` cũng bị từ chối kèm gợi ý, không tạo thư mục thứ hai.
- [ ] `kf new --context auth` khi đã khai `auth` chạy bình thường.
- [ ] `kf contexts` khi chưa khai in brief có đủ ba ý: nhóm theo nghiệp vụ, đề xuất 3 tới 7 tên, người chốt chứ agent không tự ghi.
- [ ] `kf contexts` khi đã khai liệt kê từng context kèm số work item, và đánh dấu context đang dùng mà chưa khai.
- [ ] `kf init --defaults --context cli` trên thư mục trống ghi `contexts: ["cli"]`; `kf init --defaults` không cờ thì **không** ghi `contexts`; `kf init` trên TTY hỏi **một** câu duy nhất và nhận danh sách phân tách dấu phẩy.
- [ ] `kf autoconfig` có dòng checklist cho `contexts`.

## Edge Cases
- `contexts` khai mảng rỗng: coi là cấu hình sai, không phải chế độ tự do.
- Context trùng nhau sau khi chuẩn hoá hoa thường, ví dụ khai cả `auth` và `Auth`: cấu hình sai.
- Repo đã có work item ở context chưa khai: không chặn gì với item cũ, nhưng `kf contexts` phải nêu ra.
- Gõ nhầm quá xa mọi tên đã khai: vẫn từ chối, chỉ là không gợi ý gì, và vẫn in cả danh sách.
- `kf new` không có cờ `--context`: dùng phần tử đầu của `contexts` khi đã khai, dùng `defaultContext` khi chưa. Không còn trường hợp mặc định nằm ngoài danh sách, vì mặc định **là** phần tử của danh sách.

## Open Questions
- Không còn. Ba điểm kiến trúc đã chốt với đại ca: lệnh riêng `kf contexts`, từ chối kèm gợi ý, và hỏi ngay lúc `kf init`.
- Sau khi đại ca yêu cầu gỡ rủi ro thay vì canh chừng, bản này bỏ luật đồng bộ `defaultContext` (FR-003 viết lại), gộp câu hỏi onboarding thay vì thêm (FR-005 viết lại), và thêm FR-007 chặn việc nâng cấp công cụ tự bật chế độ chặn trên dữ liệu cũ.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`), `npm run typecheck`, `npm run lint`
- Coverage Target: 80%

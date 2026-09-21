---
feature: kf-doctor
context: cli
created: 20260921_1405
status: archived
---
# Requirement

## Objective / Problem Statement
Khi một project kanban-flow hỏng, hiện không có lệnh nào trả lời được câu "cái gì đang hỏng?". `kf validate` chỉ nhìn **work item**; `kf autoconfig` chỉ nhìn **mức độ đã thiết lập** và luôn exit 0. Những hỏng hóc ở tầng project — config không parse được, một work item có `.kfw.json` rác, skills đã cài rồi bị xoá, stage dir bị mất — chỉ lộ ra khi một lệnh khác chết giữa chừng với thông báo không liên quan.

`kf doctor` là lệnh chẩn đoán: chạy một lượt, nói ra cái gì hỏng, và **có kết luận pass/fail**.

## Scope
### In Scope
- Lệnh mới `kf doctor [--json]`.
- Kiểm tra sức khoẻ ở tầng project: cấu trúc `.works/`, config đọc được, metadata của từng work item, skills đã cài, trường config kiểu cũ.
- Exit code phản ánh kết luận.

### Out of Scope
- **Tự sửa.** Doctor chẩn đoán, không chữa. Mỗi vấn đề kèm lệnh người dùng tự chạy.
- Lặp lại `kf validate`. Doctor tóm tắt **số** work item invalid và trỏ sang `kf validate --all`, không in lại từng finding.
- Kiểm tra mạng, npm registry, hay phiên bản CLI.

## Actors
- Người dùng vừa gặp một lỗi khó hiểu.
- Agent bắt đầu làm việc trên một repo lạ và muốn biết môi trường có lành không.

## Functional Requirements

- **FR-001** (must) — `kf doctor` chạy được từ thư mục gốc hoặc bất kỳ thư mục con nào, và báo lỗi rõ ràng khi không tìm thấy `.works/`.
- **FR-002** (must) — Kiểm và báo: `.works/` có đủ mọi stage directory không.
- **FR-003** (must) — Kiểm và báo: `.kf/config.json` có đọc và parse được không. Config hỏng là **fail**, không phải cảnh báo, vì mọi lệnh khác sẽ chết theo.
- **FR-004** (must) — Kiểm và báo: work item nào có metadata không đọc được hoặc không hợp lệ, kèm tên và đường dẫn.
- **FR-005** (must) — Kiểm và báo: skills đã cài cho những agent mà config khai, còn đủ file không.
- **FR-006** (should) — Kiểm và báo trường config kiểu cũ: `stack` (số ít) khi đã có `stacks`, và `defaultContext` khi đã khai `contexts` — cái sau bị bỏ qua nên gây hiểu nhầm.
- **FR-007** (must) — Tóm tắt số work item không hợp lệ, và trỏ sang `kf validate --all`. Bản thân việc có item invalid **không** làm doctor fail: đó là trạng thái bình thường của một pipeline đang chạy.
- **FR-008** (must) — Kết luận: exit `0` khi không có vấn đề mức ERROR, exit `1` khi có. WARNING không làm fail.
- **FR-009** (must) — `--json` mang cùng thông tin với bản text.

## Non-Functional Requirements
- Chỉ đọc. Doctor không bao giờ ghi, xoá hay sửa bất cứ thứ gì.
- Không ném ra ngoài: doctor phải chạy được **kể cả** khi config hỏng — đó chính là lúc người ta cần nó nhất.

## Main Use Cases
- **UC-001** — Chẩn đoán một project lành: mọi mục pass, exit 0.
- **UC-002** — Chẩn đoán một project hỏng: config không parse được, doctor vẫn chạy và chỉ đúng chỗ, exit 1.
- **UC-003** — Đọc bằng máy: agent chạy `kf doctor --json` để quyết định có làm tiếp được không.

## Test Strategy
- Level: unit+integration
- UI Tests: không
- Tools: vitest
- Coverage Target: N/A (chứng minh bằng mutation)

## Acceptance Criteria
- [ ] Project lành: exit 0, không mục ERROR nào.
- [ ] `.kf/config.json` chứa JSON hỏng: doctor **không ném**, in một ERROR nêu file và lý do, exit 1.
- [ ] Thiếu một stage directory: ERROR nêu đúng tên thư mục thiếu.
- [ ] Một work item có `.kfw.json` không hợp lệ: ERROR nêu tên item và đường dẫn.
- [ ] Skills bị xoá sau khi cài: ERROR kèm lệnh `kf install` để sửa.
- [ ] Config có `defaultContext` trong khi đã khai `contexts`: WARNING nói rõ trường đó bị bỏ qua, và **không** làm exit khác 0.
- [ ] Work item invalid không làm doctor exit 1; chỉ hiện ở dòng tóm tắt.
- [ ] `--json` chứa cùng các mục và cùng verdict với bản text.
- [ ] Doctor không ghi gì: cây thư mục và nội dung file không đổi sau khi chạy.

## Edge Cases
- Chạy ngoài project: thông báo rõ, exit 1, không stack trace.
- `.works/` có nhưng rỗng hoàn toàn: hợp lệ, không phải lỗi.
- Config hợp lệ nhưng không khai agent nào: kiểm skills theo agent mặc định.
- Một stage directory bị thay bằng một file: tính là thiếu.

## Documentation Impact

| Update needed? | Affected docs | Reason / intended update |
|---|---|---|
| Có | `docs/workflow/cli-reference.md` | Lệnh mới. |
| Có | `skills/kanban-flow/SKILL.md` | Thêm vào CLI reference của skill. |

## Open Questions
- Không còn.

---
feature: "kf-doctor"
context: "cli"
created: "20260921_1406"
---

# Test Cases

## Feature
kf-doctor

## TC-001
FR-001 UC-001
Chạy `kf doctor` từ một thư mục con của project; lệnh tìm được gốc và chạy. Chạy ngoài mọi project: thông báo rõ, exit 1, không stack trace.

## TC-002
FR-002 UC-002
Xoá một stage directory: doctor báo ERROR nêu đúng tên thư mục thiếu. Thay một stage directory bằng một file: cũng tính là thiếu.

## TC-003
FR-003 UC-002
`.kf/config.json` chứa JSON hỏng: doctor **không ném**, in ERROR nêu file, exit 1.

## TC-004
FR-004 UC-002
Một work item có `.kfw.json` không hợp lệ: ERROR nêu tên item và đường dẫn.

## TC-005
FR-005 UC-001
Xoá skills sau khi cài: ERROR kèm lệnh `kf install`.

## TC-006
FR-006 UC-002
Config có `defaultContext` cùng lúc với `contexts`: WARNING nói trường đó bị bỏ qua, và verdict **không** vì nó mà thành fail.

## TC-007
FR-007 UC-001
Project có work item invalid: dòng tóm tắt nêu số lượng, verdict vẫn healthy, exit 0.

## TC-008
FR-008 UC-001
Project lành: exit 0. Project có một ERROR: exit 1.

## TC-009
FR-009 UC-003
`kf doctor --json` chứa cùng danh sách findings và cùng `ok` với bản text.

## TC-010
FR-001 UC-001
Doctor chỉ đọc: chụp cây thư mục và nội dung file trước/sau khi chạy, hai bản giống nhau.

# Artifact contract và cấu trúc đọc

Artifact được viết trong work item folder dưới `.works/`. Mỗi file trả lời một câu hỏi khác nhau; không dùng một report để thay thế report của phase khác.

## Thứ tự đọc trong work item

```text
phase-1-spec-requirement.md
├── phase-2-implementation-plan.md       (feature only)
├── phase-2-use-case-specification.md    (feature only: index + coverage)
├── use-cases/UC-###.md                   (feature only: mỗi UC một file)
├── phase-2-use-case-diagram.md           (feature only)
└── phase-2-test-case.md                  (feature only: test contract)
    └── phase-4-testing-result.md         (kết quả một execution)
        └── phase-5-review-report.md      (review cùng execution)
            └── phase-6-feature-report.md (feature only: bàn giao)
```

Bug dùng template `phase-1-bug-report.md` nhưng vẫn lưu triage record tại `phase-1-spec-requirement.md` để tương thích CLI. Ngoài hồ sơ này, bug chỉ cần testing/review report; không bắt buộc bộ planning hay feature report. Nếu phát sinh hành vi mới ngoài phạm vi sửa defect, báo thay đổi scope để người dùng quyết định có lập feature riêng hay không.

`phase-2-use-case-specification.md` chỉ là index. Narrative của feature phải nằm trong `use-cases/UC-###.md`, với ID trong tên file trùng ID được khai báo bên trong file. Test case phải liên kết được `FR-###` → `UC-###`.

## Quy ước chung

| Quy ước | Ý nghĩa |
|---|---|
| Frontmatter | Nhận diện work item, context, status và execution hiện tại |
| Placeholder | Chỉ tồn tại trong template; trước gate phải thay toàn bộ bằng nội dung thật |
| ID | `FR-###`, `UC-###`, `TC-###`; dùng nhất quán trong mọi artifact |
| Status report | Testing: `PASS/FAIL/REJECT/BLOCKED`; review: `PASS/FAIL/REJECT/REQUIREMENT_BUG` |
| Execution | Testing và review phải cùng `executionId` của lần chạy hiện tại |
| Bảng tổng hợp | Tổng số phải khớp với các dòng chi tiết, không chỉ ghi mô tả định tính |

CLI kiểm tra file, placeholder, ID reference, approval fingerprint và execution/status của report. Tổng số trong bảng, coverage đo thực tế và chất lượng narrative cần agent kiểm tra khi planning/test/review; việc validator PASS không tự chứng minh các nội dung này.

## Khi archive vào `dones`

`kf archive` giữ nguyên bộ artifact trong `.works/dones/{feature}_{timestamp}/` để audit. Với feature, CLI copy tài liệu người đọc thường xuyên sang canonical docs:

| Canonical doc | Nội dung |
|---|---|
| `docs/requirement/{context}/{feature}.md` | Requirement đã archive |
| `docs/use-cases/{context}/{feature}/README.md` | Index và coverage UC |
| `docs/use-cases/{context}/{feature}/UC-###.md` | Narrative từng use case |
| `docs/use-cases/{context}/{feature}/diagram.md` | Sơ đồ actor/use case |
| `docs/testplan/{context}/{feature}.md` | Test plan và ma trận coverage |
| `docs/testplan/{context}/{feature}-result.md` | Kết quả execution gần nhất |

Với bug, archive không tự tạo hoặc ghi đè docs feature cũ. Skill archive chỉ cập nhật docs liên quan khi bug report ghi rõ docs impact; nếu không, nêu rõ “No documentation update required” trong closure/review.

Archive lại feature đã ở `dones` sẽ từ chối ghi đè canonical docs có thay đổi so với snapshot, để giữ các cập nhật từ bug hoặc tài liệu bổ sung. Dùng `--skip-specs` để giữ nguyên docs; `--force` chỉ khi có chủ đích khôi phục snapshot cũ.

## Checklist trước khi đóng

- [ ] Requirement/bug report đã `confirmed` và không còn placeholder.
- [ ] Feature: bốn planning artifact, các file UC riêng và ma trận test khớp ID.
- [ ] Bug: triage record đủ reproduction, severity và regression strategy.
- [ ] Testing và review là `PASS`, cùng execution hiện tại.
- [ ] Feature report đã ghi thay đổi thực tế, test, docs và giới hạn còn lại (bug không bắt buộc).
- [ ] Canonical docs đã sync khi cần; không có thao tác database, deploy hoặc publish ngoài scope được duyệt.

# Kanban Flow

Workflow được điều khiển bằng CLI `kf` và tám skill trong `skills/`.

```text
brainstorm → planning → implementation → testing → review → dones
                 ↘ backlog ↗
```

Feature/bug cần human confirmation; planning cần human approval gắn với nội dung contract. Sau approve, user chọn triển khai ngay hoặc để backlog. Feature tạo đủ planning artifact và feature report; bug chỉ cần triage report cùng test/review evidence. Mỗi vòng testing có execution id riêng, testing và review đều phải PASS cho lần chạy đó. Feature nhận bộ docs canonical (`docs/requirement`, `docs/use-cases`, `docs/testplan`) khi archive; bug chỉ cập nhật docs liên quan nếu cần. FAIL/REJECT quay về implementation; REQUIREMENT_BUG dừng work item.

Xem [hướng dẫn cài đặt, CLI, gate và hooks](../README.md) để dùng workflow hiện tại. Templates nằm trong `kanban-flow/templates/`; project và user overrides nằm trong `.kf/`.

---
name: kanban-bug
description: 'Kanban bug workflow — triage and document a defect with reproduction, expected/actual result, severity, root cause and regression coverage before handing off to kanban-plan. Use when a work item has kind: bug.'
---

# Kanban Bug — Triage và sửa defect

Argument: `<bug_name>`.

Bug vẫn đi qua cùng state machine và approval gate với feature, nhưng Phase 1 bắt buộc ghi nhận đủ thông tin để tái hiện và ngăn regression.

## 1. Verify

```bash
kf status --change {bug_name}
kf show {bug_name}
```

Chỉ dùng skill này khi metadata có `kind: bug` và work item đang ở `brainstorm`. Nếu bug đã ở `planning`, `backlog`, `implementation`, `testing` hoặc `review`, resume skill tương ứng; không tạo lại artifact.

## 2. Triage contract

Đọc và điền `phase-1-spec-requirement.md` bằng template bug (`kf instruct spec-requirement --change {bug_name}`):

- Severity và môi trường bị ảnh hưởng.
- Các bước reproduce đủ deterministic.
- Actual result và expected result.
- Phạm vi fix in/out và acceptance criteria cho hành vi regression cần bảo vệ.
- Suspected root cause nếu đã có bằng chứng; nếu chưa biết, ghi rõ chưa xác định.
- Regression test strategy và acceptance criteria có thể kiểm chứng.
- Related feature nếu xác định được; docs impact: cần sửa file nào và vì sao, hoặc không cần cập nhật docs.

Không đoán root cause để làm đẹp báo cáo. Nếu chưa reproduce được, báo rõ blocker và không giả định bug đã PASS.

## 3. Human confirmation

Tóm tắt bug, severity, reproduction, impact, expected fix và regression test cho người dùng. Chỉ khi người dùng xác nhận mới đổi frontmatter `status: confirmed` và chạy:

```bash
kf stage {bug_name} planning
```

Sau đó load `kanban-plan` theo nhánh bug. Bug report là execution contract; không tạo implementation plan, use-case index/narratives/diagram, test plan hay feature report. Planning vẫn phải được human approve và người dùng chọn start/backlog.

## 4. Handoff

```text
Bug report đã confirmed. Load kanban-plan theo nhánh bug để approve triage contract và hỏi start/backlog; giữ reproduction và regression test trong phạm vi đã duyệt.
```

FAIL/REJECT trong testing hoặc review quay về implementation. `REQUIREMENT_BUG` vẫn dừng để người dùng quyết định; không dùng nó thay cho bug report.

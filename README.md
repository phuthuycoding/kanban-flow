# kaban-flow

MỘT skill duy nhất điều khiển toàn bộ vòng đời feature: **brainstorm → plan → implement → test → review → archive**. Người dùng chỉ cần nghĩ và mô tả ý tưởng — agent tự quyết định mọi thứ còn lại.

## Install

Repo private nên dùng git clone (không `curl | bash`):

```bash
git clone git@github.com:phuthuycoding/kaban-flow.git /tmp/kaban-flow
cd /tmp/kaban-flow && ./install.sh
```

Init project:

```bash
cd your-project
/path/to/kaban-flow/install.sh init
```

## Usage

Gõ **MỘT lệnh duy nhất**:

```text
kanban {context} {feature}
# ví dụ: kanban auth user-login
```

Agent tự làm hết:
1. Brainstorm — hỏi chỉ những gì thật sự mơ hồ, tạo spec + design + impact
2. Plan — test plan (input/expected) + tasks breakdown
3. Implement — spawn agent song song, tick tasks
4. Test — chạy test, viết testing-report.md
5. Review — load rules (global + project), viết review-report.md
6. Archive — sync docs, commit

Chỉ dừng lại khi **thật sự bị kẹt**: build fail (sau khi đã auto-fix), test fail, hoặc HIGH violations.

## How it works

Feature là 1 folder di chuyển qua các trạng thái trong `.works/`:

```
pending/ → doing/ → testing/ → review/ → dones/
```

State tracking = filesystem location. Không DB, không config file.

Mỗi feature folder `.works/{state}/{featureName}_{timestamp}/` chứa:
- `usecase-spec.md`
- `design.md`
- `test-plan.md` — Given/When/Then + Input + Expected Output
- `tasks.md` — checklist implement
- `testing-report.md` — kết quả test (luôn tạo, PASS hay FAIL)
- `review-report.md` — kết quả review

Canonical spec: `docs/use-cases/{context}/{feature}.md`.

## Review rules

- Global: `~/.claude/kanban-flow/review/rules/` (general, security, performance, + `{stack}.md`)
- Project: `{project}/.claude/review/rules/*.md` — ghi đè global nếu trùng tên

## Structure

```
~/.claude/
├── skills/kanban-flow/SKILL.md   ← skill duy nhất
└── kanban-flow/
    ├── templates/                ← usecase-spec, design, test-plan, tasks, testing-report, review-report
    └── review/rules/             ← general, security, performance

{project}/
├── .works/{backlog,pending,doing,testing,review,dones}/
├── docs/use-cases/{context}/{feature}.md
└── .claude/review/rules/         ← project-specific rules
```

## Uninstall

```bash
/path/to/kaban-flow/install.sh uninstall
```

## License

MIT
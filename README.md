# kaban-flow

Kanban workflow cho AI-assisted feature development — brainstorm → plan → implement → test → review → archive. Skills-based, dùng được trên mọi tool đọc `~/.claude/skills/` (opencode, Claude Code...).

## Install

Repo private nên không dùng `curl | bash` được. Install bằng git clone:

```bash
git clone git@github.com:phuthuycoding/kaban-flow.git /tmp/kaban-flow
cd /tmp/kaban-flow
./install.sh                 # global install (skills + templates + review rules vào ~/.claude/)
cd /tmp && rm -rf kaban-flow  # xoá source (optional)
```

Rồi init project:

```bash
cd your-project
bash <(git -C /tmp/kaban-flow show main:install.sh) init   # nếu còn giữ clone
# hoặc đơn giản hơn: re-clone rồi chạy ./install.sh init
```

## Usage

**Manual mode** (6 bước riêng, gate tại mỗi bước):
```text
1. /kanban-brainstorm {context} {feature}   → usecase spec + design + impact
2. /kanban-plan      {context} {feature}    → test plan + tasks breakdown
3. /kanban-implement  {context} {feature}   → spawn parallel agents, code
4. /kanban-test       {context} {feature}   → chạy test theo plan
5. /kanban-review     {context} {feature}   → review theo rules (global + project)
6. /kanban-archive    {context} {feature}   → archive + sync docs
```

**Auto mode** (chỉ cần brainstorm + plan, còn lại chạy tự động):
```text
1. /kanban-brainstorm {context} {feature}   → usecase spec + design
2. /kanban-plan      {context} {feature}    → test plan + tasks
3. /kanban-run       {context} {feature}    → implement → test → review → archive TỰ ĐỘNG
```

## How it works

Feature là 1 folder di chuyển qua các trạng thái:

```
.works/pending/ → .works/doing/ → .works/testing/ → .works/review/ → .works/dones/
```

State tracking = filesystem location. Không cần DB, không cần config file.

Mỗi feature folder trong `.works/{state}/{featureName}_{timestamp}/` chứa:
- `test-plan.md` — test cases (Given/When/Then + Input + Expected Output)
- `tasks.md` — checklist implement (checkbox `- [ ]` → `- [x]`)
- `review-report.md` — kết quả review (sau bước 5)

Canonical spec lưu tại `docs/use-cases/{context}/{feature}.md`.

## Review rules

Global rules: `~/.claude/kanban-flow/review/rules/`
Project rules: `.claude/review/rules/` (override global nếu trùng tên file)

## Structure

```
~/.claude/kanban-flow/
├── templates/          ← artifact templates (use-case, test-plan, tasks, review-report)
└── review/rules/       ← general.md, security.md, performance.md, {stack}.md

{project}/
├── .works/
│   ├── backlog/  pending/  doing/  testing/  review/  dones/
├── docs/use-cases/{context}/{feature}.md
├── .claude/review/rules/     ← project-specific rules
```

## Uninstall

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phuthuycoding/kaban-flow/main/install.sh) uninstall
```

## License

MIT
# kaban-flow

**Skill orchestrator** điều khiển vòng đời feature/bug: **brainstorm → plan → backlog hoặc implement → test → review → archive**, được ép bởi CLI `kf`. Skill `kanban-flow` delegate từng phase sang skill con; bug đi qua `kanban-bug` để triage. Người dùng tham gia ở Phase 1, Phase 2 approval và quyết định triển khai ngay hay để backlog.

## Why kaban-flow

Workflow nhưng **fail-closed như CI** — artifact là contract, agent là executor, người quyết ở đúng 2 gate.

- **Deterministic gates** — `kf stage` refuse transition khi artifact thiếu, rỗng, còn placeholder hoặc chứa secret thật (`artifact_secret`); report chưa `PASS` không cho tiến. State thật nằm ở `.works/` + `.kfw.json`, không dựa vào lời khai của agent.
- **Contract fingerprint** — SHA-256 của requirement + planning artifacts + UC files; sửa contract sau `kf approve` → approval invalidate, phải quay lại planning duyệt lại. Mỗi lần vào testing tạo **execution id** mới → FAIL loop bắt buộc test lại thật, report cũ không ăn được.
- **Traceability xuyên suốt** — `FR-### → UC-### → TC-### → implementation → test evidence → review finding`; validator check ID khớp chính xác (`FR-001` ≠ `FR-0010`), mỗi UC một file riêng.
- **Human gates đúng chỗ** — chỉ confirm requirement (Phase 1) và approve contract + start/backlog (Phase 2). `REQUIREMENT_BUG` freeze pipeline báo user; agent không tự viết lại requirement.
- **Skills có răng** — `kanban-review` săn AI-code risks (phantom tests, catch-and-swallow, scope drift), threat-model trước khi apply security finding; `kanban-implement` ép subagent prompt contract (task/files/acceptance/constraints) + status protocol.
- **Onboarding thực dụng** — `kf init` hỏi đúng câu cần hỏi (TTY radio quick/custom); `kf rules` cài 7 stack packs, monorepo detect nhiều stacks; `kf autoconfig` in setup briefing cho agent mới vào project.
- **Install/uninstall 2 scope** — user (`~/.claude/skills`) vs project (`{root}/.claude/skills`), 6 agents; uninstall chỉ gỡ managed skills, `--purge` có confirm mới xoá `.works/`/`.kf/`/docs.
- **Hooks + dashboard** — phase hooks `.kf/hooks/{phase}.sh` resolve project → user → package, exit non-zero chặn transition; `kf dashboard` KPI + charts filter theo context/feature/bug.

## Install

Repo private nên dùng git clone (không `curl | bash`):

```bash
git clone git@github.com:phuthuycoding/kaban-flow.git /tmp/kaban-flow
cd /tmp/kaban-flow && npm install && npm run build && npm link && kf install
```

`npm link` đưa CLI `kf` lên PATH; `kf install` copy 8 skills vào skill dir của từng agent (mặc định `claude` → `~/.claude/skills/`). Hỗ trợ 6 agent: `--agent claude --agent codex --agent gemini --agent kiro --agent cursor --agent opencode`. Yêu cầu Node >= 20.

Init project:

```bash
cd your-project
kf init                        # onboarding: hỏi câu hỏi trên TTY (context, stack, reviewer, agent, .gitignore, seed demo)
kf init --defaults             # onboarding không hỏi — auto-detect + defaults (dùng cho agent/non-TTY)
kf init --agent codex --agent kiro   # cài skills cho nhiều agent cùng lúc (.agents/skills, .kiro/skills...)
kf init --minimal              # chỉ tạo .works/ + docs roots + cài skills; không seed config/templates
```

`kf init` hỏi và ghi vào `<project>/.kf/config.json`:
- **default context** cho `kf new` (default `app`)
- **tech stacks** (auto-detect từ manifests kể cả monorepo subdirs, dùng cho review rules)
- **reviewer mặc định** cho `kf approve --by` (default từ `git config user.name`)
- **agents** nào sẽ dùng skills (multi-select, comma-separated, default `claude`) — cài đúng thư mục từng agent
- có thêm `.works/` vào `.gitignore` không (chỉ khi là git repo)
- có seed một feature demo để xem cấu trúc không

Mỗi câu có default — Enter để chấp nhận. Dùng `--defaults` trong agent/non-TTY (không treo prompt).

Tài liệu workflow chi tiết, state diagram, gate, CLI và skill routing: [docs/workflow/README.md](docs/workflow/README.md).

## Usage

Gõ **MỘT lệnh duy nhất**:

```text
kanban {context} {feature}
# ví dụ: kanban auth user-login
```

Agent thao tác state qua `kf`:

```text
kf new {feature} --context {context} [--type feature|bug] # mở Phase 1: tạo work item ở brainstorm
kf status --change {feature}            # checklist artifact + Next: + Approval state
kf instruct {artifact} --change {feature} # template, execution id và đường dẫn file cần viết
kf approve {feature}                    # Phase 2 HITL gate: chốt execution contract
kf stage {feature} {phase}              # move theo graph: forward + FAIL loop back
kf validate --all                       # lỗi gì đang chặn gate / traceability lỏng
kf archive {feature}                    # review(PASS) → dones + copy canonical docs
kf rules [--stack {id}] [--list] [--force] # copy stack review rules vào .kf/review/rules (auto-detect)
kf autoconfig                          # in briefing cho agent: context + checklist config + rules + workflow guide
kf dashboard                           # KPI + charts, filter context/feature/bug (mặc định :8787, đổi bằng --port)
```

Không bao giờ `mv` folder thủ công — gate + hook sẽ chạy theo mỗi transition.

## Phases & artifact gates

| Phase | Artifact (bắt buộc để rời phase) |
|-------|---------------------------------|
| 1. Brainstorm | `phase-1-spec-requirement.md` với `status: confirmed` |
| 2. Planning | Feature: four phase-2 files + `use-cases/UC-###.md`; bug: confirmed bug report. **Human approval** (`kf approve`) cho cả hai |
| Backlog | Contract đã approve nhưng chưa triển khai; chờ user chọn start |
| 3. Implement | tự do (tasks.md để track) |
| 4. Testing | `phase-4-testing-result.md` — chỉ `PASS` được vào Review |
| 5. Review | `phase-5-review-report.md` — chỉ `PASS` được archive; `REQUIREMENT_BUG` → STOP feature |
| 6. Closure | Feature: viết `phase-6-feature-report.md`, CLI copy canonical docs khi archive. Bug: update docs liên quan nếu cần rồi archive |

`kf stage` kiểm tra artifact tồn tại, có nội dung, không còn placeholder và không chứa secret thật (Bearer token, API key, private key — placeholder như `{key}`/`changeme` không bị flag); directional gate chặn tiến khi report chưa PASS. Với feature, `kf validate` yêu cầu file UC riêng và từng section `## TC-XXX` tham chiếu FR có trong requirement và UC có file tương ứng. Agent kiểm tra tổng số và coverage trong bảng test plan. Bug chỉ cần bug report, testing result và review result; không bị ép tạo planning artifact của feature. Tasks chưa hoàn thành cũng chặn tiến.

`kf approve` chỉ duyệt khi requirement/bug report đã confirmed. Feature cần bốn artifact planning và các file UC; bug dùng bug report làm contract. Sau approve, agent hỏi triển khai ngay hay đưa vào backlog. Approval fingerprint bao gồm toàn bộ contract tương ứng; sửa contract sau approve sẽ chặn execution. Khi cần đổi scope theo chỉ đạo của người dùng, chạy `kf stage {feature} planning`, sửa contract và duyệt lại.

Mỗi lần vào testing tạo execution id mới. Report testing/review phải có `execution:` khớp id này; lấy template qua `kf instruct ... --change {feature}`. FAIL/REJECT quay về implementation, sửa rồi vào testing lại; report cũ được giữ nhưng không qua gate. BLOCKED dừng để xử lý môi trường. REQUIREMENT_BUG chặn mọi chuyển stage thông thường và phải báo lại người dùng.

`kf stage {feature} dones` dùng cùng logic với `kf archive`: kiểm tra reports, chạy hook và cập nhật metadata. Feature cần feature report và được copy canonical docs; bug chỉ cập nhật docs liên quan nếu cần, CLI không tự copy bug report vào docs feature. Tên feature/context chỉ gồm chữ, số, `-`, `_` và bắt đầu bằng chữ hoặc số; không tạo trùng tên. `kf status --all` bao gồm cả dones, `kf view --json` trả metrics/charts và chi tiết stages, và validation thất bại trả exit code 1 ở cả text lẫn JSON.

Dashboard hiển thị số liệu và chart theo stage, loại work item, context, approval cùng tiến độ task đang thực thi. Xem [dashboard analytics](docs/workflow/dashboard.md) để hiểu công thức và phạm vi thống kê.

Feature từ phiên bản cũ thiếu fingerprint hoặc có fingerprint chưa bao gồm file UC phải quay về planning để duyệt lại; report thiếu execution id phải được tạo lại qua testing. Agent vẫn phải chạy test thật và ghi evidence: CLI kiểm tra hợp đồng artifact, không tự chứng minh kết quả test hoặc coverage.

## Phase hooks

Mỗi phase có thể đính kèm hook script chạy **trước khi feature enter phase đó** (resolve precedence: project → user → package):

```text
{root}/.kf/hooks/{phase}.sh     # project (ưu tiên nhất)
~/.kf/hooks/{phase}.sh
{package}/kanban-flow/hooks/{phase}.sh
```

phase = `brainstorm | planning | backlog | implementation | testing | review | dones`. Ví dụ file `planning.sh`:

```bash
#!/usr/bin/env bash
echo "planning entry: ${KFW_FEATURE} -> ${KFW_TO_STAGE}"
```

Env bơm vào hook: `KFW_FEATURE`, `KFW_CONTEXT`, `KFW_FEATURE_DIR`, `KFW_WORK_ROOT`, `KFW_FROM_STAGE`, `KFW_TO_STAGE`, `KFW_APPROVAL`. Hook exit non-zero → **transition bị chặn** (bỏ qua bằng `--skip-hooks`).

## Review rules

- Global: `~/.kf/review/rules/` (general, security, performance, + `{stack}.md`)
- Project: `{project}/.kf/review/rules/*.md` — ghi đè global nếu trùng tên
- Package: `kanban-flow/review/rules/` — fallback khi project/user chưa có rules

Stack best-practice packs (`node`, `go`, `rust`, `python`, `php`, `ruby`, `java`) ship sẵn trong package; cài vào project bằng `kf rules` (auto-detect từ manifest) hoặc `kf rules --stack go`. `kf rules --list` xem packs; `--force` ghi đè file project đã sửa tay. `kanban-review` load rules này tự động khi review.

## Structure

```
~/.kf/                          ← user-scope config (optional overrides)
├── templates/                  ← phase-1..phase-6 templates
├── hooks/                      ← phase hooks
└── review/rules/               ← general, security, performance

{project}/
├── .kf/                        ← project-scope config (kf init tạo)
│   ├── config.json             ← defaultContext, stacks, reviewer, agents
│   ├── templates/              ← project overrides
│   ├── hooks/                  ← phase hooks
│   └── review/rules/           ← project review rules
├── .works/{brainstorm,planning,backlog,implementation,testing,review,dones}/
└── docs/
    ├── requirement/{context}/{feature}.md
    ├── use-cases/{context}/{feature}/README.md + UC-###.md + diagram.md
    └── testplan/{context}/{feature}{,-result}.md

skills (mặc định cho claude; `--agent <id>` đổi agent):
  claude   → ~/.claude/skills/  + {project}/.claude/skills/
  codex    → ~/.agents/skills/  + {project}/.agents/skills/
  gemini   → ~/.gemini/skills/  + {project}/.gemini/skills/
  kiro     → ~/.kiro/skills/    + {project}/.kiro/skills/
  cursor   → ~/.cursor/skills/  + {project}/.cursor/skills/
  opencode → ~/.config/opencode/skills/ + {project}/.opencode/skills/

mỗi agent đều có 8 skills: kanban-flow + kanban-{bug,brainstorm,plan,implement,test,review,archive}/
```

## Uninstall

`kf install`/`kf uninstall` mặc định thao tác ở **user scope** (`~/...`); `--project` chọn **project scope** (`{project}/.claude/skills/...`, resolve về `.works/` root gần nhất); `--all` làm cả hai.

```bash
kf uninstall                          # gỡ 8 skills khỏi ~/.claude/skills/ (mặc định claude, user scope)
kf uninstall --project                # gỡ skills mà kf init cài vào {project}/.claude/skills/
kf uninstall --all                    # gỡ cả user lẫn project scope
kf uninstall --purge                  # gỡ project skills + xoá .works/, .kf/, docs/{requirement,use-cases,testplan}/ (hỏi confirm; --force bỏ qua)
kf uninstall --agent codex --agent kiro   # gỡ khỏi đúng agent đó
npm rm -g kaban-flow                  # gỡ CLI
```

Mặc định uninstall chỉ gỡ managed skills — `.works/`, `.kf/` và canonical docs là data của project nên giữ lại. `--purge` mới xoá hẳn (và luôn hỏi trước trên TTY).

## License

MIT

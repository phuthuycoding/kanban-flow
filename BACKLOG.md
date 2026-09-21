# Backlog

Các hạng mục biết là còn mềm / muốn làm tiếp. Không theo thứ tự bắt buộc — mỗi item ghi context + vì sao.

## P1 — Trust & evidence

- [ ] **`kf` tự chạy test command để verify evidence.** Hiện CLI chỉ check hợp đồng artifact (file tồn tại, status hợp lệ, execution id khớp) — agent xấu vẫn bịa được report PASS. Hướng: `kf test --run "<cmd>"` chạy lệnh thật, ghi exit code + output hash vào report, hoặc `kf stage` đối chiếu command log. Scope to — quyết định tin agent tới mức nào trước.
- [ ] **Secret scan nâng cấp.** Exemption đã áp lên value (2026-09-19), nhưng vẫn regex-based nên lọt format lạ/obfuscated. Cân nhắc entropy check cho `KEY=value` + thêm pattern (JWT `eyJ`, Slack webhook URL, connection string `://user:pass@`). Giữ nguyên tắc: không flag placeholder, không echo giá trị secret.

## P2 — Workflow gaps

- [ ] **Bridge async giữa các agent.** Harness v1 chạy đồng bộ dưới main. Khi main không còn sống (Devin chạy cả giờ rồi mới báo lại) cần inbox file + đánh thức CLI bên kia theo session đã ghim (prototype bash `test-plan/bridge` bên moigo). Làm trên nền `harness.runners` + `sessions` đã có; chú ý hop limit chống lặp.
- [ ] **`kf supersede <old> --by <new>`.** Liên kết hai work item thay thế nhau thay vì chỉ ghi lý do dạng chữ trong `kf cancel`; giúp truy ngược "ý tưởng này đã bị thay bằng cái gì".
- [ ] **`kf run --task "<mô tả>" --out <file>`.** Việc ad-hoc ngoài 6 stage (ví dụ "khảo sát 3 thư viện rồi so sánh" trước khi plan). Cần thiết kế output path và cách ghi `runs[]` cho việc không thuộc stage nào.
- [ ] **Harness: xác minh resume cho gemini/opencode.** gemini `-r` nhận `latest`/index, chưa rõ UUID; opencode `run -s <id>` có nhưng chưa biết cách lấy id. Có login thì thêm `resume` vào preset.
- [ ] **Dùng harness thật trên một repo.** Bật `harness.stages` với hai vai khác model và chạy trọn một feature, để biết bảng role nên có những gì và chi phí thật ra sao.

- [ ] **Locking cho concurrent agents.** File-based state chưa có lock — 2 agent cùng đụng 1 feature sẽ đạp nhau. Hiện single-flow nên chưa đau; khi nào có nhu cầu multi-agent thì làm `.kfw.lock` + stale-lock detection.
- [ ] **Adversarial validation cho bug review** (ý tưởng từ ClaudeKit `adversarial-validation`): review bug report phải nêu reachable regressions + claims đã bị disprove — hiện bug flow nhẹ, chỉ check reproduction/regression scope.

## P2b — Docs debt (soi ra khi review `open-source-ready`, đều là sai sót có sẵn)

Mười ba chỗ tài liệu nói sai về mã. Bản tiếng Việt cũ cũng sai y hệt nên đợt dịch không gây ra, và FR-008 chốt phạm vi là "chỉ đổi ngôn ngữ" nên không sửa lén trong đợt đó. Mỗi mục đều đã tái hiện được.

- [ ] **HIGH `state-machine.md:66-80`** — mẫu "minimum metadata" thiếu `created`, mà `readFeatureMeta` bắt buộc. Dán đúng mẫu đó vào `.kfw.json` là `metadata_invalid`, và thông báo lỗi không nói thiếu trường nào.
- [ ] **HIGH `cli-reference.md:3`** — "Every command looks for `.works/` from the current directory upwards" sai với `kf init`: `init.ts:16` dùng `resolve(cwd, …)` không đi ngược lên. Chạy `kf init` trong subdir của project đã init sẽ lặng lẽ tạo `.works/`, `.kf/` và skills thứ hai.
- [ ] **HIGH `--minimal` mô tả sai ở cả doc lẫn CLI help** — `cli-reference.md:11` và `args.ts:31` nói nó chỉ tạo `.works/` + docs roots, thực tế nó còn ghi `.kf/config.json` đủ 6 role 5 runner, `.kf/{templates,hooks,review/rules}` và `AGENTS.md`. Sửa cả hai chỗ cho khớp mã, hoặc sửa mã cho khớp lời hứa.
- [ ] **MEDIUM `dashboard.md:12`** — công thức completion rate ghi "dones chia tổng item", mã là `percentage(completed, items.length - cancelled)`. Với 3 item 1 dones 1 cancelled, doc đoán 33%, dashboard hiện 50%. Sai từ lúc `cancelled` đổi mẫu số.
- [ ] **MEDIUM `gates.md:3`** — "`kf validate` chạy cùng validator" sai: `validateFeature` không gọi `checkDirectionGate`, nên `tasks_incomplete` và `testing_already_pass` vô hình với `kf validate` rồi mới chặn ở `kf stage`.
- [ ] **MEDIUM `cli-reference.md:53`** — "exits 1 and reports on stderr" ngược: `index.ts:112-115` in báo cáo đọc được ra **stdout**, stderr chỉ có một dòng cụt. CI làm `kf validate --all 2>err.log` sẽ không bắt được mã lỗi nào.
- [ ] **MEDIUM `skills.md:37`** — bảo `kanban-archive` tự sync canonical docs, trong khi `skills/kanban-archive/SKILL.md:30` cấm thẳng. Copy tay bỏ qua bước rewrite link và dấu `status: archived`, sau đó archive lại sẽ bị từ chối.
- [ ] **MEDIUM `skills.md` không nhắc harness một chữ nào** — trong khi `docs/README.md:12` giới thiệu nó là "what the orchestrator owns", còn `skills/kanban-flow/SKILL.md:69-86` giao cho orchestrator nghĩa vụ cứng ở đó.
- [ ] **MEDIUM `cancelled` vắng mặt khắp workflow guide** — cây thư mục ở `docs/workflow/README.md:48-54` không có `.works/cancelled/`, dòng 27 liệt kê lệnh di chuyển mà bỏ `kf cancel`, sơ đồ ở dòng 5-8 cũng thiếu. `kanban-flow/README.md:5-10` y hệt. Người huỷ xong không tìm thấy item trong cây đã ghi.
- [ ] **MEDIUM `harness.md` không được index nào trỏ tới** — là file duy nhất trong `docs/workflow/` vắng mặt ở cả `docs/README.md` lẫn `docs/workflow/README.md`, dù nó là tài liệu duy nhất cho `kf run`, `kf runs` và `kf harness`.
- [ ] **MEDIUM `dashboard.md` phần KPI thiếu và một claim filter sai** — bảng ghi 5 trong 7 tile thật (thiếu `Cancelled` và `Gate bypasses`); dòng 22 nói thanh approval loại brainstorm và dones, nhưng item đã huỷ vẫn bị đếm vào cột pending.
- [ ] **LOW hai skill nói sai tên trường** — `kanban-brainstorm/SKILL.md:242` và `kanban-plan/SKILL.md:26` bảo ghi "đúng" nhãn `Test Level`, nhưng template feature dùng `- Level:`; `Test Level` là nhãn của template bug. Cả bốn spec trong repo này đều dùng `- Level:`. Thêm: `kanban-brainstorm/SKILL.md:298` gọi spec Phase 1 là nguồn của "use-case narratives", mâu thuẫn với chính dòng 234 của nó.
- [ ] **LOW vài chỗ lệch nhỏ** — `cli-reference.md:12` ghi `[a-z0-9][a-z0-9_-]*` nhưng `assertPathName` có cờ `i` nên `kf new LoginFlow` vẫn chạy; dòng 46 nói skills vào `{root}/.<agent>/skills` trong khi `codex` đi vào `.agents/skills`; `gates.md:70` và `cli-reference.md:30` nói `--purge-docs` "vẫn hỏi trên TTY" nhưng `cancel.ts:71-73` bỏ qua khi có `--force`; `state-machine.md:82` bỏ sót lần reset executionId ở implementation, đúng lần quan trọng nhất trong vòng FAIL; `gates.md:37-48` thiếu bốn cạnh có thật; `harness.md:24` gán ví dụ cho `kf init` trong khi `kf init` seed `stages: {}` và tên runner khác; `harness.md:84` thiếu `kiro` và `cursor`; `docs/README.md:14` nói `requirement/` được copy khi vào `dones`, thực ra skill brainstorm ghi từ Phase 1 và archive chỉ làm mới; `docs/workflow/README.md:36` xếp một chính sách chỉ tồn tại trong prompt ("không tự cấp quyền database, deploy, publish") vào danh sách tên là "The rules that never bend", cạnh những gate CLI thật sự ép — không có gì trong `src/` ép cái đó, và preset còn chạy worker với auto-accept-edits.

- [ ] **Secret trong artifact của item đã huỷ không bao giờ được báo.** `STAGE_INDEX = -1` làm `checkDueArtifacts` bỏ qua mọi artifact, nên một `ghp_…` nằm trong `.works/cancelled/` đi qua im lặng. Thêm lại `checkDueArtifacts` vào nhánh cancelled **không** chữa được, vì guard theo index nằm bên trong nó. Có sẵn từ khi có stage `cancelled`, không do bản vá `cancelled-item-never-validates` gây ra.
- [ ] **Mở lại vào `planning` bị từ chối thẳng khi spec đã bị đặt lại `pending`.** `stage.ts` validate nước đi tới `planning` như thể item đang ở `brainstorm`, nên nó đi vòng qua nhánh tắt dành cho `cancelled` và bật lại `requirement_unconfirmed`. Đây đúng triệu chứng của bug `cancelled-item-never-validates`, chỉ khác đường vào, và **có sẵn từ trước** bản vá đó — kiểm bằng cách dựng baseline từ HEAD. Bản vá đóng sáu trong bảy đích mở lại; đích này còn lại. Lối thoát duy nhất là `--force`, và nó đóng dấu một bản ghi bypass vĩnh viễn.
- [ ] **Mở lại vào `planning` và `testing` để item invalid ngay lập tức** (`approval_required`, `testing_stale`), do ngữ nghĩa `kf stage` có sẵn. Thêm một điểm lệch: mở lại vào `planning` validate item như thể đang ở `brainstorm`, nên đường đó in cảnh báo bypass mà `kf validate` trên chính item đó lại không in. Hai lệnh, cùng item, hai câu trả lời khác nhau về lịch sử bypass.

## P3 — DX & distribution

- [ ] **Release path cho người nhận zip.** Hiện phải `npm install && npm run build && npm link`. Cân nhắc `npm publish` (private registry) hoặc `npx github:...` — README ghi lại cách install cho friend.
- [ ] **`kf status` không phản ánh cái đang thật sự chặn.** Nó chỉ duyệt `ARTIFACTS`, không đụng traceability, file UC riêng, fingerprint approval, secret hay execution mismatch — nên một item có thể in `Artifacts: 5/5` và `Next: kf approve` rồi `kf approve` fail ngay với bốn lỗi. Đáng ngại hơn: `harness/prompt.ts:131` bảo **mọi worker** chạy `kf status` để lấy checklist, nên worker tin nó sẽ đứng hình ở `kf approve` mà không được cảnh báo trước. Hướng: cho `computeStatus` gọi phần validator không tốn kém, hoặc in thêm một dòng "run kf validate for the full picture".
- [ ] **`kf doctor` / health check.** Chẩn đoán nhanh: skills đã cài chưa, `.works` hợp lệ không, config có legacy không — gộp một phần `autoconfig` thành verdict pass/fail.
- [ ] **Dashboard nâng cấp.** Hiện KPI + charts cơ bản — có thể thêm burndown theo context, lead time per stage, list features bị stuck (lâu nhất ở stage hiện tại).

## P4 — Chores nhỏ

- [ ] `.gitignore` entry `.works/` sót lại sau `kf uninstall --purge` — cố ý không đụng user file, nhưng purge nên báo "còn dòng `.works/` trong .gitignore" cho user tự quyết.
- [ ] `CHANGELOG.md` và `BACKLOG.md` (file này) vẫn hoàn toàn tiếng Việt, và README tiếng Anh trỏ thẳng sang CHANGELOG — người xem trên GitHub rơi vào tiếng Việt. Không vào gói npm nên người cài không bị ảnh hưởng. `CHANGELOG.md:3` còn trỏ bản Keep a Changelog tiếng Việt. Ngoài phạm vi `open-source-ready` nên để lại; README đã nói thẳng là CHANGELOG còn tiếng Việt thay vì giấu.
- [ ] Bảng `skillsDir` trong `docs/workflow/harness.md` liệt kê bốn mặc định, thiếu `.kiro/skills` và `.cursor/skills` — cả hai đều có trong `src/integrations/agents.ts`. Sai từ bản cũ, không do đợt dịch gây ra.
- [ ] `tsconfig.build.json` biên dịch cả `src/tests/helpers` và `src/tests/setup` vào `dist/`, nên gói npm mang theo ba file scaffolding (~6.7KB) không ai dùng. Loại ra phải cẩn thận: `globalSetup` và test detach đang chạy `node dist/index.js`, đừng sửa lúc đang vội.
- [ ] `hasUnresolvedPlaceholders` trade-off: placeholder trong backticks/code block không bị flag — chấp nhận hiện tại, nhưng nếu sau này có template token trong code span thì phải xử lý riêng.
- [ ] Quay ảnh động demo cho README — một vòng `kf new → approve → stage` thật, để người đọc thấy gate chặn ra sao thay vì chỉ đọc mô tả. Em không tạo được, việc của người.
- [ ] CONTRIBUTING, issue template, code of conduct — để sau khi có người quan tâm thật, đừng dựng trước.
- [ ] **Publish lên npm và mở repo public.** Hôm nay `npm view kanban-flow` trả 404 và `api.github.com/repos/phuthuycoding/kaban-flow` cũng 404 (repo đang private), nên cả hai đường cài trong README đều chết với người lạ. README đã nói thẳng "not on npm yet"; publish xong thì bỏ câu đó đi.
- [ ] Đổi tên repo GitHub `phuthuycoding/kaban-flow` → `kanban-flow` cho khớp tên gói; đổi xong phải sửa `repository`/`homepage`/`bugs` trong `package.json`. Thao tác trên GitHub, không phải việc của CLI.

## Done / đã xong gần đây

- [x] `open-source-ready` (2026-09-19): đổi tên gói `kanban-flow` + version 0.3.0, dịch toàn bộ bề mặt người dùng và tài liệu sang tiếng Anh, README viết lại theo vấn đề trước cơ chế sau, LICENSE MIT + metadata publish, `files` bỏ canonical docs nội bộ

- [x] Multi-agent harness theo vai trò (2026-09-19): `stage → role → runner`, chuỗi role trong một stage, `kf run`/`runs`/`harness`, session theo work item + role, runs + usage, preset 5 CLI

- [x] `workflow-hardening` (2026-09-19): autoconfig guide sinh từ parser, secret exemption theo value, bypass trail `--force`/`--skip-hooks`, `testing_exit_code`, CI (node 20/22) + typecheck test, tách `validate.ts`, `kf init` seed `AGENTS.md`, CHANGELOG + version 0.2.0

- [x] Project-only skills (bỏ global scope) + `kf uninstall --purge` confirm
- [x] Secret scan `artifact_secret` trong validator
- [x] Monorepo `stacks[]` detect + `kf rules`
- [x] `kf autoconfig` agent briefing
- [x] AI-risk lens (kanban-review) + subagent contract (kanban-implement)
- [x] Placeholder detection bỏ qua code spans

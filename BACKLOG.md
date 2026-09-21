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

Mười ba chỗ tài liệu nói sai về mã. Bản tiếng Việt cũ cũng sai y hệt nên đợt dịch không gây ra, và FR-008 chốt phạm vi là "chỉ đổi ngôn ngữ" nên không sửa lén trong đợt đó. **Đã sửa hết mười ba mục**; mỗi lời khẳng định được kiểm lại với mã trước khi sửa, không tin sẵn mô tả cũ trong backlog này.

- [x] **HIGH `state-machine.md` mẫu "minimum metadata" thiếu `created`** — `readFeatureMeta` bắt buộc trường đó. Đã thêm `"created": "20260917_1405"` vào mẫu.
- [x] **HIGH `cli-reference.md:3` nói mọi lệnh đi ngược lên tìm `.works/`** — sai với `kf init`, vốn dùng `resolve(cwd, …)`. Đã nêu `kf init` là ngoại lệ và nói rõ hậu quả: chạy trong subdir sẽ tạo bộ `.works/`, `.kf/` và skills thứ hai.
- [x] **HIGH `--minimal` mô tả sai ở cả doc lẫn CLI help** — nó còn ghi `.kf/config.json`, ba thư mục `.kf/`, skills và `AGENTS.md`. Đã sửa cả `cli-reference.md` lẫn `args.ts`: "bỏ qua câu hỏi, không bỏ qua scaffolding", và nói rõ thứ duy nhất bị bỏ là **nội dung** template/hook/rule.
- [x] **MEDIUM `dashboard.md` công thức completion rate** — mã là `percentage(completed, items.length - cancelled)`. Đã ghi đúng mẫu số.
- [x] **MEDIUM `gates.md:3` nói `kf validate` chạy cùng validator** — `validateFeature` không gọi `checkDirectionGate`. Đã tách ra một đoạn: `kf validate` sạch **không** hứa nước đi kế tiếp được phép.
- [x] **MEDIUM `cli-reference.md` "reports on stderr"** — báo cáo đọc được đi ra **stdout**, stderr chỉ một dòng lý do. Đã sửa, kèm cảnh báo cho CI giữ stderr mà bỏ stdout.
- [x] **MEDIUM `skills.md` nói `kanban-archive` tự sync canonical docs** — chính skill đó cấm copy tay. Đã sửa thành "gọi `kf archive`, và chính nó copy", kèm lý do copy tay thì lần archive sau bị từ chối.
- [x] **MEDIUM `skills.md` không nhắc harness một chữ nào** — đã thêm một đoạn: routing quyết định *skill nào* load, harness quyết định *ai chạy*, kèm link `harness.md`.
- [x] **MEDIUM `cancelled` vắng mặt khắp workflow guide** — đã thêm vào sơ đồ, cây thư mục và danh sách luật ở `docs/workflow/README.md`, và vào sơ đồ + phần mô tả ở `kanban-flow/README.md`.
- [x] **MEDIUM `harness.md` không được index nào trỏ tới** — đã thêm vào cả `docs/README.md` lẫn `docs/workflow/README.md`.
- [x] **MEDIUM `dashboard.md` thiếu 2 trong 7 tile và một claim filter sai** — đã thêm `Cancelled` và `Gate bypasses`, và sửa mô tả thanh approval: filter chỉ loại `brainstorm` với `dones`, nên **item đã huỷ vẫn bị đếm**, cái chưa từng approve rơi vào cột pending.
- [x] **LOW hai skill nói sai tên trường** — template feature dùng `- Level:`, `Test Level` là nhãn của template bug. Đã sửa cả `kanban-brainstorm` lẫn `kanban-plan` để nêu đúng hai nhãn. Sửa luôn mâu thuẫn: dòng 245 nói narrative viết ở Phase 2, dòng 309 lại bảo lấy narrative từ Phase 1.
- [x] **LOW vài chỗ lệch nhỏ** — đã sửa cả tám: regex có cờ `i` nên `LoginFlow` chạy được; `codex` đi vào `.agents/skills` chứ không theo mẫu `.<agent>/skills`; `--purge-docs` bị `--force` bỏ qua bước hỏi; `executionId` còn bị xoá khi vào `implementation` (lần quan trọng nhất trong vòng FAIL); sơ đồ `gates.md` thiếu đúng bốn cạnh (`planning→backlog`, `backlog→implementation`, `backlog→planning`, `implementation→planning`); ví dụ config `harness.md` không phải thứ `kf init` seed (`stages: {}`, sáu role một runner); danh sách `skillsDir` thiếu `kiro` và `cursor`; `docs/README.md` nói `requirement/` được copy lúc `dones`, thực ra skill brainstorm ghi từ Phase 1 và archive chỉ làm mới; và dòng "chính sách" trong `docs/workflow/README.md` đã được tách khỏi danh sách gate, nói thẳng là **prompt policy, không phải gate**, và preset còn chạy worker auto-accept-edits.

- [x] **Hai skill chưa biết tới danh sách context khai báo.** ~~`kanban-brainstorm` và `kanban-flow` chỉ dạy `kf new --context {ctx}` và luật ký tự, không nhắc danh sách khai báo, không nhắc việc bị từ chối, không nhắc `kf contexts`.~~ Đã sửa: `kanban-brainstorm` nay bảo chạy `kf contexts --json` **trước** `kf new` và nói rõ phải làm gì khi bị từ chối; `kanban-flow` có dòng `kf contexts` trong CLI reference và một đoạn Contexts. Cả hai đều cấm tự thêm context vào config để đi qua rào. Ghi chú: mục cũ ghi "ba skill" là **đếm nhầm** — chỉ hai skill chạy `kf new`; `kanban-archive` và `kanban-review` chỉ tiêu thụ context có sẵn nên không chạm được rào chắn.

- [ ] **Secret trong artifact của item đã huỷ không bao giờ được báo.** `STAGE_INDEX = -1` làm `checkDueArtifacts` bỏ qua mọi artifact, nên một `ghp_…` nằm trong `.works/cancelled/` đi qua im lặng. Thêm lại `checkDueArtifacts` vào nhánh cancelled **không** chữa được, vì guard theo index nằm bên trong nó. Có sẵn từ khi có stage `cancelled`, không do bản vá `cancelled-item-never-validates` gây ra.
- [ ] **Mở lại vào `planning` bị từ chối thẳng khi spec đã bị đặt lại `pending`.** `stage.ts` validate nước đi tới `planning` như thể item đang ở `brainstorm`, nên nó đi vòng qua nhánh tắt dành cho `cancelled` và bật lại `requirement_unconfirmed`. Đây đúng triệu chứng của bug `cancelled-item-never-validates`, chỉ khác đường vào, và **có sẵn từ trước** bản vá đó — kiểm bằng cách dựng baseline từ HEAD. Bản vá đóng sáu trong bảy đích mở lại; đích này còn lại. Lối thoát duy nhất là `--force`, và nó đóng dấu một bản ghi bypass vĩnh viễn.
- [ ] **Mở lại vào `planning` và `testing` để item invalid ngay lập tức** (`approval_required`, `testing_stale`), do ngữ nghĩa `kf stage` có sẵn. Thêm một điểm lệch: mở lại vào `planning` validate item như thể đang ở `brainstorm`, nên đường đó in cảnh báo bypass mà `kf validate` trên chính item đó lại không in. Hai lệnh, cùng item, hai câu trả lời khác nhau về lịch sử bypass.
- [x] **`harness-roles.test.ts` flake khi máy tải nặng.** ~~Bốn test spawn worker process thật, chạy trên `testTimeout` mặc định 5000ms.~~ Đã sửa: `vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })` trong đúng ba file spawn process (`harness-run`, `harness-roles`, `harness-detach`), để các suite unit nhanh giữ nguyên mức chặt 5s. Trước khi sửa, suite fail 4 rồi 8 test ở 5018–5048ms; sau khi sửa, năm lượt liên tiếp 328/328.
- [x] **`listFeatures` chết vì symlink gãy dưới `.works/`.** ~~`features.ts:212` gọi `statSync` không bảo vệ, nên `kf contexts`, `kf new`, `kf list`, `kf view` đều ném `ENOENT` thô.~~ Đã sửa qua work item `listfeatures-symlink-crash`: `statSync(dir, { throwIfNoEntry: false })` nhắm đúng một điều kiện (đích không tồn tại), entry gãy hiện ra như item invalid thay vì biến mất, và `EACCES`/`ELOOP` vẫn nổi lên. Ba mutant, không cái nào sống sót.

## P3 — DX & distribution

- [ ] **Release path cho người nhận zip.** Hiện phải `npm install && npm run build && npm link`. Cân nhắc `npm publish` (private registry) hoặc `npx github:...` — README ghi lại cách install cho friend.
- [ ] **`kf status` không phản ánh cái đang thật sự chặn.** Nó chỉ duyệt `ARTIFACTS`, không đụng traceability, file UC riêng, fingerprint approval, secret hay execution mismatch — nên một item có thể in `Artifacts: 5/5` và `Next: kf approve` rồi `kf approve` fail ngay với bốn lỗi. Đáng ngại hơn: `harness/prompt.ts:131` bảo **mọi worker** chạy `kf status` để lấy checklist, nên worker tin nó sẽ đứng hình ở `kf approve` mà không được cảnh báo trước. Hướng: cho `computeStatus` gọi phần validator không tốn kém, hoặc in thêm một dòng "run kf validate for the full picture".
- [ ] **`kf doctor` / health check.** Chẩn đoán nhanh: skills đã cài chưa, `.works` hợp lệ không, config có legacy không — gộp một phần `autoconfig` thành verdict pass/fail.
- [ ] **Dashboard nâng cấp.** Hiện KPI + charts cơ bản — có thể thêm burndown theo context, lead time per stage, list features bị stuck (lâu nhất ở stage hiện tại).

## P4 — Chores nhỏ

- [ ] `.gitignore` entry `.works/` sót lại sau `kf uninstall --purge` — cố ý không đụng user file, nhưng purge nên báo "còn dòng `.works/` trong .gitignore" cho user tự quyết.
- [ ] `CHANGELOG.md` và `BACKLOG.md` (file này) vẫn hoàn toàn tiếng Việt, và README tiếng Anh trỏ thẳng sang CHANGELOG — người xem trên GitHub rơi vào tiếng Việt. Không vào gói npm nên người cài không bị ảnh hưởng. `CHANGELOG.md:3` còn trỏ bản Keep a Changelog tiếng Việt. Ngoài phạm vi `open-source-ready` nên để lại; README đã nói thẳng là CHANGELOG còn tiếng Việt thay vì giấu.
- [x] ~~Bảng `skillsDir` trong `docs/workflow/harness.md` liệt kê bốn mặc định, thiếu `.kiro/skills` và `.cursor/skills`.~~ Đã sửa cùng đợt docs debt P2b (mục này trùng với gạch đầu dòng `harness.md:84` ở đó).
- [x] ~~`tsconfig.build.json` biên dịch cả `src/tests/helpers` và `src/tests/setup` vào `dist/`, nên gói npm mang theo ba file scaffolding không ai dùng.~~ Đã sửa: exclude cả cây `src/tests/**`. Cảnh báo cũ ("globalSetup và test detach chạy `node dist/index.js`") đã kiểm và **không thành vấn đề**: vitest chạy spec, helper và `setup/build.ts` từ nguồn qua Vite, không từ `dist/`; thứ duy nhất cần `dist/` là `dist/index.js`. Kiểm bằng hai lượt cold start (`rm -rf dist && npm test`) đúng như CI chạy: 328/328 cả hai lượt.
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

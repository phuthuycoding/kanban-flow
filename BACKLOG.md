# Backlog

Các hạng mục biết là còn mềm / muốn làm tiếp. Không theo thứ tự bắt buộc — mỗi item ghi context + vì sao.

## P1 — Trust & evidence

- [ ] **`kf` tự chạy test command để verify evidence.** Hiện CLI chỉ check hợp đồng artifact (file tồn tại, status hợp lệ, execution id khớp) — agent xấu vẫn bịa được report PASS. Hướng: `kf test --run "<cmd>"` chạy lệnh thật, ghi exit code + output hash vào report, hoặc `kf stage` đối chiếu command log. Scope to — quyết định tin agent tới mức nào trước.
- [ ] **Secret scan nâng cấp.** Exemption đã áp lên value (2026-09-19), nhưng vẫn regex-based nên lọt format lạ/obfuscated. Cân nhắc entropy check cho `KEY=value` + thêm pattern (JWT `eyJ`, Slack webhook URL, connection string `://user:pass@`). Giữ nguyên tắc: không flag placeholder, không echo giá trị secret.

## P2 — Workflow gaps

- [ ] **Locking cho concurrent agents.** File-based state chưa có lock — 2 agent cùng đụng 1 feature sẽ đạp nhau. Hiện single-flow nên chưa đau; khi nào có nhu cầu multi-agent thì làm `.kfw.lock` + stale-lock detection.
- [ ] **Adversarial validation cho bug review** (ý tưởng từ ClaudeKit `adversarial-validation`): review bug report phải nêu reachable regressions + claims đã bị disprove — hiện bug flow nhẹ, chỉ check reproduction/regression scope.

## P3 — DX & distribution

- [ ] **Release path cho người nhận zip.** Hiện phải `npm install && npm run build && npm link`. Cân nhắc `npm publish` (private registry) hoặc `npx github:...` — README ghi lại cách install cho friend.
- [ ] **`kf doctor` / health check.** Chẩn đoán nhanh: skills đã cài chưa, `.works` hợp lệ không, config có legacy không — gộp một phần `autoconfig` thành verdict pass/fail.
- [ ] **Dashboard nâng cấp.** Hiện KPI + charts cơ bản — có thể thêm burndown theo context, lead time per stage, list features bị stuck (lâu nhất ở stage hiện tại).

## P4 — Chores nhỏ

- [ ] `.gitignore` entry `.works/` sót lại sau `kf uninstall --purge` — cố ý không đụng user file, nhưng purge nên báo "còn dòng `.works/` trong .gitignore" cho user tự quyết.
- [ ] `hasUnresolvedPlaceholders` trade-off: placeholder trong backticks/code block không bị flag — chấp nhận hiện tại, nhưng nếu sau này có template token trong code span thì phải xử lý riêng.
- [ ] Docs/README đang trộn Việt-Anh — nếu plan public repo thì chọn 1 ngôn ngữ (gợi ý English cho README, giữ Việt trong docs/).

## Done / đã xong gần đây

- [x] `workflow-hardening` (2026-09-19): autoconfig guide sinh từ parser, secret exemption theo value, bypass trail `--force`/`--skip-hooks`, `testing_exit_code`, CI (node 20/22) + typecheck test, tách `validate.ts`, `kf init` seed `AGENTS.md`, CHANGELOG + version 0.2.0

- [x] Project-only skills (bỏ global scope) + `kf uninstall --purge` confirm
- [x] Secret scan `artifact_secret` trong validator
- [x] Monorepo `stacks[]` detect + `kf rules`
- [x] `kf autoconfig` agent briefing
- [x] AI-risk lens (kanban-review) + subagent contract (kanban-implement)
- [x] Placeholder detection bỏ qua code spans

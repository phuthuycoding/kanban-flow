---
feature: worktree-domains
context: cli
created: 20261007_1929
kind: feature
status: archived
---
# Spec Requirement

## Feature
worktree-domains

## Objective
Mỗi work item khi vào implementation chạy trong một git worktree riêng với domain `.<tld>` riêng do chính `kf` quản lý (proxy + giải domain), để agent code và tự test trên môi trường tách biệt khỏi checkout chính.

## Problem Statement
Hiện `kf` không có khái niệm worktree: agent implement và test ngay trên working tree chính của người dùng — gây lẫn thay đổi của work item với thay đổi đang có sẵn, không cho chạy song song nhiều work item, và không có URL ổn định để agent tự test bằng browser/curl. Người dùng muốn `kf` tự làm tool riêng cho việc này: một reverse proxy do `kf` cung cấp định tuyến domain `*.<zone>` về port của từng worktree, setup một lần lúc onboard, và cảnh báo khi hạ tầng chưa sẵn sàng — thay vì phụ thuộc Valet/nginx có sẵn.

Research đã kiểm chứng trên máy dev (macOS): wildcard DNS `*.test` đang do dnsmasq + Valet chiếm `127.0.0.1:80`; không có sudo không-mật-khẩu; nginx master chạy root nên reload không autonomous được. Đại ca dự định gỡ Valet, nên `kf` không né mà CHIẾM LUÔN zone `.test`: proxy của `kf` là router duy nhất cho mọi `*.test`, listen trên loopback riêng (`127.0.0.2:80`) để sống chung với nginx trong giai đoạn chuyển tiếp; một dnsmasq rule `address=/.test/<loopback>` duy nhất cover mọi project. Trong thời gian Valet còn chạy, `fallbackUpstream` forward host chưa đăng ký về `127.0.0.1:80` để site cũ không chết; gỡ Valet xong bỏ config là sạch. Việc bind `:80` và ghi resolver/dnsmasq chỉ xảy ra một lần trong `kf worktree setup` do người chạy với sudo.

## Scope
### In Scope
- Module worktree trong `src/`: tạo/xoá git worktree per work item, branch `kf/<feature>`, registry trong `.kfw.json` của item, cấp phát port theo registry.
- Auto-create worktree khi `kf stage <f> implementation` (config `worktree.enabled`); lỗi tạo worktree chặn transition — không cho implement lén trên checkout chính.
- `kf` resolve project root qua `git rev-parse --git-common-dir` khi chạy bên trong worktree (`.works/` chỉ tồn tại ở checkout chính).
- `kf proxy serve`: reverse proxy HTTP do `kf` cung cấp, định tuyến theo Host `<feature>.<baseDomain>` → `127.0.0.1:<port>` đọc từ routes file dùng chung toàn máy; host chưa đăng ký forward về `fallbackUpstream` khi có cấu hình.
- `kf worktree setup`: onboard hạ tầng domain (một dnsmasq rule cho cả zone `.test`, `/etc/resolver` khi cần, LaunchDaemon chạy proxy trên `<loopback>:80`); `kf doctor`/`kf validate` cảnh báo khi `worktree.enabled` mà hạ tầng chưa setup.
- Teardown khi archive/cancel: gỡ route + `git worktree remove`, giữ nguyên branch `kf/<feature>` cho người merge/PR; cảnh báo khi branch có commit chưa merge.
- Cập nhật skills: kanban-implement làm việc trong worktree, kanban-test test qua domain của item.
- `kf status`/`kf worktree list` hiển thị path + domain + port của từng item.

### Out of Scope
- HTTPS/TLS cho domain worktree — v1 chỉ HTTP; `valet secure`-equivalent để backlog.
- Tạo PR, merge branch, xoá branch — git history là việc của người; `kf` chỉ gỡ worktree và cảnh báo commit chưa merge.
- Tích hợp Valet/nginx (symlink Sites, `valet proxy`) — quyết định của đại ca là tool riêng, Valet sẽ bị gỡ; sống chung tạm thời chỉ qua `fallbackUpstream` ở proxy.
- Proxy phục vụ static/PHP trực tiếp từ thư mục — proxy chỉ forward về port; app tự chạy dev server (`php artisan serve`, `npm run dev`, …).
- Service manager ngoài macOS launchd — Linux/Windows in hướng dẫn manual trong setup, không cài tự động.
- Locking multi-agent trên `.kfw.json`/routes file — BACKLOG đã ghi, race chưa tồn tại.

## Actors
- Agent (Claude/Codex/…) chạy `kf`, implement và test bên trong worktree, hit domain để tự test.
- Người vận hành (đại ca): chạy `kf worktree setup` một lần với sudo khi onboard, merge/PR branch `kf/<feature>` sau archive.
- `kf proxy serve`: process nền do launchd quản lý, phục vụ toàn bộ repo/worktree trên máy.

## Functional Requirements
### FR-001
- Requirement: `kf worktree create <feature>` tạo `git worktree` tại `<baseDir>/<feature>` (mặc định `<repo>-worktrees/` ngang hàng repo), branch mới `kf/<feature>` từ HEAD hiện tại; cấp port đầu tiên còn trống từ `worktree.portBase` (mặc định 5100) theo registry; ghi route `<feature>.<baseDomain>` → `127.0.0.1:<port>` vào routes file (`baseDomain` từ `worktree.baseDomain`, mặc định `<repo-slug>.test`); lưu `{path, branch, domain, port}` vào `.kfw.json` của item; idempotent — gọi lại trên item đã có worktree trả về thông tin hiện tại, không tạo trùng.
- Priority: must
- Notes: Lệnh thủ công phục vụ resume và trường hợp worktree bị xoá ngoài ý muốn. Routes file ở `~/.config/kanban-flow/proxy-routes.json` (machine-global, không commit).

### FR-002
- Requirement: `kf stage <f> implementation` tự gọi worktree-create khi `worktree.enabled !== false` trong `.kf/config.json`; khi tạo thất bại (không phải git repo, thiếu quyền, branch trùng) transition THẤT BẠI với lỗi rõ ràng — không rơi về implement trên checkout chính. Re-enter implementation (FAIL loop, resume) tái sử dụng worktree hiện có thay vì tạo mới.
- Priority: must
- Notes: Fail-closed theo triết lý gate của `kf`; escape hatch là `worktree.enabled: false`. Quyết định timing của đại ca: auto khi vào implementation.

### FR-003
- Requirement: Khi `kf` chạy bên trong một worktree (không tìm thấy `.works/` đi lên), nó resolve project root qua `git rev-parse --git-common-dir` → checkout chính → `.works/` ở đó; mọi command (`status`, `stage`, `instruct`, `validate`…) hoạt động bình thường từ cwd của worktree.
- Priority: must
- Notes: `.works/` bị gitignore nên worktree không có; nếu không bước này agent `cd` vào worktree là mất luôn `kf`.

### FR-004
- Requirement: `kf proxy serve` là reverse proxy HTTP chạy foreground (launchd giữ sống): ánh xạ Host `<feature>.<baseDomain>` → `127.0.0.1:<port>` theo routes file; reload routes theo mtime không cần restart; host không khớp forward về `fallbackUpstream` (mặc định `127.0.0.1:80` — nginx/Valet trong giai đoạn sống chung), nếu `fallbackUpstream: null` trả 502 kèm danh sách route hiện có; forward cả websocket upgrade để dev-server HMR hoạt động.
- Priority: must
- Notes: Tool riêng của đại ca — không nginx, không Valet. Node http core, không dependency mới. Một process phục vụ tất cả project.

### FR-005
- Requirement: `kf worktree setup` cài hạ tầng domain một lần: ghi dnsmasq conf `address=/<domainZone>/<loopback>` vào dnsmasq.d (detect homebrew path), tạo `/etc/resolver/<domainZone>` khi chưa có, cài + load LaunchDaemon chạy `kf proxy serve` trên `<loopback>:80` (mặc định `127.0.0.2:80`); khi phát hiện rule dnsmasq cùng zone đang trỏ IP khác (Valet), TỪ CHỐI và in hướng dẫn gỡ conf cũ thay vì ghi đè; `--print` chỉ in các lệnh không chạy; idempotent; báo rõ bước nào cần sudo.
- Priority: must
- Notes: Theo quyết định: "domain sẽ cần setup lúc onboard". Rule ở tầng TLD (`address=/.test/127.0.0.2`) nên một lần setup cover mọi project; hiện có sẵn `/etc/resolver/test` trên máy này.

### FR-006
- Requirement: `kf doctor` kiểm tra: wildcard `<zone>` resolve về `<loopback>`, proxy đang listen trên `<loopback>:80`, routes file đọc được; `kf validate` phát WARNING `worktree_infra_missing` khi `worktree.enabled` mà probe thất bại, kèm hint `kf worktree setup`; `kf status --change <f>` hiển thị path/domain/port khi item có worktree.
- Priority: must
- Notes: Theo quyết định: "nếu chưa setup thì lúc chạy command validate hoặc gì đó sẽ alert ra để onboard user setup". Cảnh báo, không chặn — probe mạng không được làm hỏng gate hiện có.

### FR-007
- Requirement: `kf archive <f>` và `kf cancel <f>` gỡ route của item khỏi routes file và chạy `git worktree remove`; worktree dirty (uncommitted/untracked) khiến lệnh từ chối với hướng dẫn commit hoặc `kf worktree remove --force`; branch `kf/<feature>` KHÔNG bao giờ bị xoá; khi branch có commit chưa merge vào branch đang checkout của repo chính, archive in cảnh báo "branch has unmerged commits — merge/PR thủ công". `kf worktree remove <f> [--force]` cho teardown thủ công.
- Priority: must
- Notes: Phương án cleanup đề xuất cho đại ca: không PR, không xoá branch; chỉ gỡ worktree + route, cảnh báo khi chưa merge. Dựa trên `git worktree remove` mặc định từ chối dirty — không tự ý mất code.

### FR-008
- Requirement: `kf worktree list` liệt kê mọi worktree đã đăng ký (item, stage, path, domain, port) và phát hiện orphan: thư mục/registry còn mà item đã không còn trong `.works/`.
- Priority: should
- Notes: Orphan phát sinh khi người xoá tay `.works/` hoặc worktree — đây là safety net, không phải luồng chính.

### FR-009
- Requirement: Skills phản ánh môi trường worktree: kanban-implement chỉ dẫn agent `cd` vào worktree path từ `kf status`/`kf instruct` và commit trên `kf/<feature>`; kanban-test dùng domain của item cho bước test HTTP/browser khi cần hit server; kanban-review diff `kf/<feature>` so với base từ checkout chính.
- Priority: must
- Notes: Skills sửa ở `skills/` (nguồn), không phải bản installed. Artifact `.works/` vẫn nằm ở checkout chính — FR-003 làm điều đó trong suốt với agent.

## Non-Functional Requirements
- Runtime không cần sudo: mọi sudo tập trung trong `kf worktree setup` do người chạy một lần.
- Không dependency npm mới: proxy dùng `node:http`/`node:net`; không kéo http-proxy, caddy hay binary ngoài.
- Ghi routes file atomic (tmp + rename); đọc mỗi request hoặc cache theo mtime — proxy không được phục vụ route cũ sau teardown.
- Không đụng hàng Valet/nginx: loopback IP và zone riêng; setup phải phát hiện xung đột port/IP và báo thay vì chiếm.
- Port cấp phát theo registry `.kfw.json` toàn `.works/`, không probe socket (probe sẽ race với server đang tắt).

## Main Use Cases
- UC-001 Onboard hạ tầng domain lần đầu (setup + verify)
- UC-002 Vào implementation tự có worktree + domain
- UC-003 Agent code và tự test qua domain trong worktree
- UC-004 Archive work item: gỡ worktree, giữ branch, cảnh báo chưa merge
- UC-005 Hạ tầng chưa setup: doctor/validate cảnh báo và hướng dẫn onboard
- UC-006 Resume/re-enter implementation tái dùng worktree
- UC-007 Worktree dirty khi archive: từ chối và hướng dẫn

## Constraints
- Config đề xuất trong `.kf/config.json` (committed, dùng chung cả team): `worktree: { enabled, baseDir, branchPrefix, baseDomain, portBase, routesFile }` với mặc định `enabled: true`, `branchPrefix: "kf/"`, `baseDomain: "<repo-slug>.test"`, `portBase: 5100`, `routesFile: "~/.config/kanban-flow/proxy-routes.json"`. Config máy (không commit) ở `~/.config/kanban-flow/config.json`: `{ proxyListen: "127.0.0.2:80", domainZone: "test", fallbackUpstream: "127.0.0.1:80" | null }`.
- Domain mẫu: `worktree-domains.kaban-flow.test` → `<feature-slug>.<baseDomain>`; slug hoá feature/repo theo DNS (lowercase, `[a-z0-9-]`).
- v1 nhắm macOS + homebrew dnsmasq; platform khác `--print` hướng dẫn thủ công.
- Tuân thủ triết lý hiện có: fail-closed khi gate liên quan, cảnh báo thay vì im lặng, không `--force` cho flow mới ngoài teardown dirty worktree.

## Assumptions
- Agent tự khởi động dev server trong worktree trên port được cấp — `kf` chỉ cấp port/domain, không spawn hay giám sát process app.
- `git` đủ mới cho `git worktree` (mọi bản 10 năm gần đây đều có).
- Repo dùng `kf` là git repo; non-git project đặt `worktree.enabled: false`.
- Test level `unit+integration` là đủ: feature là CLI + proxy, không có UI; e2e thật qua domain được cover bằng integration test trên ephemeral port (không cần sudo).
- Merge/PR sau archive là việc của người — nếu sau này muốn `kf` merge, đó là work item riêng.

## Acceptance Criteria
- [ ] `kf worktree create <f>` tạo worktree + branch + route; gọi lại lần hai trả về cùng thông tin, không tạo trùng.
- [ ] `kf stage <f> implementation` (enabled) sinh worktree; chạy `kf status` TỪ BÊN TRONG worktree vẫn thấy đúng item.
- [ ] Khi tạo worktree lỗi, `kf stage` báo lỗi và item không rời stage hiện tại.
- [ ] `kf proxy serve` trên port test: request Host `a.b.test` forward đúng `127.0.0.1:<port>`; host lạ forward về `fallbackUpstream` hoặc trả 502 khi null; routes file sửa ngoài process được nhận không cần restart.
- [ ] `kf worktree setup --print` in đủ lệnh dnsmasq/resolver/launchd; chạy thật hai lần không lỗi (idempotent).
- [ ] `kf validate` trên repo có `worktree.enabled` mà hạ tầng chưa setup phát WARNING `worktree_infra_missing`, không ERROR.
- [ ] Archive item có worktree sạch: worktree + route biến mất, branch `kf/<f>` còn, cảnh báo unmerged khi đúng.
- [ ] Archive item có worktree dirty bị từ chối; `kf worktree remove --force` dọn được.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` xanh; test chạy được trên CI không cần sudo/dnsmasq.

## Edge Cases
- Re-enter implementation sau FAIL loop hoặc reopen từ cancelled → tái dùng worktree hiện có (route/registry vẫn còn).
- Branch `kf/<feature>` đã tồn tại từ lần chạy trước nhưng item chưa có registry → báo lỗi rõ (không âm thầm checkout branch cũ).
- Worktree bị `rm -rf` tay → `create`/`status` phát hiện registry trỏ path chết, `create` tạo lại sạch.
- Trùng port do hai `.works/` khác nhau cùng `portBase` trên một máy → routes file là nguồn đúng duy nhất; cấp phát phải quét cả routes file lẫn registry cục bộ.
- Item bị xoá khỏi `.works/` bằng tay → `kf worktree list` báo orphan.
- Zone `.test` không resolve về kf loopback (máy không dnsmasq, hoặc rule Valet cũ còn) → doctor chỉ ra bước thiếu thay vì lỗi chung chung.
- `fallbackUpstream` trỏ về một proxy khác của kf hoặc domain lặp về chính nó → detect self-forward theo `X-Forwarded-By`, trả 502 thay vì loop vô hạn.
- Proxy chết giữa chừng → domain trả về lỗi kết nối; `kf status` vẫn in `localhost:<port>` làm đường dự phòng cho agent.
- Repo chính đang có uncommitted changes trên file work item cũng sửa → không xung đột (worktree tách tree), nhưng merge về sau là việc của người.

## Open Questions
- (đã quyết) Base ref branch `kf/<feature>` = HEAD hiện tại của repo — quyết định của đại ca.
- (đã quyết) Domain format = `<worktree-slug>.<domain-website>.test`; `baseDomain` per-project, default `<repo-slug>.test` — quyết định của đại ca.
- (đã quyết) `worktree.enabled` mặc định `true`; Valet sẽ bị gỡ, sống chung tạm qua `fallbackUpstream` — quyết định của đại ca.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest — temp git repo fixtures cho worktree commands, proxy test trên ephemeral port, routes file trong tmpdir; không cần sudo/dnsmasq thật trong test
- Coverage Target: 80%

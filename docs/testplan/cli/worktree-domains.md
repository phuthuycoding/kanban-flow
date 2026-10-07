---
feature: "worktree-domains"
context: "cli"
created: "20261007_1929"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | worktree-domains |
| Context | cli |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest; temp git repo fixtures; `kf proxy serve` trên ephemeral port; `http`/`net` client của node |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 6 | 6 | config, slugify, port alloc, routes io, setup emission |
| Integration | 16 | 16 | git thật trong tmpdir, proxy http/ws/fallback, stage lifecycle |
| UI / E2E | 0 | 0 | không có UI; domain e2e được cover bằng integration qua proxy |
| **Total** | **22** | **22** | toàn bộ phải pass |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-005 | TC-011, TC-012 | 2 | setup --print đủ lệnh, idempotent, conflict từ chối |
| UC-002 | FR-001, FR-002 | TC-001, TC-002, TC-003, TC-004, TC-013, TC-014 | 6 | create đủ 4 artefact, fail-closed |
| UC-003 | FR-003, FR-004, FR-009 | TC-005, TC-006, TC-007, TC-008, TC-009, TC-010, TC-021, TC-022 | 8 | kf trong worktree + proxy forward |
| UC-004 | FR-007 | TC-016 | 1 | teardown sạch, branch còn, warn unmerged |
| UC-005 | FR-006 | TC-019 | 1 | WARNING không ERROR |
| UC-006 | FR-001, FR-002 | TC-015 | 1 | reuse, recreate, branch-exists error |
| UC-007 | FR-007 | TC-017, TC-018 | 2 | dirty từ chối, force remove, cancel teardown |
| UC-008 | FR-008 | TC-020 | 1 | list + 3 loại orphan + json |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-002, UC-006 | TC-001..TC-004, TC-013, TC-015 | yes | |
| FR-002 | UC-002, UC-006 | TC-013, TC-014, TC-015 | yes | |
| FR-003 | UC-003 | TC-005, TC-021 | yes | |
| FR-004 | UC-003 | TC-006..TC-010 | yes | |
| FR-005 | UC-001 | TC-011, TC-012 | yes | setup thật có sudo không chạy trên CI — cover bằng --print + fixture dirs |
| FR-006 | UC-005, UC-003 | TC-019, TC-022 | yes | |
| FR-007 | UC-004, UC-007 | TC-016, TC-017, TC-018 | yes | |
| FR-008 | UC-008 | TC-020 | yes | |
| FR-009 | UC-003 | TC-021, TC-022 | yes | nội dung skills được kiểm bằng review checklist + dogfood, không assert text |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | File `.kf/config.json` fixture |
| Input | Config có/không có block `worktree`, từng field thiếu/sai kiểu |
| Steps | See steps table below |
| Expected outcome | Defaults đúng (`enabled:true`, `branchPrefix:"kf/"`, `portBase:5100`, `baseDomain:"<repo-slug>.test"`); field sai kiểu → lỗi validation rõ |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse config rỗng | Defaults đầy đủ |
| 2 | Parse config đủ field | Giá trị override được nhận |
| 3 | `portBase: "abc"` | Lỗi validation nêu field |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Hàm slugify + domain build |
| Input | Feature `My Feature_X`, repo `Kaban_Flow` |
| Steps | See steps table below |
| Expected outcome | Domain `my-feature-x.kaban-flow.test`; ký tự lạ được slug hoá, không ký tự DNS bất hợp lệ |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Slugify feature + repo | `my-feature-x`, `kaban-flow` |
| 2 | Ghép `<f>.<baseDomain>` | Domain hợp lệ DNS |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Registry fixtures chiếm port 5100, 5102; routes file chiếm 5101 |
| Input | `allocatePort(portBase=5100)` |
| Steps | See steps table below |
| Expected outcome | Trả 5103 — quét cả `.kfw.json` registries lẫn routes file |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Quét `.works/*/*/.kfw.json` + routes file | Tập port đang dùng {5100,5101,5102} |
| 2 | allocatePort | 5103 |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | tmpdir routes file |
| Input | add/remove/update route |
| Steps | See steps table below |
| Expected outcome | Ghi atomic (tmp+rename), đọc lại đúng, file corrupt → lỗi rõ không crash |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | addRoute → đọc file | Entry đúng shape |
| 2 | removeRoute → đọc lại | Entry mất, file còn hợp lệ |
| 3 | Ghi JSON hỏng rồi đọc | Lỗi parse có tên file, không throw stack trần |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Temp git repo với `.works/`; một git worktree con |
| Input | `findWorksRoot(<cwd trong worktree>)` |
| Steps | See steps table below |
| Expected outcome | Trả về main checkout root (chứa `.works/`), không phải worktree path |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Tạo repo tmp + `.works/` + `git worktree add` | Fixture sẵn |
| 2 | `findWorksRoot` từ subdir trong worktree | Resolve main root qua `--git-common-dir` |
| 3 | `findWorksRoot` từ dir ngoài git | null như cũ — không đổi hành vi |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | `kf proxy serve` trên ephemeral port; upstream http server trên port X; routes file trỏ `a.b.test`→X |
| Input | GET `http://127.0.0.1:<proxyPort>/` Host `a.b.test` |
| Steps | See steps table below |
| Expected outcome | Response từ upstream, header/body nguyên vẹn |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Start upstream + proxy với routes tmp | Hai server listen |
| 2 | GET với Host `a.b.test` | 200 + body upstream |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Proxy + upstream fallback server |
| Input | Host `unknown.test` với `fallbackUpstream` set / null |
| Steps | See steps table below |
| Expected outcome | Set → forward về fallback giữ Host gốc; null → 502 kèm danh sách routes |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `fallbackUpstream` → fallback server | Response của fallback |
| 2 | `fallbackUpstream: null` | 502 + routes list trong body |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Proxy đang chạy với routes A |
| Input | Ghi routes file thêm entry B trong khi proxy chạy |
| Steps | See steps table below |
| Expected outcome | Request Host B forward đúng không cần restart proxy |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Sửa routes file ngoài process | mtime đổi |
| 2 | Request Host mới | Forward đúng ngay |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Proxy + upstream echo ws qua `net` socket |
| Input | HTTP Upgrade request `websocket` qua proxy |
| Steps | See steps table below |
| Expected outcome | Socket tunnel hai chiều — bytes đi qua proxy nguyên vẹn |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Client Upgrade → proxy → upstream | 101 Switching Protocols |
| 2 | Gửi frame hai chiều | Byte-đúng cả hai hướng |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-004 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | `fallbackUpstream` trỏ về chính proxy (loop) |
| Input | Host lạ đi qua proxy có fallback self |
| Steps | See steps table below |
| Expected outcome | 502 ngay, không loop — detect qua `X-Forwarded-By` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Request Host lạ | Proxy thấy header của chính nó → 502 |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `kf worktree setup --print` với machine config fixture |
| Input | `--print` (không sudo, không ghi) |
| Steps | See steps table below |
| Expected outcome | Output chứa đủ: dnsmasq conf path + nội dung `address=/.test/127.0.0.2`, resolver file, plist path + nội dung, kickstart/load commands; không file nào bị ghi |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `setup --print` | In plan đầy đủ, fs không đổi |
| 2 | Chạy write-mode trên fixture dirs hai lần | Idempotent, exit 0, conf giống hệt |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture dnsmasq.d đã có `address=/.test/127.0.0.1` (Valet) |
| Input | `kf worktree setup` |
| Steps | See steps table below |
| Expected outcome | Exit 1, message chỉ file xung đột + hướng gỡ, không ghi đè |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Setup gặp rule cùng zone trỏ IP khác | Từ chối + chỉ đúng file gây xung đột |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Temp git repo + `.works/` item approved ở planning; `worktree.enabled: true` |
| Input | `kf stage <f> implementation` |
| Steps | See steps table below |
| Expected outcome | Worktree tồn tại, branch `kf/<f>` từ HEAD, route trong routes file, registry `.kfw.json` đủ 4 field |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Stage sang implementation | Exit 0 |
| 2 | Kiểm fs + git + routes + `.kfw.json` | 4 artefact đúng |
| 3 | `kf worktree create` lại | Cùng thông tin, không trùng |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item approved; repo không phải git (xoá `.git`) hoặc worktree add bị chặn |
| Input | `kf stage <f> implementation` |
| Steps | See steps table below |
| Expected outcome | Exit != 0, item vẫn ở planning, message nêu cause + hint `worktree.enabled: false` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Stage trong repo non-git | Transition fail, stage giữ nguyên |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-001 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item có worktree đăng ký |
| Input | Re-enter implementation / `kf worktree create` lại / xoá tay worktree / branch tồn tại ngoài registry |
| Steps | See steps table below |
| Expected outcome | Reuse đúng; dir mất → tạo lại cùng branch; branch lạ → lỗi rõ |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Stage implementation lần 2 | Cùng path/port/domain |
| 2 | `rm -rf` worktree rồi `create` | Worktree mới từ `kf/<f>` cũ |
| 3 | Branch `kf/<f>` tồn tại, registry trống | Lỗi "not managed", không checkout lén |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-007 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item review-PASS với worktree sạch; branch `kf/<f>` có commit chưa merge |
| Input | `kf archive <f>` |
| Steps | See steps table below |
| Expected outcome | Worktree + route mất; branch còn; stdout có cảnh báo unmerged; item không worktree → archive bình thường |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Archive item có worktree | Dir gỡ, route gỡ, registry sạch |
| 2 | Kiểm branch + output | `kf/<f>` còn, cảnh báo unmerged in ra |
| 3 | Archive item không worktree | Hành vi như cũ |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-007 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | High |
| Preconditions | Worktree dirty (uncommitted + untracked file) |
| Input | `kf archive <f>`; rồi `kf worktree remove <f> --force` |
| Steps | See steps table below |
| Expected outcome | Archive exit 1 giữ stage, message nêu 2 đường; `--force` gỡ được, branch còn |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Archive dirty worktree | Từ chối + hướng dẫn |
| 2 | `worktree remove --force` | Gỡ sạch, branch còn |
| 3 | Archive lại | Thành công |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-007 |
| Use case reference | UC-007 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item có worktree sạch / dirty |
| Input | `kf cancel <f>` |
| Steps | See steps table below |
| Expected outcome | Sạch → teardown + giữ branch; dirty → từ chối giữ stage |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Cancel worktree sạch | Route + worktree gỡ, branch còn |
| 2 | Cancel worktree dirty | Exit 1, item giữ stage |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-006 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | Machine config trỏ proxy listen port không có gì listen; sau đó proxy thật trên ephemeral port |
| Input | `kf validate`, `kf doctor` |
| Steps | See steps table below |
| Expected outcome | Thiếu infra → WARNING `worktree_infra_missing` + hint; `enabled:false` → không warning; doctor liệt kê từng probe |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Validate với infra thiếu | WARNING (không ERROR), có `kf worktree setup` hint |
| 2 | `enabled: false` | Không probe, không warning |
| 3 | `kf doctor` | Mục infra liệt kê DNS/TCP/routes pass/fail |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-008 |
| Use case reference | UC-008 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Một item worktree bình thường; một registry trỏ dir chết; một worktree `kf/*` không item; route trỏ item dones |
| Input | `kf worktree list [--json]` |
| Steps | See steps table below |
| Expected outcome | Bảng đủ field; cả ba loại orphan được liệt kê; `--json` parse được |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `kf worktree list` | Item hợp lệ + 3 orphan hiển thị |
| 2 | `--json` | JSON hợp lệ `{items, orphans}` |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Worktree của item đã tạo; agent cwd = worktree |
| Input | `kf status --change <f>`, `kf validate --change <f>` từ trong worktree |
| Steps | See steps table below |
| Expected outcome | Mọi lệnh hoạt động trên `.works/` của checkout chính; artifact không bị ghi vào worktree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cd <worktree>; kf status` | Đúng item, đúng stage |
| 2 | `kf instruct spec-requirement` | Đường dẫn `.works/` của main checkout |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item có worktree |
| Input | `kf status --change <f>` |
| Steps | See steps table below |
| Expected outcome | Output chứa worktree path, `http://<domain>`, `localhost:<port>` fallback |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `kf status` | Block worktree hiển thị path/domain/port |

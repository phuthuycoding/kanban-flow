# Multi-agent harness

Một **role** (vai trò) làm một việc trong pipeline; mỗi role trỏ tới một **runner** (CLI + model + quyền). Stage gán cho role, không gán cho hãng. Không gán stage nào thì mọi thứ như cũ: main tự làm hết.

## Vì sao ba lớp

```
stage  →  role       →  runner
testing   tester        gemini (CLI + model + cờ quyền)
```

- **Stage → role gần như không bao giờ đổi.** Testing luôn cần tester, review luôn cần reviewer. Viết một lần.
- **Role → runner là chỗ đổi khi đổi ý về model.** Thấy một model viết hợp hơn thì đổi `writer` một dòng, không đụng stage nào.
- **Runner → CLI + cờ** là chỗ chịu ảnh hưởng khi hãng đổi giao diện. Hỏng một runner không kéo theo phần còn lại.

Mỗi model mạnh một kiểu: chiều rộng khảo sát, văn phong, code, review. Role là cách nói "việc này cần thế mạnh nào" mà không gắn cứng vào tên hãng.

## Vì sao không cần "resume session gần nhất"

kaban-flow để state trong file (`.works/`, artifact, `.kfw.json`), không dựa vào trí nhớ hội thoại. Worker cho một stage là một session headless mới với context = skill của stage + artifact trên đĩa. Session chỉ được giữ lại **theo work item + role** để vòng sửa (FAIL → implement) tiếp tục đúng phiên đã làm, và id đó do kf tạo hoặc lấy về xác định, không bao giờ đoán "gần nhất". Hai role dùng chung một runner vẫn có hai session riêng, nên `coder` và `reviewer` trên cùng một CLI không lẫn ngữ cảnh của nhau.

## Config

Block `harness` trong `.kf/config.json` (`kf init` seed sẵn, `kf harness` để xem):

```json
"harness": {
  "main": "architect",
  "roles": {
    "architect":  "claude-opus",
    "researcher": { "runner": "codex",  "brief": "Explores breadth: prior art, libraries, comparable features.", "output": "research.md" },
    "writer":     { "runner": "gemini", "brief": "Turns agreed decisions into precise prose." },
    "coder":      "claude-opus",
    "tester":     { "runner": "devin",  "brief": "Runs the real suite and records exact commands and exit codes." },
    "reviewer":   "codex"
  },
  "stages": {
    "brainstorm":     ["researcher", "writer"],
    "implementation": "coder",
    "testing":        "tester",
    "review":         "reviewer"
  },
  "runners": {
    "claude-opus": {
      "start":  ["claude", "-p", "{prompt}", "--session-id", "{session}", "--permission-mode", "acceptEdits", "--output-format", "json"],
      "resume": ["claude", "-p", "{prompt}", "-r", "{session}", "--permission-mode", "acceptEdits", "--output-format", "json"],
      "session": "provided",
      "usage": "json"
    },
    "codex": {
      "start":  ["codex", "exec", "--json", "{prompt}"],
      "resume": ["codex", "exec", "resume", "{session}", "{prompt}"],
      "session": { "stdout": "\"thread_id\":\"([^\"]+)\"" },
      "usage": "json"
    },
    "devin": {
      "start":  ["devin", "-p", "{prompt}", "--permission-mode", "accept-edits"],
      "resume": ["devin", "-p", "{prompt}", "-r", "{session}", "--permission-mode", "accept-edits"],
      "session": { "command": ["devin", "list", "--format", "json"], "idField": "id", "matchField": "title" }
    },
    "gemini":   { "start": ["gemini", "-p", "{prompt}", "--approval-mode", "auto_edit"] },
    "opencode": { "start": ["opencode", "run", "{prompt}"] }
  }
}
```

- `main`: role mà agent điều phối đóng. Phải là role, không phải runner.
- `roles.<role>`: tên runner (dạng ngắn) hoặc `{ runner, brief?, output? }`.
  - `brief`: một hai câu mô tả vai, được chèn vào prompt để worker biết nó được gọi làm gì.
  - `output`: file phụ role phải viết trong thư mục work item (ví dụ `research.md`), để role sau đọc. Đường dẫn phải nằm trong thư mục work item.
- `stages.<stage>`: một role hoặc **mảng role chạy tuần tự**. Stage `backlog` không gán được. Stage không khai báo thì main làm.
- `runners.<runner>`: xem bảng dưới. Quyền (`--permission-mode`, `--approval-mode`, `--sandbox`) nằm trong template; kf không bơm cờ nào.

Thêm model mới = thêm một runner rồi trỏ role vào đó. Cùng một CLI hai model (`claude-opus`, `claude-haiku`) là hai runner, gán cho role đắt và role rẻ.

### Runner

| Trường | Ý nghĩa |
|---|---|
| `start` | argv session mới; `{prompt}` bắt buộc. `{session}` chỉ dùng khi `session: "provided"` (kf tự sinh UUID trước khi chạy) |
| `resume` | argv tiếp session đã lưu, phải có `{session}`. Không có → role luôn chạy mới |
| `session` | `"provided"`, `{ "stdout": "<regex nhóm 1>" }`, hoặc `{ "command", "idField", "matchField" }` (chạy lệnh trả JSON mảng, chọn phần tử có `matchField` chứa marker `kf-run:<id>` mà kf đặt đầu prompt) |
| `usage` | `"json"`: parse `usage.input_tokens/output_tokens` (và `total_cost_usd` nếu có) từ JSON trên stdout |
| `skillsDir` | Thư mục skill của runner; mặc định theo `kf install` (`.claude/skills`, `.agents/skills`, `.gemini/skills`, `.opencode/skills`; tên lạ → `.agents/skills`) |
| `resumeFailure` | Regex nhận biết resume hỏng (mặc định `session\|not found\|no such\|unknown\|does not exist`) |

### Preset đã kiểm chứng (2026-09-19)

| Runner | Session | Kiểm chứng |
|---|---|---|
| claude | kf sinh UUID (`--session-id`), resume `-r`; usage + cost từ JSON | Chạy thật: start + resume OK |
| codex | `thread_id` trong JSONL của `exec --json`, resume `exec resume <id>`; usage từ `turn.completed` | Chạy thật: start + resume OK |
| devin | `devin list --format json` khớp `title` với marker; resume `-r <id>` | Chạy thật: start + list + resume OK. Devin từ chối thư mục chưa trust: mở `devin` tương tác một lần trong repo |
| gemini | không có resume | Không login được trên máy kiểm chứng; `-r` nhận `latest`/số thứ tự, chưa rõ nhận UUID |
| opencode | không có resume | Chưa kiểm chứng cách lấy id; `run -s <id>` tồn tại |

## Flow

1. Main agent (skill `kanban-flow`) trước mỗi stage đọc `kf status --change <f> --json`. Có `assignedRoles` → chạy `kf run <f>` (thêm `--detach` cho stage dài như implementation rồi poll `kf runs <f>`).
2. `kf run` giải chuỗi role của stage rồi chạy **tuần tự**. Với mỗi role, prompt gồm: vai + `brief`, work item, stage, folder, đường dẫn `SKILL.md` của phase cho runner đó, gợi ý `kf status`/`kf instruct`, yêu cầu ghi `output` nếu role có, mục "Previous step" (role trước, file output, log) từ bước thứ hai, và contract: chỉ làm việc của stage, **không** `kf stage`/`kf approve`/`kf archive`/`kf run`, không sửa contract đã approve, không commit, kết thúc bằng `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` + `Summary:`.
3. Mỗi role là một run riêng: process group riêng, log riêng `runs/<id>.log`, một bản ghi trong `.kfw.json.runs[]` có cả `role` và `runner`.
4. Role không kết thúc `DONE`/`DONE_WITH_CONCERNS` → **dừng chuỗi**, các role sau không chạy, `kf run` exit 1 và nêu role nào dừng cùng role nào bị bỏ.
5. Main đọc `STATUS`/`Summary` (đuôi log, không nuốt transcript), chạy `kf validate`, quyết chuyển stage. Gate không tin lời khai của worker.
6. Vòng sửa: `kf run` lần sau resume đúng session của role đó cho work item đó; prompt thêm đường dẫn report FAIL hiện tại. `--fresh` ép session mới.

`kf run --role <name>` chạy đúng một role trong chuỗi. `--dry-run` in kế hoạch cả chuỗi (mỗi role một khối argv + prompt). Timeout mặc định 30 phút (`--timeout <phút>`, `0` = không giới hạn); quá hạn kill cả process group, run `timeout`. Không tự retry; resume hỏng thì reset session đúng một lần rồi chạy mới. Một work item chỉ một run `running` tại một thời điểm.

`--detach`: kf ghi kế hoạch chuỗi rồi spawn một tiến trình `kf run --supervise <id>` tách rời làm supervisor, trả về ngay. Supervisor chạy cả chuỗi và tìm lại folder theo tên work item trước khi ghi kết quả; folder biến mất → ghi `.works/harness/orphan-<id>.json`. `kf runs` báo `failed (supervisor lost)` khi record còn `running` mà pid đã chết, không tự sửa metadata.

## Quan sát

- `kf harness [--json]`: main role, stage → chuỗi role, role → runner (+ brief, output), runner → CLI/PATH/resume/session.
- `kf status --change <f>`: `Assigned: researcher (codex) → writer (gemini) (kf run)`, `Runs: N (role×n, …)`; `--json` có `assignedRoles`, `runs[]`.
- `kf runs [<f>] [--json]`: mọi run kèm role, runner và vị trí trong chuỗi (`2/2`), mới nhất trước. Run nào kết thúc một chuỗi khi chưa tới role cuối và không còn run nào đang chạy sẽ hiển thị `chain stopped 1/2` kèm cảnh báo bên dưới; `--json` có `chainBroken`. Đây là cách phát hiện chuỗi đứt (supervisor chết, Ctrl+C) thay vì tưởng stage đã xong.

Gõ nhầm tên runner vào `stages` được báo rõ thay vì "unknown role":

```
Invalid project config: .kf/config.json — harness.stages.testing "gemini" is a runner,
not a role; declare a role in harness.roles that points at it
```
- `kf view [--json]`: `metrics.runs.byRole` `{ runs, done, failed }` và `metrics.runs.usage` theo role.

## Chi phí token

- Công việc thật (đọc code, sửa, chạy test) không đổi, chỉ chuyển sang quota của runner được gán.
- Đội lên: mỗi lần bàn giao worker phải đọc lại skill + artifact + code liên quan (ước 10-30k token). **Chuỗi role nhân phần này theo số bước**: brainstorm hai role tốn hai lần bàn giao. Chỉ xếp chuỗi khi hai vai thật sự khác việc.
- Vòng sửa tốn thêm lần nữa nếu runner không resume được.
- Main rẻ đi: lúc worker chạy main không tốn gì; chỉ đọc đuôi log.
- Chặn lãng phí: prompt chỉ trỏ đường dẫn; chuỗi dừng ngay khi một role hỏng; worker không in `STATUS` bị coi là chưa xong; không retry.
- Đo: runner có `usage: "json"` ghi token và cost vào `runs[]`, `kf view` cộng dồn **theo role** nên so sánh được vai nào đắt.

## Giới hạn

- Contract "không chuyển stage" là hợp đồng trong prompt, kf không chặn kỹ thuật được (worker có `kf` trên PATH). `runs[]` + `bypasses[]` để soi.
- Chuỗi luôn tuần tự, không song song. Dừng giữa chừng để lại trạng thái nửa vời: role đầu đã ghi file, role sau chưa chạy. `kf run` in rõ, `kf runs` đánh dấu `chain stopped i/n`, và gate artifact của stage vẫn là thứ quyết định.
- Kill process group dùng `process.kill(-pid)` (POSIX). Trên Windows kf không dọn được con của worker.
- `.kfw.json` được ghi lại bởi supervisor và bởi `kf stage` của main; kf đọc lại trước khi ghi và ghi atomic, nhưng không có lock.
- Log worker có thể chứa nội dung nhạy cảm mà CLI in ra; `.works/` thường được ignore, giữ vậy.
- Chưa có bridge async (đánh thức khi main không còn sống) và chưa có `kf run --task` cho việc ad-hoc ngoài stage.

## Điều khoản sử dụng

kf chỉ spawn CLI chính thức của từng hãng bằng cờ headless mà hãng công bố (`claude -p`, `codex exec`, `gemini -p`, `devin -p`, `opencode run`), dưới tài khoản đã login trên máy của người chạy. kf **không** đọc, lưu hay chuyển tiếp credential/token của bất kỳ CLI nào, không gọi API hãng trực tiếp, không retry dồn dập. Mỗi người dùng chịu trách nhiệm với điều khoản gói mình dùng (dùng cho dự án thương mại, chia sẻ tài khoản, giới hạn tần suất); tài liệu này không phải kết luận pháp lý.

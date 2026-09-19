# Gate và artifact contract

Gate được kiểm tra khi rời state hiện tại. `kf validate` dùng cùng validator để báo trước lỗi; `kf stage` và `kf archive` sẽ chặn transition nếu gate không đạt.

## Artifact bắt buộc

| Phase | File | Nội dung tối thiểu | Mở khóa |
| --- | --- | --- | --- |
| 1 — Brainstorm / bug triage | `phase-1-spec-requirement.md` (bug dùng template bug-report) | feature: requirement + FR-XXX; bug: reproduction, actual/expected, severity, regression strategy | Planning |
| 2 — Planning (feature) | `phase-2-implementation-plan.md` | scope, task, impact, DoD, rủi ro | Execution contract |
| 2 — Planning (feature) | `phase-2-use-case-specification.md` + `use-cases/UC-###.md` | index/coverage ở phase file; mỗi UC có precondition, flow, alternate/error flow riêng | Thiết kế và test |
| 2 — Planning (feature) | `phase-2-use-case-diagram.md` | actor/use-case diagram hợp lệ | Traceability |
| 2 — Planning (feature) | `phase-2-test-case.md` | TC-XXX liên kết FR-XXX/UC-XXX | Testing contract |
| 4 — Testing | `phase-4-testing-result.md` | execution ID hiện tại, PASS/FAIL/REJECT/BLOCKED, evidence | Review hoặc repair loop |
| 5 — Review | `phase-5-review-report.md` | execution ID hiện tại, PASS/FAIL/REJECT/REQUIREMENT_BUG, findings | Archive hoặc repair loop |
| 6 — Artifact (feature) | `phase-6-feature-report.md` | tổng kết, thay đổi, test, docs, known limitation | Feature hoàn tất |

Implementation không có artifact bắt buộc riêng trong schema, nhưng skill implement phải hoàn tất task trong plan và để code ở trạng thái có thể test.

## Canonical output khi vào `dones`

`kf archive` copy từ feature folder sang các đường dẫn ổn định theo context. Chỉ feature mới tự động copy canonical docs:

| Nguồn | Đích |
| --- | --- |
| `phase-1-spec-requirement.md` | `docs/requirement/{context}/{feature}.md` |
| `phase-2-use-case-specification.md` | `docs/use-cases/{context}/{feature}/README.md` (index) |
| `use-cases/UC-###.md` | `docs/use-cases/{context}/{feature}/UC-###.md` (mỗi use case một file) |
| `phase-2-use-case-diagram.md` | `docs/use-cases/{context}/{feature}/diagram.md` |
| `phase-2-test-case.md` | `docs/testplan/{context}/{feature}.md` |
| `phase-4-testing-result.md` | `docs/testplan/{context}/{feature}-result.md` |

Requirement canonical được ghi trạng thái `archived`; các artifact còn lại giữ nguyên frontmatter và evidence để tra cứu. Với bug, archive chỉ di chuyển work item vào `dones`; docs của feature liên quan chỉ sửa khi bug report ghi rõ có docs impact. `--skip-specs` bỏ qua toàn bộ bảng copy này.

## Điều kiện theo hướng đi

```mermaid
flowchart LR
    B[brainstorm] -->|requirement confirmed| P[planning]
    P -->|feature: 4 artifacts + approval<br/>bug: bug report + approval| I[implementation]
    I -->|implementation complete + tasks done| T[testing]
    T -->|PASS + current execution| R[review]
    T -->|FAIL/REJECT| I
    R -->|PASS + current execution<br/>feature additionally requires feature report| D[dones]
    R -->|FAIL/REJECT| I
    T -->|scope change| P
    R -->|scope change| P
```

`implementation → testing` còn chặn khi `tasks.md` còn checkbox chưa hoàn tất (DoD). `tasks.md` không phải artifact bắt buộc — không có file thì không áp gate này.

## Contract và traceability

Feature planning tạo chuỗi truy vết:

`FR-XXX` → `UC-XXX` → `TC-XXX` → implementation → testing evidence → review finding.

ID phải khớp chính xác; `FR-001` không được coi là `FR-0010`. Thiếu FR/UC reference trong TC, reference không tồn tại, duplicate TC ID, file rỗng hoặc placeholder chưa thay thế làm validation fail. Agent vẫn phải review nội dung section và tổng số trong bảng.

Validator cũng quét nội dung artifact tìm secret thật (Bearer token, API key, private key, mật khẩu dạng `KEY=value`...) và fail với `artifact_secret` khi phát hiện — artifact không được chứa credential. Giá trị placeholder như `{key}`, `<token>`, `changeme`, `redacted` hay chuỗi `xxx...` không bị flag. Exemption áp lên **giá trị bắt được**, không áp lên cả dòng: `TOKEN=ghp_… # example` vẫn bị flag. Các format độ tin cậy cao (`ghp_`/`github_pat_`, `sk-`, `AKIA`, `xox*-`, header PRIVATE KEY) chỉ được miễn khi giá trị bị che bằng `xxxx`/`****`. Thông báo lỗi không echo giá trị secret.

Report testing `status: PASS` còn phải có bảng dưới heading `## Commands and Evidence` với ít nhất một dòng lệnh và mọi ô Exit code bằng `0`; vi phạm là `testing_exit_code`. Rule này không chứng minh test đã chạy, nó chỉ chặn report PASS thiếu bằng chứng số. Report FAIL/REJECT/BLOCKED không bị ràng buộc.

Approval Phase 2 là fingerprint SHA-256 của requirement, 4 planning artifact và mọi file `use-cases/UC-###.md` với feature; bug fingerprint chỉ dựa trên bug report. Sau khi approval, sửa nội dung contract sẽ yêu cầu quay lại planning, hoàn thiện lại và approve lại.

## Cancelled

`cancelled` là stage duy nhất **không có gate artifact**: `STAGE_INDEX` của nó là `-1` nên mọi so sánh "artifact này đã tới hạn chưa" và "đã qua planning chưa" đều sai, kéo theo validator bỏ qua artifact, approval, traceability và report semantics. Đổi lại nó có đúng một yêu cầu riêng: `cancellation.reason` không được rỗng, thiếu là `cancellation_missing`.

`kf cancel` chạy hook `cancelled.sh` như mọi transition khác, chặn khi còn worker run đang chạy (trừ `--force`), và với item đang ở `dones` thì **liệt kê** canonical docs chứ không xoá; `--purge-docs` mới xoá và vẫn hỏi xác nhận trên TTY. Việc xoá docs chỉ chạy **sau khi** work item đã chuyển sang `.works/cancelled/` thành công, để một lỗi ở bước chuyển không làm mất tài liệu. Item đã cancelled không archive được.

Số liệu: cancelled bị loại khỏi mẫu số của `completionRate` để việc đánh dấu bỏ không làm xấu tỷ lệ, và `kf runs` không liệt kê run của item đã bỏ trừ khi gọi đích danh `kf runs <feature>` (giống item ở `dones`).

## Force và recovery

`--force` chỉ là escape hatch có chủ đích để bỏ qua validation/directional gate. Không nên dùng cho luồng bình thường; khi dùng phải ghi rõ lý do trong review hoặc feature report.

Mỗi lần `--force` bỏ qua một gate đang fail, hoặc `--skip-hooks` bỏ qua một hook thực sự tồn tại, `kf stage`/`kf archive` ghi một bản ghi vào `.kfw.json`:

```json
"bypasses": [
  { "at": "20260919_1230", "from": "brainstorm", "to": "planning", "flag": "force", "codes": ["requirement_unconfirmed"] },
  { "at": "20260919_1231", "from": "planning", "to": "backlog", "flag": "skip-hooks", "codes": ["hook:/path/.kf/hooks/backlog.sh"] }
]
```

Flag không bỏ qua gì (gate đang pass, không có hook) thì không ghi. `kf validate` báo WARNING `gate_bypassed`, `kf status` in `Bypasses: N`, `kf view --json` và dashboard đếm số work item có bypass. CLI không có lệnh xoá bản ghi. Giới hạn: đây là truy vết cho người review, không phải bảo đảm — agent vẫn có thể sửa file JSON bằng tay.

- Hook phase fail: transition bị từ chối; sửa hook hoặc dùng `--skip-hooks` khi đã hiểu tác động.
- Testing/review `FAIL` hoặc `REJECT`: quay về implementation, sửa code rồi vào testing để nhận execution ID mới.
- `BLOCKED`: dừng và báo blocker, không giả PASS.
- `REQUIREMENT_BUG`: dừng feature và báo người dùng; chỉ tiếp tục khi người dùng đưa ra quyết định scope/requirement rõ ràng.
- Archive lỗi giữa chừng: CLI khôi phục feature về review và khôi phục metadata/spec nếu có thể; nếu rollback không hoàn tất, lỗi được trả về rõ ràng để xử lý thủ công.

---
feature: secret-scan-formats
context: cli
created: 20260921_1425
status: archived
---
# Requirement

## Objective / Problem Statement
Bộ quét secret hiện nhận tám mẫu. Ba loại credential rất hay xuất hiện trong artifact của workflow lại **không** nằm trong đó, nên đi qua im lặng (Slack và Discord cần hai mẫu riêng, nên tổng cộng là bốn mẫu mới):

- **JWT** (`eyJ…`) — dán vào testing-result khi ghi lại một request thật là chuyện thường ngày.
- **Slack/Discord webhook URL** — dán vào implementation-plan khi mô tả một integration.
- **Connection string có mật khẩu nhúng** — dán vào bug report khi tái hiện một lỗi database.

Cả ba đều là credential thật, đều nhận dạng được bằng hình dạng, và đều lọt.

## Scope
### In Scope
- Thêm bốn mẫu vào `SECRET_PATTERNS` trong `src/workflow/secrets.ts` (JWT, Slack, Discord, connection string).

### Out of Scope
- **Entropy check cho `KEY=value`.** Backlog có nêu, nhưng nó đổi *bản chất* của bộ quét từ "nhận dạng hình dạng đã biết" sang "đoán theo thống kê", và kéo theo false positive trên những chuỗi hợp lệ như hash commit hay base64 của một ảnh nhỏ. Đó là một quyết định riêng, cần dữ liệu thật để hiệu chỉnh ngưỡng; không gộp vào đây.
- Quét file ngoài artifact của workflow.
- Tự xoá hay che secret trong file. Công cụ báo, người sửa.

## Actors
- Người viết artifact vô tình dán một credential thật.
- Agent ghi lại bằng chứng từ một request thật.

## Functional Requirements
- **FR-001** (must) — Phát hiện JWT: ba đoạn base64url ngăn bởi dấu chấm, bắt đầu bằng `eyJ` (header JSON đã encode).
- **FR-002** (must) — Phát hiện webhook URL của Slack và Discord.
- **FR-003** (must) — Phát hiện connection string mang mật khẩu nhúng (`scheme://user:<password>@host`), và **chỉ báo khi thật sự có mật khẩu** — `postgres://localhost/db` không phải secret.
- **FR-004** (must) — Giữ nguyên hai nguyên tắc cũ: không flag placeholder, và **không bao giờ in giá trị secret ra ngoài**.
- **FR-005** (must) — JWT, Slack và Discord là high-confidence: chỉ giá trị đã che (`xxxx`/`****`) mới được miễn, không miễn theo từ khoá như `example`. Cả ba đều có **tiền tố mà chỉ credential thật mới mang**, nên không lời lẽ nào trên dòng đó nên miễn cho chúng.
- **FR-005b** (must) — Connection string **không** high-confidence, vì nó không có dấu hiệu nào như vậy: nó thuần là hình dạng URL, thứ mà một template lương thiện như `scheme://user:<password>@host` cũng có. Nó dùng phép miễn placeholder thông thường, áp lên **mật khẩu** chứ không lên cả dòng — nên `hunter2` vẫn bị bắt còn `<password>` thì không.
- **FR-006** (must) — Không mẫu mới nào gây false positive trên nội dung thường gặp trong chính artifact của dự án này.

## Non-Functional Requirements
- Quét theo dòng, không đổi độ phức tạp.
- Thông điệp lỗi vẫn không chứa giá trị secret.

## Main Use Cases
- **UC-001** — Artifact chứa JWT thật bị chặn ở gate.
- **UC-002** — Artifact chứa connection string có mật khẩu bị chặn; bản không mật khẩu thì không.

## Test Strategy
- Level: unit
- UI Tests: không
- Tools: vitest
- Coverage Target: N/A (chứng minh bằng mutation)

## Acceptance Criteria
- [ ] JWT thật (`eyJ` + hai đoạn nữa) bị báo.
- [ ] Chuỗi `eyJ` cụt (chỉ một đoạn, không đủ ba phần) **không** bị báo.
- [ ] Slack webhook URL và Discord webhook URL đều bị báo.
- [ ] Connection string mang một mật khẩu thật bị báo; `postgres://localhost:5432/db` (không mật khẩu) **không** bị báo.
- [ ] Dạng chỉ có mật khẩu, không username (`redis://:…@host`) cũng bị báo.
- [ ] Giá trị đã che ở vị trí mật khẩu (`xxxx`) **không** bị báo.
- [ ] Từ khoá `example` trên cùng dòng **không** miễn cho JWT/Slack/Discord.
- [ ] Placeholder rõ ràng ở vị trí mật khẩu (`<password>`, `{pass}`, `xxxx`) **không** bị báo; mật khẩu thật (`hunter2`) thì bị.
- [ ] Không hit nào in ra giá trị secret đầy đủ.
- [ ] Quét toàn bộ artifact thật trong `.works/` và `docs/` của repo này: **không** false positive.

## Edge Cases
- JWT nằm trong một URL hay header: vẫn bắt.
- Connection string trong một code fence: vẫn bắt — code fence không làm credential bớt thật.
- Tài liệu mô tả chính định dạng này (`scheme://user:<password>@host`): **không** bị bắt. Đây là ca đã làm lộ ra thiết kế sai ở bản đầu — mẫu bị đánh dấu high-confidence, và gate từ chối chính tài liệu giải thích nó.

## Documentation Impact

| Update needed? | Affected docs | Reason / intended update |
|---|---|---|
| Có | `docs/workflow/gates.md` | Liệt kê thêm các định dạng được nhận, và nêu rõ vì sao connection string không phải high-confidence. |

## Open Questions
- Không còn.

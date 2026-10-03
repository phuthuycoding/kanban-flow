---
feature: "workflow-hardening"
context: "cli"
created: "20260919_1206"
status: planning
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Validator chặn secret thật dù dòng có từ placeholder |
| Requirement reference | FR-002, FR-005 |
| Goal | Artifact chứa credential thật không qua được gate, kể cả khi agent ghi kèm chữ "example" |
| Primary actor | Agent |

## Supporting Actors
- Người vận hành (đọc thông báo lỗi để gỡ secret)

## Preconditions
- Feature có artifact đang due ở stage hiện tại

## Trigger
`kf validate`, `kf stage` hoặc `kf archive` chạy validator trên artifact.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Validator | Với mỗi dòng, thử từng pattern secret, lấy **giá trị** bắt được | Có value hoặc không |
| 2 | Validator | Nếu pattern thuộc nhóm độ tin cậy cao → flag ngay | ERROR `artifact_secret` |
| 3 | Validator | Nếu pattern thường → kiểm tra value có giống placeholder không; chỉ miễn khi value là placeholder | Flag khi value thật |
| 4 | CLI | In số dòng bị flag, không in giá trị secret | Agent gỡ secret rồi chạy lại |

## Alternative Flows
### A1
- Trigger: Value là placeholder (`{key}`, `<token>`, `changeme`, `xxxx…`, `****`)

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Miễn dòng đó | Không có issue, tiếp dòng sau |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Artifact không đọc được (quyền, encoding) | Lỗi nổi lên, không nuốt | `kf` exit 1 với thông báo gốc |

## Postconditions
- Không artifact nào trong `.works/` chứa credential thật khi đi qua gate

## Business Rules
- Exemption áp dụng lên value, không áp dụng lên cả dòng
- Pattern độ tin cậy cao (`ghp_`, `github_pat_`, `sk-`, `AKIA`, `xox*-`, PRIVATE KEY) không có exemption từ khoá; chỉ chuỗi ký tự lặp (`x`, `*`) mới coi là placeholder
- Output không được echo giá trị secret

## Data
- Danh sách pattern và nhóm độ tin cậy trong `src/workflow/secrets.ts`

## Acceptance Criteria
- [ ] Secret thật kèm từ placeholder trên dòng bị flag (TC-003)
- [ ] Placeholder thật không bị flag (TC-004)
- [ ] Validator đã tách module, suite hiện có xanh (TC-009)

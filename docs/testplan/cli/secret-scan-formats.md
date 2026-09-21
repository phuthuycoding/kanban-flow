---
feature: "secret-scan-formats"
context: "cli"
created: "20260921_1426"
---

# Test Cases

## TC-001
FR-001 UC-001
JWT đủ ba đoạn bị báo. Chuỗi `eyJ` chỉ một đoạn không bị báo.

## TC-002
FR-002 UC-001
Slack webhook URL và Discord webhook URL đều bị báo.

## TC-003
FR-003 UC-002
`postgres://user:xxxx@host/db` bị báo; `postgres://localhost:5432/db` không bị báo; `redis://:xxxx@host` bị báo.

## TC-004
FR-004 UC-001
Không hit nào chứa giá trị secret đầy đủ.

## TC-005
FR-005 UC-001
Từ khoá `example` trên cùng dòng không miễn cho mẫu mới; giá trị đã che (`xxxx`) thì miễn.

## TC-006
FR-006 UC-002
Quét mọi artifact thật trong `.works/` và `docs/` của repo này: không hit nào.

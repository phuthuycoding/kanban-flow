---
feature: "context-registry"
context: "cli"
created: "20260920_1350"
status: planning
---

# Use Case Index

Every use case is its own file under `use-cases/`. Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Đại ca khai danh sách context lúc init | [UC-001](UC-001.md) | Đại ca | planned |
| UC-002 | Gõ nhầm context bị chặn kèm gợi ý | [UC-002](UC-002.md) | Người tạo work item | planned |
| UC-003 | Agent khảo sát repo rồi đề xuất danh sách | [UC-003](UC-003.md) | Agent | planned |
| UC-004 | Nhìn ra context đang dùng mà chưa khai | [UC-004](UC-004.md) | Đại ca | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001, FR-003, FR-005, FR-006, FR-007 | TC-003, TC-004, TC-011, TC-012, TC-013 | full |
| UC-002 | FR-002 | TC-001, TC-002, TC-005, TC-006, TC-007 | full |
| UC-003 | FR-004 | TC-008 | full |
| UC-004 | FR-004 | TC-009, TC-010 | full |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 4 |
| Actors | 3 |
| Functional requirements covered | 7 |
| Test cases linked | 13 |

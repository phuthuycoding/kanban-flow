---
feature: "worktree-domains"
context: "cli"
created: "20261007_1929"
status: planning
---

# Use Case Index

Every use case is its own file under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`). Do not write a combined narrative here.

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Onboard hạ tầng domain lần đầu | [UC-001](UC-001-onboard-domain-infra.md) | Người vận hành | planned |
| UC-002 | Vào implementation tự có worktree + domain | [UC-002](UC-002-auto-worktree-on-implementation.md) | Agent | planned |
| UC-003 | Agent code và tự test qua domain trong worktree | [UC-003](UC-003-agent-codes-tests-in-worktree.md) | Agent | planned |
| UC-004 | Archive: gỡ worktree, giữ branch, cảnh báo unmerged | [UC-004](UC-004-archive-removes-worktree.md) | Agent | planned |
| UC-005 | Hạ tầng chưa setup: doctor/validate cảnh báo | [UC-005](UC-005-infra-missing-warning.md) | Người vận hành | planned |
| UC-006 | Resume/re-enter implementation tái dùng worktree | [UC-006](UC-006-resume-reuses-worktree.md) | Agent | planned |
| UC-007 | Worktree dirty khi archive: từ chối và hướng dẫn | [UC-007](UC-007-dirty-worktree-blocks-teardown.md) | Agent | planned |
| UC-008 | Liệt kê worktree và phát hiện orphan | [UC-008](UC-008-list-worktrees-orphans.md) | Người vận hành | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-005 | TC-011, TC-012 | setup idempotent, conflict từ chối |
| UC-002 | FR-001, FR-002 | TC-001..TC-004, TC-013, TC-014 | worktree+route sinh ra, fail-closed |
| UC-003 | FR-003, FR-004, FR-009 | TC-005..TC-010, TC-021, TC-022 | kf chạy trong worktree, proxy forward đúng |
| UC-004 | FR-007 | TC-016 | worktree+route gỡ, branch giữ, warn unmerged |
| UC-005 | FR-006 | TC-019 | doctor/validate cảnh báo, không chặn |
| UC-006 | FR-001, FR-002 | TC-015 | tái dùng worktree, không tạo trùng |
| UC-007 | FR-007 | TC-017, TC-018 | dirty từ chối, force remove được, cancel teardown |
| UC-008 | FR-008 | TC-020 | list đủ item, orphan được báo |

## Totals

| Metric | Total |
|---|---:|
| Use cases | 8 |
| Actors | 3 |
| Functional requirements covered | 9 |
| Test cases linked | 22 |

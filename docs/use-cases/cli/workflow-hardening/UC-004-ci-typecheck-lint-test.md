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
| ID | UC-004 |
| Name | CI chạy typecheck, lint, test trên push/PR |
| Requirement reference | FR-004 |
| Goal | Mọi thay đổi lên repo được kiểm tra tự động trên Node 20 và 22, kể cả lỗi kiểu trong test |
| Primary actor | GitHub Actions runner |

## Supporting Actors
- Người vận hành (push, mở PR, đọc kết quả)

## Preconditions
- Repo có `.github/workflows/ci.yml`; `package-lock.json` có mặt để `npm ci`

## Trigger
Push hoặc pull request tới bất kỳ branch nào.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Runner | Checkout, setup Node theo matrix `[20, 22]`, `npm ci` | Dependencies cài từ lockfile |
| 2 | Runner | `npm run typecheck` | Bao gồm `src/tests/**`; lỗi kiểu ở test làm job đỏ |
| 3 | Runner | `npm run lint` | oxlint trên `src` |
| 4 | Runner | `npm test` | vitest toàn bộ suite |
| 5 | GitHub | Báo trạng thái trên commit/PR | Người vận hành thấy pass/fail |

## Alternative Flows
### A1
- Trigger: Người vận hành chạy cục bộ trước khi push

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Chạy ba lệnh trên máy dev | Cùng kết quả với CI vì cùng script |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Một job trong matrix fail | Job còn lại vẫn chạy (`fail-fast: false`) | Biết được lỗi thuộc Node version nào |

## Postconditions
- Commit có trạng thái CI; branch protection có thể bật sau

## Business Rules
- `npm run build` vẫn không emit test (`tsconfig.build.json`)
- CI không cần secret nào

## Data
- `.github/workflows/ci.yml`, `tsconfig.json`, `tsconfig.build.json`

## Acceptance Criteria
- [ ] Workflow đúng cấu trúc; typecheck bắt lỗi kiểu trong test; build không emit test (TC-008)

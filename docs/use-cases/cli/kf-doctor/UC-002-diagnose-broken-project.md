---
feature: "kf-doctor"
context: "cli"
created: "20260921_1406"
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Chẩn đoán một project hỏng |
| Actor | Người dùng |
| Goal | Biết chính xác cái gì hỏng, thay vì đoán từ một thông báo lỗi không liên quan |
| Covers | FR-003, FR-004, FR-006, FR-008 |

## Preconditions
Một lệnh kanban-flow nào đó vừa chết với thông báo khó hiểu.

## Main Flow
1. Người dùng chạy `kf doctor`.
2. `.kf/config.json` chứa JSON hỏng. Doctor **không ném** — nó bắt lỗi đó và biến thành một mục ERROR nêu file và lý do.
3. Doctor chạy nốt các phép kiểm còn lại, không dừng ở lỗi đầu tiên.
4. Mỗi vấn đề in kèm một lệnh người dùng tự chạy để sửa.
5. Lệnh exit 1.

## Alternate Flows
- Một work item có `.kfw.json` rác: ERROR nêu tên item và đường dẫn.
- Thiếu stage directory: ERROR nêu đúng tên thư mục.
- Config còn `defaultContext` trong khi đã khai `contexts`: WARNING nói trường đó bị bỏ qua; exit **vẫn** theo các mục ERROR khác.

## Postconditions
Không có gì được sửa tự động. Doctor chẩn đoán, không chữa.

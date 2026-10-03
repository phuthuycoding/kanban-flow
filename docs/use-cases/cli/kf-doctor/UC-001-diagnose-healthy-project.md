---
feature: "kf-doctor"
context: "cli"
created: "20260921_1406"
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Chẩn đoán một project lành |
| Actor | Người dùng |
| Goal | Biết chắc môi trường không có gì hỏng trước khi đổ lỗi cho chỗ khác |
| Covers | FR-001, FR-002, FR-005, FR-007, FR-008 |

## Preconditions
Project đã `kf init`, skills đã cài, config đọc được.

## Main Flow
1. Người dùng chạy `kf doctor` từ một thư mục con.
2. Doctor tìm ngược lên tới gốc project.
3. Doctor chạy sáu phép kiểm và không tìm thấy vấn đề mức ERROR.
4. Doctor in danh sách mục đã kiểm, dòng tóm tắt số work item, và kết luận healthy.
5. Lệnh exit 0.

## Alternate Flows
- Có work item invalid: dòng tóm tắt nêu số lượng và trỏ sang `kf validate --all`; kết luận **vẫn** healthy và exit vẫn 0.

## Postconditions
Không có gì trên đĩa bị thay đổi.

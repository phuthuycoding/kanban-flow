---
feature: "secret-scan-formats"
context: "cli"
created: "20260921_1426"
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | JWT dán vào bằng chứng bị chặn |
| Actor | Agent ghi bằng chứng |
| Goal | Một token thật không đi vào repo qua đường artifact |
| Covers | FR-001, FR-004, FR-005 |

## Preconditions
Agent vừa chạy một request thật và đang chép response vào `phase-4-testing-result.md`.

## Main Flow
1. Agent dán nguyên header, trong đó có `Authorization: Bearer eyJ…`.
2. Agent chạy `kf stage <feature> review`.
3. Gate báo `artifact_secret`, nêu tên file, **không in giá trị token**.
4. Agent thay token bằng `<redacted>` rồi chạy lại.

## Alternate Flows
- Token đã che sẵn (`eyJxxxx`): không bị chặn.
- Chuỗi bắt đầu bằng `eyJ` nhưng không đủ ba đoạn: không phải JWT, không bị chặn.

## Postconditions
Artifact không mang credential; không có giá trị nào bị in ra log.

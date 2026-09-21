---
feature: "secret-scan-formats"
context: "cli"
created: "20260921_1426"
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-002 |
| Name | Connection string có mật khẩu bị chặn |
| Actor | Người viết bug report |
| Goal | Mật khẩu database không nằm lại trong repo sau khi tái hiện một lỗi |
| Covers | FR-003, FR-006 |

## Preconditions
Người dùng đang viết các bước tái hiện một lỗi database.

## Main Flow
1. Họ dán `postgres://admin:xxxx@db.internal/app` vào phần Steps to Reproduce.
2. `kf validate` báo `artifact_secret`.
3. Họ thay mật khẩu bằng `xxxx` và chạy lại; lần này qua.

## Alternate Flows
- `postgres://localhost:5432/app` (không mật khẩu): không bị chặn — không có gì để lộ.
- `redis://:xxxx@host` (chỉ có mật khẩu, không username): vẫn bị chặn.

## Postconditions
Bước tái hiện vẫn đọc được, mật khẩu thì không còn.

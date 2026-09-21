---
feature: "kf-doctor"
context: "cli"
created: "20260921_1406"
---

# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-003 |
| Name | Agent đọc kết quả bằng máy |
| Actor | Agent |
| Goal | Quyết định có làm tiếp trên repo này được không, trước khi bắt đầu |
| Covers | FR-009 |

## Preconditions
Agent vừa được giao việc trên một repo nó chưa từng đụng.

## Main Flow
1. Agent chạy `kf doctor --json`.
2. Doctor trả về cùng các mục và cùng verdict với bản text.
3. Agent đọc `ok`; nếu false thì báo người thay vì lao vào sửa.

## Postconditions
Không có gì bị thay đổi.

# Kanban Flow Workflow

`kaban-flow` điều khiển vòng đời feature bằng CLI `kf` và các skill phase:

```text
brainstorm → planning → implementation → testing → review → dones
                 ↘ backlog ↗
```

Mục tiêu của pipeline là biến một ý tưởng thành một execution contract được duyệt, thực thi có traceability, test và review đúng phiên bản trước khi archive.

Feature và bug dùng chung state machine. Bug tạo bằng `kf new <name> --type bug`, đi qua `kanban-bug` để triage/reproduce trước khi vào planning.

## Đọc nhanh

1. [Lifecycle](lifecycle.md) — ai làm gì và thứ tự ra sao.
2. [State machine](state-machine.md) — state và transition được phép.
3. [Gates](gates.md) — artifact, approval, execution id và report status.
4. [Artifact contract](artifacts.md) — cấu trúc file, traceability và canonical output.
5. [CLI reference](cli-reference.md) — cú pháp lệnh để agent thao tác state.
6. [Skill routing](skills.md) — skill nào được load ở mỗi state.
7. [Dashboard](dashboard.md) — KPI, chart, filter và ý nghĩa số liệu.
8. [Source layout](source-layout.md) — cấu trúc thư mục `src/` và hướng dẫn mở rộng.

## Các nguyên tắc bất biến

- Không di chuyển folder thủ công; dùng `kf stage` hoặc `kf archive`.
- Requirement/bug report phải `status: confirmed` trước khi rời brainstorm.
- Sau khi planning được approve, người dùng chọn triển khai ngay hoặc đưa feature/bug vào `backlog`.
- Planning phải được human approve. Feature fingerprint gồm requirement, bốn planning artifacts và các file UC; bug fingerprint chỉ gồm bug report.
- Sửa execution contract sau approval buộc quay lại planning và approve lại.
- Mỗi lần vào testing tạo execution id mới. Testing và review report phải tham chiếu đúng id đó.
- FAIL/REJECT quay về implementation rồi phải testing lại. BLOCKED dừng pipeline.
- REQUIREMENT_BUG dừng mọi transition thông thường để người dùng quyết định.
- Feature report phải được viết trước archive; CLI sync canonical docs khi archive feature. Bug chỉ cập nhật docs liên quan khi có docs impact.
- Pipeline không tự cấp quyền cho database, deployment, publish, message hoặc thay đổi ngoài scope được duyệt.

## Filesystem model

```text
project/
├── .kf/
│   ├── config.json
│   ├── templates/
│   ├── hooks/
│   └── review/rules/
├── .works/
│   ├── brainstorm/
│   ├── planning/
│   ├── backlog/
│   ├── implementation/
│   ├── testing/
│   ├── review/
│   └── dones/
└── docs/
    ├── requirement/{context}/{feature}.md
    ├── use-cases/{context}/{feature}/README.md + UC-###.md + diagram.md
    └── testplan/{context}/{feature}{,-result}.md
```

Mỗi feature folder có tên `{feature}_{YYYYMMDD_HHmm}` và metadata `.kfw.json`. Các artifact chuẩn dùng prefix `phase-{number}-`.

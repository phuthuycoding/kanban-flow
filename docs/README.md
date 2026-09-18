# Documentation

Tài liệu của `kaban-flow` được chia theo mục đích:

- [Workflow guide](workflow/README.md) — cách pipeline vận hành, state machine, gate, CLI và skill routing.
- [Workflow lifecycle](workflow/lifecycle.md) — luồng thực thi feature/bug từ requirement hoặc triage đến archive.
- [State diagram](workflow/state-machine.md) — các state, transition hợp lệ và điều kiện chuyển.
- [Gate và artifact contract](workflow/gates.md) — điều kiện bắt buộc ở từng phase.
- [Artifact contract và cấu trúc đọc](workflow/artifacts.md) — cách đọc artifact, traceability và bộ docs sau archive.
- [CLI reference](workflow/cli-reference.md) — lệnh, input, output và exit code.
- [Dashboard analytics](workflow/dashboard.md) — KPI, biểu đồ và cách tính số liệu.
- [Skill routing](workflow/skills.md) — trách nhiệm của orchestrator và từng phase skill.
- [Source layout](workflow/source-layout.md) — cấu trúc mã nguồn và hướng dẫn đặt file mới.
- `requirement/`, `use-cases/`, `testplan/` — canonical docs được copy khi feature vào `dones`; bug chỉ cập nhật docs liên quan nếu cần.

Nguồn sự thật của state là filesystem `.works/`, metadata `.kfw.json`, config `.kf/config.json` và các artifact trong feature folder. Tài liệu này mô tả hành vi hiện tại của CLI trong `src/`.

# Dashboard số liệu và chart

Chạy `kf dashboard` rồi mở `http://localhost:8787`. Đổi cổng bằng `--port`. Dashboard tự làm mới mỗi 5 giây, có nút làm mới thủ công và bộ lọc context/feature/bug.

## KPI

| Số liệu | Cách tính |
|---|---|
| Tổng work item | Toàn bộ feature/bug khớp bộ lọc, gồm `dones` |
| Đang thực thi | Item ở `implementation`, `testing`, `review` |
| Backlog | Item ở `backlog` |
| Đã hoàn tất | Item ở `dones`; tỷ lệ = số dones / tổng item |
| Tiến độ task | Tổng checkbox hoàn tất / tổng checkbox của item đang thực thi |

Khi không có item hoặc task để tính tỷ lệ, hiển thị `—`. Item đang thực thi chưa có checkbox task được đếm riêng; không bị mặc định thành đã xong. Tiến độ task không phải test pass rate hay code coverage.

## Biểu đồ

- Bar chart theo stage: tổng item và phân chia feature/bug ở mỗi trạng thái.
- Donut feature/bug: tỷ trọng loại work item theo bộ lọc.
- Bar chart theo context: khối lượng item giữa các context, xếp giảm dần theo tổng số.
- Bar chart approval: pending/approved/changed của item từ planning đến review, gồm backlog; không tính brainstorm và dones.
- Thanh tiến độ task: số task hoàn tất, item có task và item chưa có task trong các stage đang thực thi.

Biểu đồ thể hiện snapshot filesystem hiện tại. Workflow chưa lưu lịch sử chuyển stage, vì vậy dashboard không suy diễn throughput, lead time hay xu hướng theo thời gian từ các count này.

## CLI và API

`kf view` in thống kê tổng hợp ở terminal. `kf view --json` và `/api/data` trả `metrics`, `charts`, `availableContexts` cùng chi tiết `stages` để giữ khả năng đọc bằng agent/tool hiện có.

API hỗ trợ `?kind=feature|bug&context=<slug>`. Bỏ tham số để xem tất cả. `context=__none__` chọn các item cũ không có context. Danh sách context dùng cho filter vẫn lấy trên toàn bộ project.

Nếu API lỗi, dashboard hiện thông báo và giữ snapshot trước đó kèm cảnh báo số liệu có thể đã cũ; không biến lỗi thành số liệu 0.

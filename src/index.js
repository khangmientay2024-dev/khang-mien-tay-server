const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Cho phép Express phục vụ các file giao diện tĩnh (HTML, CSS, JS) trong thư mục 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Mảng tạm thời để lưu trữ đơn hàng (Khi nào có database sẽ lưu vào DB sau)
let orders = [];
let orderIdCounter = 1;

// ================= API HỆ THỐNG ĐƠN HÀNG =================

// 1. API Lấy danh sách toàn bộ đơn hàng
app.get('/api/orders', (req, res) => {
    res.json(orders);
});

// 2. API Nhân viên bán hàng tạo đơn mới
app.post('/api/orders', (req, res) => {
    const { content, note } = req.body;
    
    if (!content) {
        return res.status(400).json({ error: 'Nội dung đơn hàng không được để trống' });
    }

    const newOrder = {
        id: orderIdCounter++,
        content: content,      // Ví dụ: "2 Trà Sữa - 1 Hồng Trà"
        note: note || '',      // Ví dụ: "Ship KTX Khu B"
        status: 'PENDING',     // Các trạng thái: PENDING (Chờ pha chế), READY (Đã pha xong - Gọi ship), DELIVERING (Đang giao), DONE (Hoàn thành)
        createdAt: new Date()
    };

    orders.push(newOrder);
    console.log(`[ĐƠN MỚI] Đã tạo đơn #${newOrder.id}`);
    
    // TODO: Bắn tín hiệu Realtime tới màn hình Pha chế ở đây
    
    res.status(201).json({ success: true, order: newOrder });
});

// 3. API Thay đổi trạng thái đơn hàng (Dùng cho Pha chế gọi ship, Shipper nhận đơn)
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body; // Trạng thái mới truyền lên

    const order = orders.find(o => o.id === orderId);
    if (!order) {
        return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }

    order.status = status;
    console.log(`[CẬP NHẬT] Đơn #${orderId} chuyển sang trạng thái: ${status}`);

    // TODO: Bắn tín hiệu Realtime tới màn hình Shipper/Pha chế ở đây

    res.json({ success: true, order: order });
});

// Trang chủ mặc định hướng dẫn kết nối
app.get('/', (req, res) => {
    res.send('Server Web App Khang Miền Tây đã sẵn sàng phục vụ API!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server đang chạy mượt mà tại cổng: ${PORT}`);
});
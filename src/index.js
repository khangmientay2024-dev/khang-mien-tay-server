const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// HỆ THỐNG TÀI KHOẢN SHIPPER CỐ ĐỊNH (Có thể sửa đổi hoặc thêm bớt tùy ý ông)
const SHIPPER_ACCOUNTS = [
    { username: 'haiduoi05', password: '2005', name: 'Hải' },
    { username: 'tudoi05', password: '2005', name: 'Tú' },
    { username: 'khiemkhom05', password: '2005', name: 'Khiêm' }
];

let orders = [];
let shipperLocations = {}; // Lưu GPS của tất cả shipper online: { 'Tên': { lat, lng, updatedAt } }
let orderIdCounter = 1;

// 1. API ĐĂNG NHẬP CHO SHIPPER
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = SHIPPER_ACCOUNTS.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, name: user.name });
    } else {
        res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu rồi ông ơi!' });
    }
});

// LẤY DANH SÁCH ĐƠN HÀNG
app.get('/api/orders', (req, res) => res.json(orders));

// 2. TIẾP NHẬN ĐƠN MỚI TỪ BẾP + CHECK TRÙNG LẶP
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime, phone } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung trống trơn ông ơi!' });

    // Tự động bóc tách số điện thoại
    let extractedPhone = phone || '';
    if (!extractedPhone) {
        const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
        const match = content.match(phoneRegex);
        if (match) extractedPhone = match[0];
    }

    // Thuật toán kiểm tra trùng lặp
    const isDuplicate = orders.some(o => {
        const matchContent = o.content.trim().toLowerCase() === content.trim().toLowerCase();
        const matchPhone = extractedPhone && o.phone === extractedPhone && o.status !== 'DONE';
        return matchContent || matchPhone;
    });

    if (isDuplicate) {
        return res.status(400).json({ 
            success: false, 
            isDuplicate: true, 
            error: `🚨 ĐƠN BỊ TRÙNG! Đơn này đã có trong hệ thống rồi ông ơi!` 
        });
    }

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        phone: extractedPhone, 
        deliveryTime: deliveryTime || 'Giao ngay',
        status: 'PENDING', // PENDING -> SHIPPING -> DONE
        shipperName: null,
        createdAt: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder });
});

// 3. SHIPPER BẤM NHẬN GIAO ĐƠN (Hệ thống tự động điền tên người đăng nhập)
app.put('/api/orders/:id/assign', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { shipperName } = req.body;
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng!' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: 'Đơn này có người nhận rồi ông ơi!' });

    order.status = 'SHIPPING';
    order.shipperName = shipperName || 'Shipper Ẩn Danh';
    res.json({ success: true, order });
});

// 4. CẬP NHẬT TRẠNG THÁI GIAO XONG (DẤU TICK REAL-TIME)
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không thấy đơn' });

    order.status = status;
    res.json({ success: true });
});

// 5. CẬP NHẬT TỌA ĐỘ GPS (Cứ online ca làm là tự động truyền về máy chủ)
app.post('/api/shipper/location', (req, res) => {
    const { shipperName, lat, lng } = req.body;
    if (!shipperName) return res.status(400).json({ error: 'Thiếu tên shipper' });

    shipperLocations[shipperName] = {
        lat,
        lng,
        updatedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    res.json({ success: true });
});

// LẤY VỊ TRÍ TẤT CẢ SHIPPER ĐỂ HIỂN THỊ LÊN RADAR BẾP
app.get('/api/shipper/locations', (req, res) => res.json(shipperLocations));

// HỦY/XÓA ĐƠN HÀNG TRÊN BẾP
app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === orderId);
    if (index !== -1) orders.splice(index, 1);
    res.json({ success: true });
});

// XUẤT FILE EXCEL
app.get('/api/export-excel', async (req, res) => {
    try {
        if (orders.length === 0) return res.status(400).send('Không có dữ liệu đơn');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Khang Mien Tay POS');
        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Nội Dung', key: 'content', width: 40 },
            { header: 'Số Điện Thoại', key: 'phone', width: 15 },
            { header: 'Shipper Giao', key: 'shipperName', width: 15 },
            { header: 'Trạng Thái', key: 'status', width: 15 }
        ];
        orders.forEach(o => worksheet.addRow(o));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Bao_Cao_Don_Hang.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Hệ thống Khang Miền Tây chạy tại cổng: ${PORT}`));
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// TÀI KHOẢN SHIPPER CỐ ĐỊNH
const SHIPPER_ACCOUNTS = [
    { username: 'ship01', password: '123', name: 'Khang Miền Tây' },
    { username: 'ship02', password: '123', name: 'Anh An' },
    { username: 'ship03', password: '123', name: 'Anh Tuấn' }
];

let orders = [];
let shipperLocations = {}; // { 'Tên': { lat, lng, updatedAt, timestamp } }
let chatMessages = []; 
let orderIdCounter = 1;

// LẤY GIỜ VIỆT NAM CHUẨN
function getVNTime() {
    return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
}

// THUẬT TOÁN ĐẾM SỐ SHIPPER ĐANG HOẠT ĐỘNG (Trong vòng 2 phút trở lại)
function getActiveShippers() {
    const now = Date.now();
    const activeList = [];
    for (let name in shipperLocations) {
        if (now - shipperLocations[name].timestamp < 120000) {
            activeList.push(name);
        }
    }
    return activeList;
}

// 1. ĐĂNG NHẬP
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = SHIPPER_ACCOUNTS.find(u => u.username === username && u.password === password);
    if (user) res.json({ success: true, name: user.name });
    else res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu!' });
});

// LẤY DANH SÁCH ĐƠN HÀNG
app.get('/api/orders', (req, res) => res.json(orders));

// 2. TẠO ĐƠN MỚI (Bếp hay Shipper gọi vào đây đều được)
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime, phone } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung trống!' });

    let extractedPhone = phone || '';
    if (!extractedPhone) {
        const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
        const match = content.match(phoneRegex);
        if (match) extractedPhone = match[0];
    }

    // RÀNG BUỘC SỐ ĐIỆN THOẠI 10 SỐ VÀ BẮT ĐẦU BẰNG 0
    if (!extractedPhone || !/^0\d{9}$/.test(extractedPhone)) {
        return res.status(400).json({ 
            success: false, 
            isInvalidPhone: true, 
            error: '🚨 LỖI TẠO ĐƠN: Số điện thoại không hợp lệ! Vui lòng nhập đúng 10 số (VD: 0912345678).' 
        });
    }

    const isDuplicate = orders.some(o => {
        const matchContent = o.content.trim().toLowerCase() === content.trim().toLowerCase();
        const matchPhone = o.phone === extractedPhone;
        return matchContent && matchPhone && o.status !== 'DONE';
    });

    if (isDuplicate) {
        return res.status(400).json({ 
            success: false, 
            isDuplicate: true, 
            error: `🚨 TRÙNG ĐƠN! Đơn này đã có trên hệ thống rồi ông ơi!` 
        });
    }

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        phone: extractedPhone, 
        deliveryTime: deliveryTime || 'Giao ngay',
        status: 'PENDING', 
        shipperName: null,
        createdAt: getVNTime()
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder });
});

// 3. BẾP BẤM PHA XONG -> TỰ ĐỘNG PHÂN PHỐI NẾU CHỈ CÓ 1 SHIPPER
app.put('/api/orders/:id/ready', (req, res) => {
    const orderId = parseInt(req.params.id);
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không thấy đơn!' });
    
    const activeShippers = getActiveShippers();
    
    if (activeShippers.length === 1) {
        order.status = 'SHIPPING';
        order.shipperName = activeShippers[0];
    } else {
        order.status = 'READY';
    }
    res.json({ success: true, autoAssigned: activeShippers.length === 1 });
});

// 4. SHIPPER CHỦ ĐỘNG NHẬN ĐƠN
app.put('/api/orders/:id/assign', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { shipperName } = req.body;
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng!' });
    if (order.status !== 'READY') return res.status(400).json({ error: 'Đơn này trạng thái không hợp lệ hoặc đã có người nhận!' });

    order.status = 'SHIPPING';
    order.shipperName = shipperName || 'Shipper Ẩn Danh';
    res.json({ success: true, order });
});

// 5. CẬP NHẬT GIAO XONG
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    const order = orders.find(o => o.id === orderId);
    if (order) order.status = status;
    res.json({ success: true });
});

app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === orderId);
    if (index !== -1) orders.splice(index, 1);
    res.json({ success: true });
});

// CẬP NHẬT TỌA ĐỘ VÀ THỜI GIAN THỰC
app.post('/api/shipper/location', (req, res) => {
    const { shipperName, lat, lng } = req.body;
    if (shipperName) {
        shipperLocations[shipperName] = { 
            lat, 
            lng, 
            updatedAt: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            timestamp: Date.now()
        };
    }
    res.json({ success: true });
});

app.get('/api/shipper/locations', (req, res) => res.json(shipperLocations));

// TRÒ CHUYỆN REALTIME
app.get('/api/chat', (req, res) => res.json(chatMessages));
app.post('/api/chat', (req, res) => {
    const { sender, text } = req.body;
    chatMessages.push({ sender, text, time: getVNTime() });
    if(chatMessages.length > 50) chatMessages.shift();
    res.json({ success: true });
});

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
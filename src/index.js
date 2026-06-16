const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// TÀI KHOẢN CHO BẾP & SHIPPER
const BARISTA_ACCOUNTS = [
    { username: 'bep01', password: '123', name: 'Quầy Pha Chế 1' }
];

const SHIPPER_ACCOUNTS = [
    { username: 'ship01', password: '123', name: 'Khang Miền Tây' },
    { username: 'ship02', password: '123', name: 'Anh An' },
    { username: 'ship03', password: '123', name: 'Anh Tuấn' }
];

let orders = [];
let shipperLocations = {}; 
let chatMessages = []; 
let orderIdCounter = 1;

function getVNTime() {
    return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
}

function getActiveShippers() {
    const now = Date.now();
    const activeList = [];
    for (let name in shipperLocations) {
        if (now - shipperLocations[name].timestamp < 120000) activeList.push(name);
    }
    return activeList;
}

// ĐĂNG NHẬP
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    let user;
    if (role === 'bep') {
        user = BARISTA_ACCOUNTS.find(u => u.username === username && u.password === password);
    } else {
        user = SHIPPER_ACCOUNTS.find(u => u.username === username && u.password === password);
    }
    
    if (user) res.json({ success: true, name: user.name });
    else res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu!' });
});

app.get('/api/orders', (req, res) => res.json(orders));

// TẠO ĐƠN MỚI
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime, phone } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung trống!' });

    let extractedPhone = phone || '';
    if (!extractedPhone) {
        const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
        const match = content.match(phoneRegex);
        if (match) extractedPhone = match[0];
    }

    if (!extractedPhone || !/^0\d{9}$/.test(extractedPhone)) {
        return res.status(400).json({ success: false, error: '🚨 LỖI: Số điện thoại không hợp lệ! Nhập đúng 10 số.' });
    }

    const isDuplicate = orders.some(o => o.content.trim() === content.trim() && o.phone === extractedPhone && o.status !== 'DONE');
    if (isDuplicate) return res.status(400).json({ success: false, error: `🚨 TRÙNG ĐƠN!` });

    const isSameCustomer = orders.some(o => o.phone === extractedPhone && o.status !== 'DONE');

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        phone: extractedPhone, 
        deliveryTime: deliveryTime || 'Giao ngay',
        status: 'PENDING', // PENDING -> PREPARED (Pha Xong) -> READY/SHIPPING (Gửi đi)
        shipperName: null,
        createdAt: getVNTime()
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder, isSameCustomer });
});

// BẾP BẤM PHA XONG (Chỉ chuyển sang trạng thái chờ gom gửi đi)
app.put('/api/orders/:id/prepare', (req, res) => {
    const orderId = parseInt(req.params.id);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'PENDING') order.status = 'PREPARED';
    res.json({ success: true });
});

// BẾP BẤM GỬI CÁC ĐƠN ĐÃ PHA CHO SHIPPER
app.post('/api/orders/send-batch', (req, res) => {
    const activeShippers = getActiveShippers();
    let count = 0;
    
    orders.forEach(o => {
        if (o.status === 'PREPARED') {
            if (activeShippers.length === 1) {
                o.status = 'SHIPPING';
                o.shipperName = activeShippers[0];
            } else {
                o.status = 'READY';
            }
            count++;
        }
    });
    res.json({ success: true, count, autoAssigned: activeShippers.length === 1 });
});

// SHIPPER NHẬN ĐƠN VÀ ĐỔI TRẠNG THÁI
app.put('/api/orders/:id/assign', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { shipperName } = req.body;
    const order = orders.find(o => o.id === orderId);
    
    if (order && order.status === 'READY') {
        order.status = 'SHIPPING';
        order.shipperName = shipperName || 'Shipper Ẩn Danh';
        res.json({ success: true, order });
    } else {
        res.status(400).json({ error: 'Đơn này không thể nhận!' });
    }
});

app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const order = orders.find(o => o.id === orderId);
    if (order) order.status = req.body.status;
    res.json({ success: true });
});

app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === orderId);
    if (index !== -1) orders.splice(index, 1);
    res.json({ success: true });
});

// LOCATION & CHAT
app.post('/api/shipper/location', (req, res) => {
    const { shipperName, lat, lng } = req.body;
    if (shipperName) {
        shipperLocations[shipperName] = { lat, lng, updatedAt: getVNTime(), timestamp: Date.now() };
    }
    res.json({ success: true });
});

app.get('/api/shipper/locations', (req, res) => res.json(shipperLocations));

app.get('/api/chat', (req, res) => res.json(chatMessages));
app.post('/api/chat', (req, res) => {
    const { sender, text } = req.body;
    chatMessages.push({ sender, text, time: getVNTime() });
    if(chatMessages.length > 50) chatMessages.shift();
    res.json({ success: true });
});

// XUẤT EXCEL
app.get('/api/export-excel', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Khang Mien Tay POS');
        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Nội Dung', key: 'content', width: 40 },
            { header: 'Số Điện Thoại', key: 'phone', width: 15 },
            { header: 'Shipper Giao', key: 'shipperName', width: 15 },
            { header: 'Trạng Thái', key: 'status', width: 15 },
            { header: 'Thời Gian Tạo', key: 'createdAt', width: 15 }
        ];
        orders.forEach(o => worksheet.addRow(o));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Bao_Cao_Ca_Lam_${new Date().getTime()}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Hệ thống Khang Miền Tây chạy tại cổng: ${PORT}`));
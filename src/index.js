const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 🔴 CHUỖI KẾT NỐI MONGODB ĐÃ ĐƯỢC RÁP HOÀN CHỈNH:
const MONGODB_URI = "mongodb+srv://khangmientay2024_db_user:Khang123456@cluster0.p01gzcb.mongodb.net/KhangMienTay?appName=Cluster0";

// KẾT NỐI DATABASE
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ Đã kết nối két sắt MongoDB thành công!"))
    .catch(err => console.log("🚨 Lỗi kết nối DB:", err));

// TẠO CẤU TRÚC KÉT SẮT LƯU ĐƠN HÀNG
const orderSchema = new mongoose.Schema({
    id: Number,
    content: String,
    note: String,
    phone: String,
    deliveryTime: String,
    status: String,
    shipperName: String,
    createdAt: String
});
const Order = mongoose.model('Order', orderSchema);

const BARISTA_ACCOUNTS = [{ username: 'bep01', password: '123', name: 'Quầy Pha Chế 1' }];
const SHIPPER_ACCOUNTS = [
    { username: 'ship01', password: '123', name: 'Khang Miền Tây' },
    { username: 'ship02', password: '123', name: 'Anh An' },
    { username: 'ship03', password: '123', name: 'Anh Tuấn' }
];

let shipperLocations = {}; 
let chatMessages = []; 

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

// LOGIN
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    let user = role === 'bep' ? BARISTA_ACCOUNTS.find(u => u.username === username && u.password === password) 
                              : SHIPPER_ACCOUNTS.find(u => u.username === username && u.password === password);
    if (user) res.json({ success: true, name: user.name });
    else res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu!' });
});

// LẤY ĐƠN HÀNG TỪ DATABASE
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ id: 1 });
        res.json(orders);
    } catch(e) { res.status(500).json({error: 'Lỗi máy chủ'}); }
});

// TẠO ĐƠN MỚI LƯU VÀO DATABASE
app.post('/api/orders', async (req, res) => {
    try {
        const { content, note, deliveryTime, phone } = req.body;
        if (!content) return res.status(400).json({ error: 'Nội dung trống!' });

        let extractedPhone = phone || '';
        if (!extractedPhone) {
            const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
            const match = content.match(phoneRegex);
            if (match) extractedPhone = match[0];
        }

        if (!extractedPhone || !/^0\d{9}$/.test(extractedPhone)) {
            return res.status(400).json({ success: false, error: '🚨 LỖI: Số điện thoại không hợp lệ!' });
        }

        const isDuplicate = await Order.findOne({ content: content.trim(), phone: extractedPhone, status: { $ne: 'DONE' } });
        if (isDuplicate) return res.status(400).json({ success: false, error: `🚨 TRÙNG ĐƠN!` });

        const isSameCustomer = await Order.findOne({ phone: extractedPhone, status: { $ne: 'DONE' } });

        const newId = parseInt(Date.now().toString().slice(-6)); // Tạo mã ID 6 số
        const newOrder = new Order({
            id: newId,
            content,
            note: note || '',
            phone: extractedPhone, 
            deliveryTime: deliveryTime || 'Giao ngay',
            status: 'PENDING',
            shipperName: null,
            createdAt: getVNTime()
        });

        await newOrder.save();
        res.status(201).json({ success: true, order: newOrder, isSameCustomer: !!isSameCustomer });
    } catch(e) { res.status(500).json({ error: 'Lỗi server' }); }
});

// CÁC HÀM CẬP NHẬT TRẠNG THÁI VÀO DATABASE
app.put('/api/orders/:id/prepare', async (req, res) => {
    await Order.findOneAndUpdate({ id: parseInt(req.params.id), status: 'PENDING' }, { status: 'PREPARED' });
    res.json({ success: true });
});

app.post('/api/orders/send-batch', async (req, res) => {
    const activeShippers = getActiveShippers();
    let targetStatus = activeShippers.length === 1 ? 'SHIPPING' : 'READY';
    let targetShipper = activeShippers.length === 1 ? activeShippers[0] : null;

    const result = await Order.updateMany(
        { status: 'PREPARED' }, 
        { status: targetStatus, shipperName: targetShipper }
    );
    res.json({ success: true, count: result.modifiedCount, autoAssigned: activeShippers.length === 1 });
});

app.put('/api/orders/:id/assign', async (req, res) => {
    const order = await Order.findOneAndUpdate(
        { id: parseInt(req.params.id), status: 'READY' }, 
        { status: 'SHIPPING', shipperName: req.body.shipperName || 'Shipper Ẩn Danh' },
        { new: true }
    );
    if(order) res.json({ success: true, order });
    else res.status(400).json({ error: 'Đơn này không thể nhận!' });
});

app.put('/api/orders/:id/status', async (req, res) => {
    await Order.findOneAndUpdate({ id: parseInt(req.params.id) }, { status: req.body.status });
    res.json({ success: true });
});

app.delete('/api/orders/:id', async (req, res) => {
    await Order.deleteOne({ id: parseInt(req.params.id) });
    res.json({ success: true });
});

// VỊ TRÍ SHIPPER & CHAT (Lưu tạm trên RAM cho nhẹ)
app.post('/api/shipper/location', (req, res) => {
    const { shipperName, lat, lng } = req.body;
    if (shipperName) shipperLocations[shipperName] = { lat, lng, updatedAt: getVNTime(), timestamp: Date.now() };
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

// XUẤT EXCEL TỪ DATABASE
app.get('/api/export-excel', async (req, res) => {
    try {
        const orders = await Order.find();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bao Cao');
        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Nội Dung', key: 'content', width: 40 },
            { header: 'Số Điện Thoại', key: 'phone', width: 15 },
            { header: 'Shipper Giao', key: 'shipperName', width: 15 },
            { header: 'Trạng Thái', key: 'status', width: 15 },
            { header: 'Thời Gian', key: 'createdAt', width: 15 }
        ];
        orders.forEach(o => worksheet.addRow(o));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Bao_Cao_${new Date().getTime()}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Hệ thống Khang Miền Tây chạy tại cổng: ${PORT}`));
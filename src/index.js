const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let orders = [];
let batches = [];
let shipperLocations = {}; // Lưu vị trí GPS của các shipper: { 'Tên Shipper': { lat, lng, updatedAt } }
let orderIdCounter = 1;
let batchIdCounter = 1;

app.get('/api/orders', (req, res) => res.json(orders));
app.get('/api/batches', (req, res) => res.json(batches));

// 1. TẠO ĐƠN HÀNG MỚI (CÓ CHECK TRÙNG LẶP ĐƠN)
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime, phone } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung trống trơn ông ơi!' });

    // Trích xuất SĐT
    let extractedPhone = phone || '';
    if (!extractedPhone) {
        const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
        const match = content.match(phoneRegex);
        if (match) extractedPhone = match[0];
    }

    // THUẬT TOÁN CHECK TRÙNG: Trùng nguyên văn HOẶC trùng SĐT của đơn chưa hoàn thành
    const isDuplicate = orders.some(o => {
        const matchContent = o.content.trim().toLowerCase() === content.trim().toLowerCase();
        const matchPhone = extractedPhone && o.phone === extractedPhone && o.status !== 'DONE';
        return matchContent || matchPhone;
    });

    if (isDuplicate) {
        return res.status(400).json({ 
            success: false, 
            isDuplicate: true, 
            error: `🚨 ĐƠN BỊ TRÙNG! Đơn này đã được nhập vào hệ thống trước đó rồi!` 
        });
    }

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        phone: extractedPhone, 
        deliveryTime: deliveryTime || 'Giao ngay',
        status: 'PENDING',
        batchId: null,
        createdAt: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder });
});

// 2. CẬP NHẬT TỌA ĐỘ GPS TỪ ĐIỆN THOẠI SHIPPER
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

// 3. LẤY TỌA ĐỘ TẤT CẢ SHIPPER ĐỂ BẾP XEM
app.get('/api/shipper/locations', (req, res) => {
    res.json(shipperLocations);
});

// SỬA ĐƠN
app.put('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { content } = req.body;
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không thấy đơn' });
    order.content = content;
    res.json({ success: true });
});

// HỦY ĐƠN
app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === orderId);
    if (index !== -1) orders.splice(index, 1);
    res.json({ success: true });
});

// SHIPPER TICK ĐƠN LẺ GIAO XONG
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn' });

    order.status = status;
    
    if (order.batchId && status === 'DONE') {
        const batch = batches.find(b => b.id === order.batchId);
        if (batch) {
            const allOrdersInBatch = orders.filter(o => batch.orderIds.includes(o.id));
            const isAllDone = allOrdersInBatch.every(o => o.status === 'DONE');
            if (isAllDone) batch.status = 'DONE';
        }
    }
    res.json({ success: true });
});

// GOM ĐỢT GIAO
app.post('/api/batches', (req, res) => {
    const { orderIds, shipperName } = req.body;
    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: 'Chưa chọn đơn!' });

    const newBatch = {
        id: batchIdCounter++,
        shipperName: shipperName || 'Tài xế vãng lai',
        orderIds: orderIds.map(id => parseInt(id)),
        status: 'READY',
        createdAt: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };

    orderIds.forEach(id => {
        const order = orders.find(o => o.id === parseInt(id));
        if (order) {
            order.status = 'BATCHED';
            order.batchId = newBatch.id;
        }
    });

    batches.push(newBatch);
    res.status(201).json({ success: true, batch: newBatch });
});

app.put('/api/batches/:id/status', (req, res) => {
    const batchId = parseInt(req.params.id);
    const { status } = req.body;
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return res.status(404).json({ error: 'Không thấy đợt' });
    batch.status = status;
    if (status === 'DONE') {
        batch.orderIds.forEach(id => {
            const order = orders.find(o => o.id === id);
            if (order) order.status = 'DONE';
        });
    }
    res.json({ success: true });
});

// XUẤT FILE EXCEL
app.get('/api/export-excel', async (req, res) => {
    try {
        if (orders.length === 0) return res.status(400).send('Không có dữ liệu');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Khang Mien Tay POS');
        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Chi Tiết', key: 'content', width: 35 },
            { header: 'Số Điện Thoại', key: 'phone', width: 15 },
            { header: 'Trạng Thái', key: 'status', width: 15 },
            { header: 'Thuộc Đợt Chạy', key: 'batchId', width: 15 }
        ];
        orders.forEach(order => worksheet.addRow(order));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=DoanhThu_' + Date.now() + '.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Hệ thống Khang Miền Tây chạy tại cổng: ${PORT}`));
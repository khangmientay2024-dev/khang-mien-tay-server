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
let orderIdCounter = 1;
let batchIdCounter = 1;

// 1. API LẤY DANH SÁCH ĐƠN HÀNG LẺ
app.get('/api/orders', (req, res) => {
    res.json(orders);
});

// 2. API LẤY DANH SÁCH CÁC ĐỢT CHẠY (CÁI NÀY NÈ! NÃY BỊ THIẾU LÀM SHIPPER LỖI 404)
app.get('/api/batches', (req, res) => {
    res.json(batches);
});

// 3. TẠO ĐƠN HÀNG MỚI (Hỗ trợ parse chuỗi thô tự do)
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime, phone } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung không được trống' });

    // Thuật toán tự tách Số điện thoại nếu có trong chuỗi thô để shipper bấm gọi cho tiện
    let extractedPhone = phone || '';
    if (!extractedPhone) {
        const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
        const match = content.match(phoneRegex);
        if (match) extractedPhone = match[0];
    }

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        phone: extractedPhone, 
        deliveryTime: deliveryTime || 'Giao ngay',
        status: 'PENDING',
        batchId: null,
        createdAt: new Date().toLocaleString('vi-VN')
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder });
});

// 4. SỬA THÔNG TIN ĐƠN HÀNG
app.put('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { content, note, deliveryTime, phone } = req.body;
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    if (order.status !== 'PENDING') {
        return res.status(400).json({ error: 'Đơn đã xếp chuyến, không thể sửa!' });
    }

    order.content = content || order.content;
    order.note = note || order.note;
    order.phone = phone !== undefined ? phone : order.phone;
    order.deliveryTime = deliveryTime || order.deliveryTime;

    res.json({ success: true, order });
});

// 5. XÓA/HỦY ĐƠN HÀNG
app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (orders[orderIndex].status !== 'PENDING') {
        return res.status(400).json({ error: 'Đơn đã đi giao, không thể xóa!' });
    }

    orders.splice(orderIndex, 1);
    res.json({ success: true });
});

// 6. SHIPPER CẬP NHẬT TRẠNG THÁI ĐƠN LẺ (Bấm Giao Xong từng đơn lẻ trong chuyến)
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    order.status = status;
    
    // Tự động kiểm tra: Nếu tất cả đơn con thuộc đợt này đã "DONE", thì tự động hóa "DONE" nguyên đợt chạy luôn
    if (order.batchId && status === 'DONE') {
        const batch = batches.find(b => b.id === order.batchId);
        if (batch) {
            const allOrdersInBatch = orders.filter(o => batch.orderIds.includes(o.id));
            const isAllDone = allOrdersInBatch.every(o => o.status === 'DONE');
            if (isAllDone) {
                batch.status = 'DONE';
            }
        }
    }

    res.json({ success: true, order });
});

// 7. QUẦY BẾP GOM ĐỢT GIAO HÀNG
app.post('/api/batches', (req, res) => {
    const { orderIds, shipperName } = req.body;
    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: 'Chưa chọn đơn!' });

    const newBatch = {
        id: batchIdCounter++,
        shipperName: shipperName || 'Chờ shipper nhận',
        orderIds: orderIds.map(id => parseInt(id)),
        status: 'READY',
        createdAt: new Date().toLocaleString('vi-VN')
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

// 8. CẬP NHẬT TRẠNG THÁI TOÀN BỘ ĐỢT GIAO
app.put('/api/batches/:id/status', (req, res) => {
    const batchId = parseInt(req.params.id);
    const { status } = req.body;
    
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return res.status(404).json({ error: 'Không tìm thấy đợt' });

    batch.status = status;

    if (status === 'DONE') {
        batch.orderIds.forEach(id => {
            const order = orders.find(o => o.id === id);
            if (order) order.status = 'DONE';
        });
    }
    res.json({ success: true });
});

// 9. XUẤT FILE EXCEL BÁO CÁO DOANH THU
app.post('/api/export-excel', async (req, res) => {
    try {
        if (orders.length === 0) return res.status(400).json({ error: 'Không có dữ liệu' });
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Khang Mien Tay POS');

        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Chi Tiết Món', key: 'content', width: 35 },
            { header: 'Địa Chỉ Giao', key: 'note', width: 25 },
            { header: 'Số Điện Thoại', key: 'phone', width: 15 },
            { header: 'Hẹn Giờ', key: 'deliveryTime', width: 15 },
            { header: 'Trạng Thái', key: 'status', width: 15 },
            { header: 'Thuộc Đợt', key: 'batchId', width: 10 }
        ];

        orders.forEach(order => worksheet.addRow(order));
        const filePath = path.join(__dirname, 'Bao_Cao_Don_Hang.xlsx');
        await workbook.xlsx.writeFile(filePath);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Hệ thống Khang Miền Tây chạy mượt tại cổng: ${PORT}`));
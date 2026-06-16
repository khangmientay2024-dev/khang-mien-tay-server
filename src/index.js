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

// Lấy danh sách đơn hàng
app.get('/api/orders', (req, res) => {
    res.json(orders);
});

// Tạo đơn hàng mới (Hỗ trợ thêm trường phone)
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime, phone } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung không được trống' });

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        phone: phone || '', // Lưu số điện thoại khách
        deliveryTime: deliveryTime || 'Giao ngay',
        status: 'PENDING',
        batchId: null,
        createdAt: new Date().toLocaleString('vi-VN')
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder });
});

// Sửa thông tin đơn hàng
app.put('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { content, note, deliveryTime, phone } = req.body;
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    if (order.status !== 'PENDING') {
        return res.status(400).json({ error: 'Đơn đã xếp đợt giao, không thể sửa!' });
    }

    order.content = content || order.content;
    order.note = note || order.note;
    order.phone = phone !== undefined ? phone : order.phone;
    order.deliveryTime = deliveryTime || order.deliveryTime;

    res.json({ success: true, order });
});

// Xóa đơn hàng
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

// Cập nhật trạng thái đơn hàng lẻ (Dành cho Shipper tick giao xong từng đơn) - API BỔ SUNG
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    order.status = status;
    
    // Kiểm tra nếu tất cả đơn trong đợt đã DONE thì tự động DONE luôn đợt đó
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

// Gom đợt giao hàng
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

// Cập nhật trạng thái đợt giao
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

// Xuất file Excel báo cáo
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
app.listen(PORT, () => console.log(`Server chạy tại cổng: ${PORT}`));
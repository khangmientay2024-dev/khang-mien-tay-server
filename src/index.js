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

// ================= API QUẢN LÝ ĐƠN HÀNG =================

// Lấy danh sách đơn hàng
app.get('/api/orders', (req, res) => {
    res.json(orders);
});

// Tạo đơn hàng mới (Có thêm tính năng Hẹn giờ)
app.post('/api/orders', (req, res) => {
    const { content, note, deliveryTime } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung không được trống' });

    const newOrder = {
        id: orderIdCounter++,
        content,
        note: note || '',
        deliveryTime: deliveryTime || 'Giao ngay', // Mặc định là giao ngay nếu bỏ trống
        status: 'PENDING', // PENDING (Chờ làm) -> BATCHED (Đã xếp đợt) -> DONE (Hoàn thành)
        batchId: null,
        createdAt: new Date().toLocaleString('vi-VN')
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, order: newOrder });
});

// CHỨC NĂNG MỚI: Sửa thông tin đơn hàng
app.put('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { content, note, deliveryTime } = req.body;
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    if (order.status !== 'PENDING') {
        return res.status(400).json({ error: 'Đơn đã xếp đợt giao, không thể sửa!' });
    }

    order.content = content || order.content;
    order.note = note || order.note;
    order.deliveryTime = deliveryTime || order.deliveryTime;

    console.log(`[SỬA ĐƠN] Đơn #${orderId} đã được cập nhật`);
    res.json({ success: true, order });
});

// CHỨC NĂNG MỚI: Xóa/Hủy đơn hàng
app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (orders[orderIndex].status !== 'PENDING') {
        return res.status(400).json({ error: 'Đơn đã đi giao, không thể xóa!' });
    }

    orders.splice(orderIndex, 1);
    console.log(`[ỦY ĐƠN] Đã xóa đơn #${orderId}`);
    res.json({ success: true, message: 'Đã hủy đơn thành công' });
});


// ================= API QUẢN LÝ ĐỢT GIAO HÀNG (BATCHES) =================

// Lấy danh sách các đợt giao
app.get('/api/batches', (req, res) => {
    res.json(batches);
});

// Pha chế chủ động gom đơn thành Đợt Giao cho Shipper
app.post('/api/batches', (req, res) => {
    const { orderIds, shipperName } = req.body;
    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: 'Chưa chọn đơn để gom!' });

    const newBatch = {
        id: batchIdCounter++,
        shipperName: shipperName || 'Chờ shipper nhận',
        orderIds: orderIds.map(id => parseInt(id)),
        status: 'READY', // READY (Chờ ship) -> DELIVERING (Đang giao) -> DONE (Hoàn thành đợt)
        createdAt: new Date().toLocaleString('vi-VN')
    };

    // Khóa các đơn hàng lại, chuyển trạng thái sang BATCHED
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

// Thay đổi trạng thái đợt giao (Dùng cho Shipper bấm Nhận đợt / Hoàn thành đợt)
app.put('/api/batches/:id/status', (req, res) => {
    const batchId = parseInt(req.params.id);
    const { status } = req.body; // 'DELIVERING' hoặc 'DONE'
    
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return res.status(404).json({ error: 'Không tìm thấy đợt giao' });

    batch.status = status;

    // Nếu đợt giao hoàn thành (DONE), đồng bộ hoàn thành tất cả đơn con bên trong
    if (status === 'DONE') {
        batch.orderIds.forEach(id => {
            const order = orders.find(o => o.id === id);
            if (order) order.status = 'DONE';
        });
    }

    res.json({ success: true, batch });
});


// ================= API XUẤT EXCEL =================
app.post('/api/export-excel', async (req, res) => {
    try {
        if (orders.length === 0) return res.status(400).json({ error: 'Không có dữ liệu' });
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Khang Mien Tay POS');

        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Chi Tiết Món', key: 'content', width: 35 },
            { header: 'Ghi Chú/Địa Chỉ', key: 'note', width: 25 },
            { header: 'Hẹn Giờ', key: 'deliveryTime', width: 15 },
            { header: 'Trạng Thái', key: 'status', width: 15 },
            { header: 'Thuộc Đợt', key: 'batchId', width: 10 },
            { header: 'Thời Gian', key: 'createdAt', width: 25 }
        ];

        orders.forEach(order => worksheet.addRow(order));
        const filePath = path.join(__dirname, 'Bao_Cao_Don_Hang.xlsx');
        await workbook.xlsx.writeFile(filePath);
        res.json({ success: true, message: 'Đã xuất file Excel!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server Khang Miền Tây live tại cổng: ${PORT}`));
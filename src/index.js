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

app.get('/api/orders', (req, res) => {
    res.json(orders);
});

// Tạo đơn hàng mới từ 1 Ô DUY NHẤT
app.post('/api/orders', (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Nội dung không được trống' });

    // Tự động quét bốc Số điện thoại ở Backend bằng Regex
    const phoneRegex = /(0[3|5|7|8|9]\d{8})|(\d{9,11})/;
    const matchPhone = content.match(phoneRegex);
    const phone = matchPhone ? matchPhone[0] : ''; // Nếu không có SĐT thì để trống

    const newOrder = {
        id: orderIdCounter++,
        content: content.trim(), // Lưu toàn bộ chuỗi gộp của khách
        phone: phone,            // Bốc riêng để làm link kích hoạt nút gọi
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
    const { content } = req.body;
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    if (order.status !== 'PENDING') {
        return res.status(400).json({ error: 'Đơn đã xếp đợt giao, không thể sửa!' });
    }

    if (content) {
        order.content = content.trim();
        const phoneRegex = /(0[3|5|7|8|9]\d{8})|(\d{9,11})/;
        const matchPhone = order.content.match(phoneRegex);
        order.phone = matchPhone ? matchPhone[0] : '';
    }
    res.json({ success: true, order });
});

// CẬP NHẬT TRẠNG THÁI ĐƠN LẺ (Nút tick giao thành công từng đơn)
app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    order.status = status; // Chuyển thành 'DONE'

    // KIỂM TRA TỰ ĐỘNG: Nếu tất cả đơn lẻ trong Đợt đó đã DONE hết ➔ Tự động DONE luôn cả Đợt hàng
    if (order.batchId) {
        const batch = batches.find(b => b.id === order.batchId);
        if (batch) {
            const siblingOrders = orders.filter(o => o.batchId === batch.id);
            const isAllOrdersDone = siblingOrders.every(o => o.status === 'DONE');
            if (isAllOrdersDone) {
                batch.status = 'DONE';
            }
        }
    }
    res.json({ success: true, order });
});

// Xóa đơn hàng
app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (orders[orderIndex].status !== 'PENDING') return res.status(400).json({ error: 'Đơn đang đi giao!' });

    orders.splice(orderIndex, 1);
    res.json({ success: true });
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

// Cập nhật trạng thái đợt giao (Dùng khi shipper bấm nhận chuyến)
app.put('/api/batches/:id/status', (req, res) => {
    const batchId = parseInt(req.params.id);
    const { status } = req.body;
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return res.status(404).json({ error: 'Không tìm thấy đợt' });

    batch.status = status;
    res.json({ success: true });
});

// Xuất file Excel báo cáo doanh thu công nợ
app.post('/api/export-excel', async (req, res) => {
    try {
        if (orders.length === 0) return res.status(400).json({ error: 'Không có dữ liệu' });
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Khang Mien Tay POS');

        worksheet.columns = [
            { header: 'Mã Đơn', key: 'id', width: 10 },
            { header: 'Toàn Bộ Thông Tin Đơn', key: 'content', width: 60 },
            { header: 'Số Điện Thoại Trích Xuất', key: 'phone', width: 20 },
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
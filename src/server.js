const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// KẾT NỐI DATABASE MONGOOSE
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://YOUR_MONGO_URL_HERE';
mongoose.connect(MONGO_URI)
  .then(() => console.log('=== Đã kết nối MongoDB Khang Miền Tây thành công! ==='))
  .catch(err => console.error('Lỗi kết nối database:', err));

// SCHEMA ĐƠN HÀNG
const OrderSchema = new mongoose.Schema({
  content: { type: String, required: true },
  phone: { type: String, default: '' },
  building: { type: String, default: 'Ngoài KTX' },
  priorityScore: { type: Number, default: 999 },
  status: { type: String, enum: ['Đang pha chế', 'Chờ giao', 'Đang giao', 'Đã giao'], default: 'Đang pha chế' },
  shipper: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date }
});
const Order = mongoose.model('Order', OrderSchema);

// SCHEMA QUẢN LÝ TRẠNG THÁI ONLINE CỦA SHIPPER
const ShipperStatusSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  isOnline: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now }
});
const ShipperStatus = mongoose.model('ShipperStatus', ShipperStatusSchema);

// THUẬT TOÁN "MẮT THẦN" TỰ ĐỘNG PHÂN TÍCH VÀ XẾP LỘ TRÌNH KTX
function parseLocationAndPriority(content) {
  if (!content) return { building: 'Ngoài KTX', score: 999 };
  let text = content.toLowerCase();

  // 1. Dọn dẹp văn bản và dịch tiếng lóng
  text = text.replace(/xê/g, 'c').replace(/bê/g, 'b');
  text = text.replace(/(c|e|d|b|ba)-(\d)/g, '$1$2');

  // 2. Né bẫy chữ "Em" (Ví dụ: "cho e 1 ly cfs" -> không nhận nhầm thành tòa E1)
  const trapPattern = /\be\s+(\d+)\s*(ly|cfs|phần|bịch|cốc|chai|bạc xỉu|đen|sữa|trà|đá)/g;
  text = text.replace(trapPattern, '');

  // 3. Định vị tòa nhà và gán điểm ưu tiên lộ trình (C -> E -> D -> B -> BA -> Ngoài)
  // Quét tòa BA trước vì chữ "ba" dễ bị nhầm nếu quét chữ "b" trước
  const baMatch = text.match(/\bba[1-5]\b/);
  if (baMatch) {
    const num = parseInt(baMatch[0].replace('ba', ''));
    return { building: baMatch[0].toUpperCase(), score: 21 + (5 - num) }; // BA5 -> BA1 (Đảo ngược)
  }
  const cMatch = text.match(/\bc[1-6]\b/);
  if (cMatch) {
    const num = parseInt(cMatch[0].replace('c', ''));
    return { building: cMatch[0].toUpperCase(), score: num }; // C1 -> C6
  }
  const eMatch = text.match(/\be[1-4]\b/);
  if (eMatch) {
    const num = parseInt(eMatch[0].replace('e', ''));
    return { building: eMatch[0].toUpperCase(), score: 6 + num }; // E1 -> E4
  }
  const dMatch = text.match(/\bd[2-6]\b/);
  if (dMatch) {
    const num = parseInt(dMatch[0].replace('d', ''));
    return { building: dMatch[0].toUpperCase(), score: 11 + (6 - num) }; // D6 -> D2 (Đảo ngược)
  }
  const bMatch = text.match(/\bb[1-5]\b/);
  if (bMatch) {
    const num = parseInt(bMatch[0].replace('b', ''));
    return { building: bMatch[0].toUpperCase(), score: 16 + (5 - num) }; // B5 -> B1 (Đảo ngược)
  }

  return { building: 'Ngoài KTX', score: 999 };
}

// ROUTE ĐĂNG NHẬP KHÔNG CẦN CƠ SỞ DỮ LIỆU PHỨC TẠP
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const isBep = username.startsWith('bep') && password === 'khangmt2026';
  const isShip = username.startsWith('ship') && password === 'khangmt2026';

  if (isBep || isShip) {
    if (isShip) {
      await ShipperStatus.findOneAndUpdate(
        { username },
        { username, isOnline: true, lastActive: new Date() },
        { upsert: true }
      );
    }
    return res.json({ success: true, role: isBep ? 'bep' : 'ship', username });
  }
  return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu ný ơi!' });
});

// ROUTE ĐĂNG XUẤT / CHỐT CA CHO SHIPPER
app.post('/api/logout', async (req, res) => {
  const { username } = req.body;
  if (username) {
    await ShipperStatus.findOneAndUpdate({ username }, { isOnline: false });
  }
  res.json({ success: true });
});

// BẾP TẠO ĐƠN HÀNG MỚI (TÍCH HỢP ĐIỀU PHỐI TỰ ĐỘNG 1-1)
app.post('/api/orders', async (req, res) => {
  try {
    const { content, phone } = req.body;
    const { building, score } = parseLocationAndPriority(content);

    // Kiểm tra xem hiện tại có chính xác 1 shipper đang online không
    const onlineShippers = await ShipperStatus.find({ isOnline: true });
    
    let status = 'Đang pha chế';
    let assignedShipper = '';

    if (onlineShippers.length === 1) {
      status = 'Đang giao'; // Đẩy thẳng đi giao, bỏ qua bước chờ
      assignedShipper = onlineShippers[0].username;
    }

    const newOrder = new Order({
      content,
      phone,
      building,
      priorityScore: score,
      status,
      shipper: assignedShipper
    });

    await newOrder.save();
    res.json({ success: true, order: newOrder });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// LẤY DANH SÁCH ĐƠN HÀNG (SẮP XẾP THEO LỘ TRÌNH THÔNG MINH)
app.get('/api/orders', async (req, res) => {
  try {
    // Sắp xếp theo lộ trình ưu tiên KTX tăng dần, đơn mới nhất lên trước
    const orders = await Order.find().sort({ priorityScore: 1, createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// SHIPPER NHẬN ĐƠN THỦ CÔNG (NẾU QUÁN CÓ TỪ 2 SHIPPER TRỞ LÊN ONLINE)
app.put('/api/orders/:id/accept', async (req, res) => {
  try {
    const { shipper } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.findById ? req.id : req.params.id,
      { status: 'Đang giao', shipper },
      { new: true }
    );
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// CẬP NHẬT TRẠNG THÁI ĐƠN HÀNG (HOÀN THÀNH HOẶC CHUYỂN TRẠNG THÁI)
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updateData = { status };
    if (status === 'Đã giao') {
      updateData.deliveredAt = new Date();
    }
    const order = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ROUTE LẤY DỮ LIỆU ĐỂ XUẤT FILE EXCEL THEO ĐÚNG PHÂN QUYỀN BẢO MẬT
app.get('/api/orders/export', async (req, res) => {
  try {
    const { role, username } = req.query;
    let query = {};
    
    if (role === 'ship') {
      // Bảo mật doanh thu: Shipper chỉ được thấy và xuất đơn Đã Giao của chính mình
      query = { shipper: username, status: 'Đã giao' };
    }

    const data = await Order.find(query).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// KHỞI CHẠY SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`=== Hệ thống Khang Miền Tây đang chạy trên cổng ${PORT} ===`));
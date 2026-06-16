const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// Cấu hình để server đọc được dữ liệu JSON từ Zalo gửi về
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 1. Tuyến đường kiểm tra xem server có hoạt động hay không (Xem trên trình duyệt)
app.get('/', (req, res) => {
    res.send('Server Khang Miền Tây đang hoạt động trực tuyến ngon lành!');
});

// 2. Tuyến đường tiếp nhận Webhook từ Zalo (Nơi Zalo gửi tin nhắn về)
app.post('/zalo-webhook', (req, res) => {
    try {
        const data = req.body;
        
        console.log('--- NHẬN DỮ LIỆU TỪ ZALO WEBHOOK ---');
        console.log(JSON.stringify(data, null, 2));
        console.log('------------------------------------');

        // Phản hồi cho Zalo biết server của ông đã nhận được dữ liệu thành công
        return res.status(200).json({
            status: 'success',
            message: 'Đã nhận dữ liệu từ Zalo thành công!'
        });
    } catch (error) {
        console.error('Lỗi xử lý webhook:', error);
        return res.status(500).send('Internal Server Error');
    }
});

// Cấu hình Cổng (Port): Render sẽ tự cấp cổng qua process.env.PORT, dưới máy ông sẽ chạy cổng 5000
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`============= KHANG MIỀN TÂY =============`);
    console.log(`Server của ông đang chạy tại cổng: ${PORT}`);
    console.log(`==========================================`);
});
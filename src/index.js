const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs'); // Thêm thư viện kiểm tra file hệ thống

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 1. Tuyến đường xác thực Domain thông minh (Quét mọi ngóc ngách)
app.get('/zalo_verifierFVE5AxZG7Gv7nQaPZiaED5M-WX-vo5T8DJSs.html', (req, res) => {
    const fileName = 'zalo_verifierFVE5AxZG7Gv7nQaPZiaED5M-WX-vo5T8DJSs.html';
    
    // Đường dẫn 1: Nằm trong thư mục src
    const pathInSrc = path.join(__dirname, fileName);
    // Đường dẫn 2: Nằm ở thư mục gốc dự án
    const pathInRoot = path.join(process.cwd(), fileName);

    if (fs.existsSync(pathInSrc)) {
        return res.sendFile(pathInSrc);
    } else if (fs.existsSync(pathInRoot)) {
        return res.sendFile(pathInRoot);
    } else {
        // Nếu không tìm thấy, tự động trả về đoạn mã text mà Zalo cần luôn!
        // Mã xác thực chính là phần chuỗi sau chữ zalo_verifier
        return res.send('FVE5AxZG7Gv7nQaPZiaED5M-WX-vo5T8DJSs');
    }
});

// 2. Tuyến đường kiểm tra trạng thái hoạt động chính
app.get('/', (req, res) => {
    res.send('Server Khang Miền Tây đang hoạt động trực tuyến ngon lành!');
});

// 3. Tuyến đường tiếp nhận Webhook từ Zalo
app.post('/zalo-webhook', (req, res) => {
    try {
        const data = req.body;
        
        console.log('--- NHẬN DỮ LIỆU TỪ ZALO WEBHOOK ---');
        console.log(JSON.stringify(data, null, 2));
        console.log('------------------------------------');

        return res.status(200).json({
            status: 'success',
            message: 'Đã nhận dữ liệu từ Zalo thành công!'
        });
    } catch (error) {
        console.error('Lỗi xử lý webhook:', error);
        return res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`============= KHANG MIỀN TÂY =============`);
    console.log(`Server của ông đang chạy tại cổng: ${PORT}`);
    console.log(`==========================================`);
});
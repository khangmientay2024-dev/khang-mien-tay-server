const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let orders = [];
let batches = [];
let orderIdCounter = 1;
let batchIdCounter = 1;

app.get('/api/orders', (req, res) => res.json(orders));
app.get('/api/batches', (req, res) => res.json(batches));

app.post('/api/orders', (req, res) => {
    const { content } = req.body;
    const phoneRegex = /(0[3|5|7|8|9]\d{8})|(\d{9,11})/;
    const match = content.match(phoneRegex);
    orders.push({ id: orderIdCounter++, content, phone: match ? match[0] : '', status: 'PENDING', batchId: null });
    res.json({ success: true });
});

app.post('/api/batches', (req, res) => {
    const { orderIds, shipperName } = req.body;
    if (!orderIds || orderIds.length === 0) return res.status(400).json({ error: 'Chưa chọn đơn' });
    const batch = { id: batchIdCounter++, shipperName, orderIds: orderIds.map(Number), status: 'READY' };
    orderIds.forEach(id => {
        const o = orders.find(x => x.id == id);
        if (o) { o.status = 'BATCHED'; o.batchId = batch.id; }
    });
    batches.push(batch);
    res.json({ success: true, batch });
});

app.put('/api/orders/:id/status', (req, res) => {
    const o = orders.find(x => x.id == req.params.id);
    if (o) o.status = req.body.status;
    res.json({ success: true });
});

app.put('/api/batches/:id/status', (req, res) => {
    const b = batches.find(x => x.id == req.params.id);
    if (b) b.status = req.body.status;
    res.json({ success: true });
});

app.listen(5000, () => console.log('Server running on port 5000'));
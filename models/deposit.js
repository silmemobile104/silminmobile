// models/deposit.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DepositSchema = new Schema({
    companyId: { type: String, required: true },
    branch: { type: String, default: '' },

    // --- ฝั่งซ้าย: ข้อมูลมัดจำ ---
    depositDate: { type: Date, default: Date.now },
    customerName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    depositAmount: { type: Number, required: true },
    pickupDueDate: { type: Date },

    // --- ฝั่งขวา: รับเครื่องแล้ว ---
    billNo: { type: String, default: '' },
    imei: { type: String, default: '' },
    product: { type: String, default: '' },
    price: { type: Number, default: 0 },

    isSuccess: { type: Boolean, default: false },
    isCanceled: { type: Boolean, default: false },
    signName: { type: String, default: '' },

    // === [NEW] ส่วนเพิ่มสำหรับฝ่ายจัดซื้อ ===
    orderStatus: {
        type: String,
        enum: ['pending', 'ordered', 'arrived', 'canceled'],
        default: 'pending'
        // pending=รอดำเนินการ, ordered=สั่งของแล้ว, arrived=ของมาถึงแล้ว, canceled=ยกเลิก
    },
    orderNote: { type: String, default: '' }, // หมายเหตุจากจัดซื้อ เช่น เลขพัสดุ
    expectedArrivalDate: { type: Date }, // วันที่คาดว่าของจะมาถึง
    // ===================================

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Deposit', DepositSchema);
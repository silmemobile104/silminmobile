const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DeliveryTransferItemSchema = new Schema({
    productCode: { type: String, default: '', trim: true },
    productCodes: [{ type: String, trim: true }],
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    note: { type: String, default: '' }
}, { _id: false });

const DigitalSignatureSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: '' },
    department: { type: String, default: '' },
    branch: { type: String, default: '' },
    role: { type: String, default: '' },
    date: { type: Date, default: Date.now }
}, { _id: false });

const DeliveryTransferSchema = new Schema({
    companyId: { 
        type: String, 
        required: true,
        default: 'company_1_id'
    },
    // สาขาต้นทาง (ผู้จัดเตรียม/ส่งมอบ)
    sourceBranch: { 
        type: String, 
        required: true 
    },
    // สาขาปลายทาง (ผู้ขอ/รอรับ)
    destinationBranch: { 
        type: String, 
        required: true 
    },
    title: { 
        type: String, 
        required: true 
    },
    transferNumber: { 
        type: String 
    },
    items: [DeliveryTransferItemSchema],
    note: { 
        type: String, 
        default: '' 
    },
    status: {
        type: String,
        enum: ['pending', 'ready_to_ship', 'picked_up', 'in_transit', 'completed', 'canceled'],
        default: 'pending'
    },
    // รูปแบบการจัดส่ง: 'direct' (ส่งตรงระหว่างสาขา), 'logistics' (ส่งผ่านฝ่ายจัดส่ง)
    deliveryMethod: {
        type: String,
        enum: ['direct', 'logistics', null],
        default: null
    },
    // ร่องรอยการลงชื่อ (บันทึกรอยเซ็นและหลักฐานแยกอิสระ)
    signatures: {
        requesterSign: DigitalSignatureSchema,      // สาขาปลายทางขอ
        preparerSign: DigitalSignatureSchema,       // สาขาต้นทางเตรียม
        courierPickupSign: DigitalSignatureSchema,  // ฝ่ายจัดส่ง (ขั้นตอนที่ 1): รับเครื่องจากสาขาต้นทาง
        courierDeliverSign: DigitalSignatureSchema, // ฝ่ายจัดส่ง (ขั้นตอนที่ 2): ส่งเครื่องไปยังสาขาปลายทาง
        receiverSign: DigitalSignatureSchema        // สาขาปลายทางรับของเข้าสาขา
    },
    // หลักฐานการจัดส่ง
    deliveryProof: {
        trackingNumber: { type: String, default: '' },
        proofImageUrl: { type: String, default: '' },
        proofImages: [{
            url: { type: String },
            step: { type: String, default: '' },
            uploadedAt: { type: Date, default: Date.now },
            uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' }
        }],
        updatedAt: { type: Date },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
    },
    // ตรวจรับความสมบูรณ์ของสินค้าเข้าสาขาปลายทาง
    receivingCondition: {
        status: { 
            type: String, 
            enum: ['perfect', 'minor_defect', 'damaged', 'incomplete', 'other'],
            default: 'perfect' 
        },
        statusLabel: { type: String, default: 'สมบูรณ์ 100%' },
        checklists: [{ type: String }],
        itemConditions: [{
            productCode: { type: String, default: '' },
            productName: { type: String, default: '' },
            isComplete: { type: Boolean, default: true },
            note: { type: String, default: '' }
        }],
        receivedAt: { type: Date },
        receivedBy: { type: Schema.Types.ObjectId, ref: 'User' }
    },
    createdBy: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    }
}, { 
    timestamps: true,
    collection: 'delivery_transfers' // แยก Collection ใหม่เป็นอิสระ 100% ไม่ยุ่งกับ collection อื่น
});

// Auto-generate transferNumber before saving
DeliveryTransferSchema.pre('save', function(next) {
    if (!this.transferNumber) {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomHex = Math.floor(1000 + Math.random() * 9000);
        this.transferNumber = `TR-${dateStr}-${randomHex}`;
    }
    next();
});

module.exports = mongoose.model('DeliveryTransfer', DeliveryTransferSchema);

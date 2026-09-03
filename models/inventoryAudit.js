const mongoose = require('mongoose');

const InventoryAuditSchema = new mongoose.Schema({
    branch: {
        type: String,
        required: true
    },
    auditedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    auditDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['pending', 'completed'],
        default: 'pending'
    },
    items: [{
        productCode: { type: String, required: true },
        productName: { type: String, default: '' },
        expectedQty: { type: Number, default: 0 },
        scannedQty: { type: Number, default: 0 },
        inTransitQty: { type: Number, default: 0 },
        evidenceImage: { type: String, default: '' },
        remark: { type: String, default: '' },
        status: {
            type: String,
            enum: ['matched', 'missing', 'excess', 'in_transit'],
            default: 'missing'
        },
        itemType: {
            type: String,
            enum: ['phone', 'accessory'],
            default: 'phone'
        },
        unit: {
            type: String,
            default: ''
        }
    }],
    extraItems: [{
        productCode: { type: String, required: true },
        scannedQty: { type: Number, default: 0 }
    }],
    saveLogs: [{
        savedAt: { type: Date, default: Date.now },
        savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        totalScanned: { type: Number, default: 0 },
        matchedCount: { type: Number, default: 0 },
        missingCount: { type: Number, default: 0 },
        excessCount: { type: Number, default: 0 },
        inTransitCount: { type: Number, default: 0 },
        extraCount: { type: Number, default: 0 },
        note: { type: String, default: '' }
    }]
}, { timestamps: true });

module.exports = mongoose.model('InventoryAudit', InventoryAuditSchema);

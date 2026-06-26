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
        status: {
            type: String,
            enum: ['matched', 'missing', 'excess'],
            default: 'missing'
        }
    }],
    extraItems: [{
        productCode: { type: String, required: true },
        scannedQty: { type: Number, default: 0 }
    }]
}, { timestamps: true });

module.exports = mongoose.model('InventoryAudit', InventoryAuditSchema);

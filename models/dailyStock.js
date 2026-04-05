const mongoose = require('mongoose');

const dailyStockSchema = new mongoose.Schema({
    date: {
        type: Date,
        default: Date.now
    },
    productCode: {
        type: String,
        required: true,
        index: true
    },
    productName: {
        type: String,
        required: true
    },
    unit: {
        type: String
    },
    branch: {
        type: String,
        required: true,
        index: true
    },
    expectedQuantity: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'checked', 'not_checked'],
        default: 'pending'
    },
    verificationStatus: {
        type: String,
        enum: ['waiting', 'success', 'failed'],
        default: 'waiting'
    },
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    verifiedAt: {
        type: Date
    },
    failReason: {
        type: String,
        enum: ['not_checked', 'in_transit', 'imei_mismatch', 'repair', 'claim', 'backup', 'other']
    },
    failDetail: {
        type: String
    },
    scannedAt: {
        type: Date
    },
    checkedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    evidenceImage: {
        type: String // URL from Cloudinary
    },
    note: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('DailyStock', dailyStockSchema);

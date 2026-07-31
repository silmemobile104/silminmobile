const mongoose = require('mongoose');

const DailyAccessoryCheckSchema = new mongoose.Schema({
    date: {
        type: String, // YYYY-MM-DD
        required: true
    },
    branch: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'submitted', 'completed', 'recheck'],
        default: 'pending'
    },
    submittedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    submittedByName: {
        type: String,
        default: ''
    },
    items: [{
        productCode: { type: String, required: true },
        productName: { type: String, default: '' },
        expectedQty: { type: Number, default: 0 },
        countedQty: { type: Number, default: 0 },
        remark: { type: String, default: '' },
        deductionAmount: { type: Number, default: 0 },
        shippingQty: { type: Number, default: 0 }
    }]
}, { timestamps: true });

// Compound index to ensure date + branch uniqueness
DailyAccessoryCheckSchema.index({ date: 1, branch: 1 }, { unique: true });

module.exports = mongoose.model('DailyAccessoryCheck', DailyAccessoryCheckSchema);

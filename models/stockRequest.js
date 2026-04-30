const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const StockRequestItemSchema = new Schema({
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    fulfilledQuantity: { type: Number, default: 0 },
    isTech: { type: Boolean, default: false }
});

const StockRequestSchema = new Schema({
    companyId: { type: String, required: true },
    branch: { type: String, required: true },
    title: { type: String, required: true },
    requestNumber: { type: String },
    parentRequestId: { type: Schema.Types.ObjectId, ref: 'StockRequest' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: [StockRequestItemSchema],
    note: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'processing', 'ordering', 'sent_to_tech', 'shipped', 'received', 'canceled'],
        default: 'pending'
    },
    fulfillmentMethod: {
        type: String,
        enum: ['purchase', 'stock', null],
        default: null
    },
    expectedArrivalDate: { type: Date },
    trackingNumbers: [{ type: String }],
    requestedDate: { type: Date, default: Date.now },
    isPartiallyFulfilled: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('StockRequest', StockRequestSchema);

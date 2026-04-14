// models/activityLog.js
const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    action: {
        type: String,
        required: true
    },
    module: {
        type: String,
        required: true
        // ตัวอย่าง: 'Task', 'Deposit', 'User', 'Auth'
    },
    description: {
        type: String,
        required: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed, // เก็บ JSON ได้อิสระ
        default: null
    },
    ipAddress: {
        type: String,
        default: 'unknown'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index เพื่อให้ Query เร็วขึ้น
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ user: 1 });
activityLogSchema.index({ module: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);

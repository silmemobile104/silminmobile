// controllers/logController.js
const ActivityLog = require('../models/activityLog');

// @desc    ดึงข้อมูล Activity Log ทั้งหมด (Admin Only)
// @route   GET /api/logs
// @access  Admin (executive, manager, hr)
exports.getLogs = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        // Filter ตัวเลือก (ถ้ามี)
        const filter = {};
        if (req.query.module) filter.module = req.query.module;
        if (req.query.action) filter.action = req.query.action;

        const [logs, total] = await Promise.all([
            ActivityLog.find(filter)
                .populate('user', 'name username')  // ดึงชื่อ + username ของผู้ใช้
                .sort({ createdAt: -1 })             // ล่าสุดก่อน
                .skip(skip)
                .limit(limit),
            ActivityLog.countDocuments(filter)
        ]);

        res.status(200).json({
            logs,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get Logs Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

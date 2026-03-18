// utils/logger.js
const ActivityLog = require('../models/activityLog');

/**
 * บันทึก Activity Log
 * @param {Object} req - Express request object (ดึง userId และ IP อัตโนมัติ)
 * @param {string} action - 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'REGISTER'
 * @param {string} module - ชื่อ Module เช่น 'Task', 'Deposit', 'User', 'Auth'
 * @param {string} description - คำอธิบายสั้นๆ เช่น 'สร้างงานใหม่: ส่งรายงาน'
 * @param {Object} [details] - ข้อมูลเพิ่มเติม (JSON ค่าที่เปลี่ยน) ถ้าไม่มีใส่ null
 */
const logActivity = async (req, action, module, description, details = null) => {
    try {
        const userId = req.user ? (req.user._id || req.user.id) : null;

        // รองรับ Proxy (เช่น Vercel, nginx)
        const ipAddress =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.ip ||
            'unknown';

        await ActivityLog.create({
            user: userId,
            action,
            module,
            description,
            details,
            ipAddress
        });
    } catch (err) {
        // ไม่ให้ error ของ Log มาหยุดการทำงานหลักของ Controller
        console.error('[Logger] Failed to write activity log:', err.message);
    }
};

module.exports = { logActivity };

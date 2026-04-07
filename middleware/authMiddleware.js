// server/middleware/authMiddleware.js

const jwt = require('jsonwebtoken');
require('dotenv').config();
const User = require('../models/user');

// 'protect' คือชื่อ Middleware ของเรา
exports.protect = async (req, res, next) => {
    let token;

    // 1. ตรวจสอบว่า Client ส่ง Token มาใน Header หรือไม่
    // เราจะใช้มาตรฐาน "Bearer Token" (Authorization: Bearer <token>)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // 2. ดึง Token ออกมาจาก Header
            token = req.headers.authorization.split(' ')[1]; // เอาเฉพาะส่วน <token>

            // 3. ตรวจสอบ Token (ใช้ Secret Key เดียวกับตอน Login)
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // 4. (สำคัญ!) ดึงข้อมูล User (ที่ Login อยู่) จาก ID ใน Token
            // และแนบข้อมูลนี้ไปกับ 'req' เพื่อให้ Controller ใช้ต่อได้
            // เราไม่เอา password มาด้วย
            req.user = await User.findById(decoded.user.id).select('-password');

            if (!req.user) {
                console.warn(`[AuthMiddleware] User not found for ID: ${decoded.user.id}`);
                return res.status(401).json({ message: 'ไม่พบผู้ใช้' });
            }

            console.log(`[AuthMiddleware] Authenticated: ${req.user.username} (${req.user.role})`);

            // 5. ไปยังขั้นตอนต่อไป (เช่น taskController.createTask)
            next();

        } catch (error) {
            console.error('Token ล้มเหลว:', error.message);
            if (error.name === 'TokenExpiredError') {
                 return res.status(401).json({ message: 'Token หมดอายุ, เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
            }
            res.status(401).json({ message: 'Token หมดอายุ หรือไม่ถูกต้อง, การเข้าถึงถูกปฏิเสธ' });
        }
    }

    if (!token) {
        res.status(401).json({ message: 'ไม่มี Token, การเข้าถึงถูกปฏิเสธ' });
    }
};

// Middleware ตรวจสอบ Role
exports.checkRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};
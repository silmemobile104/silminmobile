// controllers/authController.js (V2 - ฉบับแก้ไข)

const User = require('../models/user'); // 1. Import User Model
const bcrypt = require('bcryptjs');     // 2. Import Bcrypt
const jwt = require('jsonwebtoken');    // 3. Import JWT
const { logActivity } = require('../utils/logger'); // Activity Log
require('dotenv').config();

// --- ฟังก์ชันสำหรับสร้าง User ใหม่ (เข้ารหัสผ่าน) ---
exports.registerUser = async (req, res) => {
    // ดึงข้อมูลที่ส่งมา (จาก Postman หรือฟอร์มลงทะเบียน)
    const { username, password, name, companyId, role, department, branch, reportsTo } = req.body;

    try {
        // 1. ตรวจสอบว่ามี username นี้ในระบบหรือยัง
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'Username นี้ถูกใช้งานแล้ว' });
        }

        // 2. สร้าง User ใหม่
        user = new User({
            username,
            password, // รับรหัสผ่าน (ยังไม่เข้ารหัส)
            name,
            companyId,
            role,
            department,
            branch,
            reportsTo
        });

        // 3. เข้ารหัสผ่าน (Hashing)
        const salt = await bcrypt.genSalt(10); // สร้างเกลือ (salt)
        user.password = await bcrypt.hash(password, salt); // นำรหัสผ่านไป hash กับ salt

        // 4. บันทึก User ลง DB
        await user.save();
        console.log(`[Register] User ${username} ถูกสร้างสำเร็จ!`);

        // Log กิจกรรม (ใช้ req.user อาจจะยังไม่มี — ส่ง null ผ่าน logActivity ได้)
        await logActivity(req, 'REGISTER', 'Auth', `สร้างบัญชีผู้ใช้ใหม่: ${username}`, { username, role, branch });

        // 5. สร้าง Token (JWT) เพื่อส่งกลับไป
        const payload = {
            user: {
                id: user.id, // ID ที่ MongoDB สร้างให้
                role: user.role
            }
        };

        // ใช้ JWT_SECRET จาก .env
        const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_key';

        jwt.sign(
            payload,
            jwtSecret,
            { expiresIn: '24h' }, // Token หมดอายุใน 24 ชั่วโมง
            (err, token) => {
                if (err) throw err;
                res.status(201).json({ token }); // ส่ง Token กลับไป
            }
        );

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};


// --- ฟังก์ชันสำหรับ Login (ฉบับแก้ไข: เพิ่ม Department และ Branch) ---
exports.loginUser = async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. ค้นหา User ใน DB ด้วย username
        const user = await User.findOne({ username });
        if (!user) {
            // ถ้าไม่เจอ User
            return res.status(400).json({ message: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        // 2. ถ้าเจอ User -> เปรียบเทียบรหัสผ่าน
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            // ถ้ารหัสผ่านไม่ตรง
            return res.status(400).json({ message: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        // 3. ถ้ารหัสผ่านถูกต้อง!
        console.log(`[Login] User ${username} เข้าสู่ระบบสำเร็จ!`);

        // ชั่วคราว: แนบข้อมูล user ลงใน req เพื่อให้ logActivity ดึง userId ได้
        req.user = user;
        await logActivity(req, 'LOGIN', 'Auth', `${username} เข้าสู่ระบบ`, { username, role: user.role });

        // 4. สร้าง Token (JWT) ส่งกลับไป
        const payload = {
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                companyId: user.companyId,
                // === จุดที่แก้ไข: เพิ่ม department และ branch ===
                department: user.department,
                branch: user.branch,
                // ===============================================
            }
        };

        const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_key';

        jwt.sign(
            payload,
            jwtSecret,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;

                // ส่ง Token และข้อมูล User (ที่จำเป็น) กลับไป
                res.status(200).json({
                    token,
                    user: payload.user // ตอนนี้ user Object มี branch แล้ว
                });
            }
        );

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
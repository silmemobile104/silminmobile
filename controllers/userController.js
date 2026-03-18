// server/controllers/userController.js
// (เวอร์ชันแก้ไข - รวบที่ซ้ำซ้อนและแก้บั๊กตัวแปร)

const User = require('../models/user'); // <-- 1. ใช้ตัวพิมพ์ใหญ่ 'User'
const bcrypt = require('bcryptjs'); // Import bcrypt for password hashing
const { logActivity } = require('../utils/logger'); // Activity Log

// @desc    ดึงรายชื่อ User ทั้งหมด (เพื่อใช้ใน Dropdown มอบหมายงาน)
// @route   GET /api/users
// @access  Private (ต้อง Login)
exports.getUsersForAssignment = async (req, res) => {
    try {
        const { companyId } = req.query;
        const userRole = req.user.role;

        // 1. กำหนดว่าจะกรองบริษัทไหน
        let filterCompanyId;
        if (userRole === 'staff') {
            filterCompanyId = req.user.companyId;
        } else {
            // (Manager, HR, Exec)
            filterCompanyId = companyId || req.user.companyId;
        }

        // 2. สร้างเงื่อนไขการค้นหา
        let query = {
            companyId: filterCompanyId,
        };

        // 3. Logic การกรอง Role (ตาม Requirement ล่าสุด)
        if (userRole === 'staff') {
            query.role = '---no-one---';

        } else if (userRole === 'manager' || userRole === 'hr' || userRole === 'executive') {
            // เห็นทุกคน (ยกเว้นผู้บริหาร) เพื่อสั่งงานได้
            query.role = { $ne: 'executive' };
        }

        // 4. ค้นหา User (*** แก้ไข: ใช้ 'User.find' ***)
        const users = await User.find(query)
            .select('_id name username department branch role')
            .sort({ name: 1 });

        res.status(200).json(users);

    } catch (error) {
        console.error('Get Users Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};


// (*** 2. ฟังก์ชันสำหรับ Admin (อยู่ครบ) ***)

// @desc    [Admin] Get all users
// @route   GET /api/users/admin/all
// @access  Admin (Exec, Manager, HR)
exports.adminGetAllUsers = async (req, res) => {
    try {
        const users = await User.find({})
            .populate('reportsTo', 'name username')
            .select('-password')
            .sort({ name: 1 });

        res.status(200).json(users);
    } catch (error) {
        console.error('Admin Get All Users Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    [Admin] Update a user
// @route   PUT /api/users/admin/:id
// @access  Admin (Exec, Manager, HR)
exports.adminUpdateUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, role, department, branch, reportsTo, password } = req.body; // Extract password

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
        }

        user.name = name || user.name;
        user.role = role || user.role;
        user.department = department || user.department;
        user.branch = branch;
        user.reportsTo = reportsTo || null;

        // Check if password is provided and not empty
        if (password && password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        const updatedUser = await user.save();
        await logActivity(req, 'UPDATE', 'User', `แก้ไขข้อมูลผู้ใช้: ${updatedUser.username}`, { userId, name: updatedUser.name, role: updatedUser.role, branch: updatedUser.branch });
        console.log(`[Admin] User ${req.user.username} แก้ไขข้อมูล ${updatedUser.username}`);
        res.status(200).json({
            _id: updatedUser._id,
            name: updatedUser.name,
            username: updatedUser.username,
            role: updatedUser.role,
            department: updatedUser.department,
            branch: updatedUser.branch,
            reportsTo: updatedUser.reportsTo
        });

    } catch (error) {
        console.error('Admin Update User Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    [Admin] Delete a user
// @route   DELETE /api/users/admin/:id
// @access  Admin (Exec, Manager, HR)
exports.adminDeleteUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
        }

        if (user._id.toString() === req.user.id) {
            return res.status(400).json({ message: 'คุณไม่สามารถลบตัวเองได้' });
        }

        await user.deleteOne();
        await logActivity(req, 'DELETE', 'User', `ลบผู้ใช้: ${user.username}`, { deletedUserId: userId, username: user.username });
        console.log(`[Admin] User ${req.user.username} ลบ User ${user.username}`);
        res.status(200).json({ message: 'ลบผู้ใช้สำเร็จ' });

    } catch (error) {
        console.error('Admin Delete User Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};
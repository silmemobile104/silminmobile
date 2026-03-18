// server/controllers/taskController.js

const Task = require('../models/task');
const User = require('../models/user');
const { createNotification } = require('./notificationController');
const { logActivity } = require('../utils/logger'); // Activity Log

// @desc    สร้างงานใหม่
// @route   POST /api/tasks
// @access  Private (ต้อง Login)
exports.createTask = async (req, res) => {
    const { title, description, assignedTo, dueDate, priority, companyId } = req.body;
    const createdBy = req.user.id;

    try {
        if (!title || !assignedTo) {
            return res.status(400).json({ message: 'กรุณากรอก ชื่องาน และ ผู้รับผิดชอบ' });
        }

        // 1. ค้นหา User ผู้รับผิดชอบ เพื่อเอา "branch"
        const assigneeUser = await User.findById(assignedTo);
        if (!assigneeUser) {
            return res.status(404).json({ message: 'ไม่พบผู้รับผิดชอบงานนี้' });
        }

        const newTask = new Task({
            title,
            description,
            assignedTo,
            dueDate,
            priority,
            companyId: companyId || req.user.companyId,
            createdBy, // (แก้ไข: ใส่ comma ให้ถูกต้อง)

            // (สำคัญ) บันทึกสาขาลงไปใน Task ด้วย เพื่อให้ฝ่ายขายเห็นร่วมกัน
            branch: assigneeUser.branch || null
        });

        const savedTask = await newTask.save();
        console.log(`[Task] User ${req.user.username} สั่งงานใหม่ (ID: ${savedTask._id})`);
        await logActivity(req, 'CREATE', 'Task', `สร้างงานใหม่: "${savedTask.title}"`, { taskId: savedTask._id, title: savedTask.title, assignedTo: savedTask.assignedTo });

        // 2. สร้างการแจ้งเตือน "งานใหม่"
        const message = `คุณได้รับมอบหมายงานใหม่: "${savedTask.title}"`;
        await createNotification([savedTask.assignedTo], message, savedTask._id, req.user.id);

        res.status(201).json(savedTask);

    } catch (error) {
        console.error('Create Task Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    ดึง Task ทั้งหมด (สำหรับ Dashboard หรือ "งานของฉัน")
// @route   GET /api/tasks
// @access  Private
exports.getTasksForDashboard = async (req, res) => {
    try {
        const { companyId, view } = req.query; // view = 'dashboard' หรือ 'mytasks'
        const userRole = req.user.role;
        const userId = req.user.id;

        // ดึงข้อมูลแผนกและสาขาของคน Login
        const userDept = req.user.department;
        const userBranch = req.user.branch;

        // Helper: ตรวจสอบว่าเป็นฝ่ายขายที่มีสังกัดสาขาหรือไม่
        const isSalesTeam = (userDept && (userDept.includes('ขาย') || userDept.toLowerCase().includes('sales'))) && userBranch;

        let query = {};

        if (view === 'mytasks') {
            // --- VIEW: งานของฉัน ---
            if (isSalesTeam) {
                // (ฝ่ายขาย) เห็นงานทั้งหมดของ "สาขาตัวเอง"
                query = {
                    branch: userBranch,
                    companyId: req.user.companyId
                };
                console.log(`[Task] User ${req.user.username} (Sales-${userBranch}) ดูงานรวมของสาขา`);
            } else {
                // (แผนกอื่น) เห็นเฉพาะงานของตัวเอง
                query = { assignedTo: userId };
            }

        } else {
            // --- VIEW: DASHBOARD (ภาพรวม) ---
            let filterCompanyId;
            if (userRole === 'staff') {
                filterCompanyId = req.user.companyId;
            } else {
                filterCompanyId = companyId || req.user.companyId;
            }

            if (userRole === 'staff') {
                if (isSalesTeam) {
                    // Staff ฝ่ายขาย -> เห็นงานในสาขา
                    query = { branch: userBranch, companyId: filterCompanyId };
                } else {
                    // Staff ทั่วไป -> เห็นงานตัวเอง
                    query = { assignedTo: userId, companyId: filterCompanyId };
                }
            } else {
                // Manager/Exec/HR -> เห็นงานทั้งหมดในบริษัทที่เลือก
                query = { companyId: filterCompanyId };
            }
        }

        const tasks = await Task.find(query)
            .populate('assignedTo', 'name username branch')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json(tasks);

    } catch (error) {
        console.error('Get All Tasks Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get single task by ID
// @route   GET /api/tasks/:id
// @access  Private
exports.getTaskById = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id)
            .populate('createdBy', 'name')
            .populate('assignedTo', 'name');

        if (!task) {
            return res.status(404).json({ message: 'ไม่พบงานนี้' });
        }

        // ตรวจสอบสิทธิ์ฝ่ายขาย (สาขาเดียวกัน)
        const isSalesTeam = (req.user.department && (req.user.department.includes('ขาย') || req.user.department.toLowerCase().includes('sales')));
        const isSameBranch = (task.branch && task.branch === req.user.branch);

        const isAllowed =
            task.createdBy._id.toString() === req.user.id ||
            task.assignedTo._id.toString() === req.user.id ||
            (isSalesTeam && isSameBranch) || // (อนุญาตถ้าเป็นฝ่ายขายสาขาเดียวกัน)
            ['executive', 'manager', 'hr'].includes(req.user.role);

        if (!isAllowed) {
            return res.status(403).json({ message: 'คุณไม่มีสิทธิ์เข้าถึงงานนี้' });
        }

        res.status(200).json(task);

    } catch (error) {
        console.error('Get Task By ID Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update a task (แก้ไขงาน)
// @route   PUT /api/tasks/:id
// @access  Private
exports.updateTask = async (req, res) => {
    const { title, description, dueDate, assignedTo, status, commentText } = req.body;
    const taskId = req.params.id;
    const userId = req.user.id;

    try {
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'ไม่พบงานนี้' });

        // ตรวจสอบสิทธิ์ฝ่ายขาย
        const isSalesTeam = (req.user.department && (req.user.department.includes('ขาย') || req.user.department.toLowerCase().includes('sales')));
        const isSameBranch = (task.branch && task.branch === req.user.branch);

        // 1. สิทธิ์การแก้ไขเนื้อหา (Content) -> Admin หรือ ผู้สร้าง
        const canEditContent =
            task.createdBy.toString() === userId ||
            ['executive', 'manager', 'hr'].includes(req.user.role);

        // 2. สิทธิ์การแก้ไขสถานะ (Status Only) -> ผู้รับผิดชอบ หรือ ฝ่ายขายสาขาเดียวกัน
        const canOnlyUpdateStatus =
            req.user.role === 'staff' && (
                task.assignedTo.toString() === userId ||
                (isSalesTeam && isSameBranch)
            );

        if (!canEditContent && !canOnlyUpdateStatus) {
            return res.status(403).json({ message: 'คุณไม่มีสิทธิ์แก้ไขงานนี้' });
        }

        // --- เริ่มการอัปเดต ---
        const statusChanged = req.body.status && task.status !== req.body.status;
        const commentAdded = req.body.commentText && req.body.commentText.trim() !== '';

        if (canEditContent) {
            task.title = title || task.title;
            task.description = description || task.description;
            task.dueDate = dueDate || task.dueDate;
            task.assignedTo = assignedTo || task.assignedTo;
            task.status = status || task.status;
        } else if (canOnlyUpdateStatus) {
            task.status = status || task.status;
        }

        if (commentAdded) {
            task.comments.push({
                userId: req.user.id,
                name: req.user.name,
                text: commentText
            });
        }

        const updatedTask = await task.save();
        
        await logActivity(req, 'UPDATE', 'Task', `อัปเดตงาน: "${task.title}"`, { taskId: taskId, status: req.body.status, commentAdded });

        // --- Notification Logic ---
        const executives = await User.find({ companyId: task.companyId, role: 'executive' }).select('_id');
        const executiveIds = executives.map(e => e._id);

        const recipientIds = new Set();
        executiveIds.forEach(id => recipientIds.add(id.toString())); // Admin เห็นหมด
        recipientIds.add(task.createdBy.toString()); // ผู้สร้าง
        recipientIds.add(task.assignedTo.toString()); // ผู้รับผิดชอบหลัก

        let notifyMessage = '';
        if (statusChanged) notifyMessage = `${req.user.name} อัปเดตสถานะงาน "${task.title}" เป็น "${req.body.status}"`;
        else if (commentAdded) notifyMessage = `${req.user.name} แสดงความคิดเห็นในงาน "${task.title}"`;

        if (statusChanged || commentAdded) {
            await createNotification(
                Array.from(recipientIds),
                notifyMessage,
                task._id,
                req.user.id
            );
        }

        console.log(`[Task] User ${req.user.username} อัปเดตงาน (ID: ${taskId})`);
        res.status(200).json(updatedTask);

    } catch (error) {
        console.error('Update Task Error:', error.message);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete a task
// @route   DELETE /api/tasks/:id
// @access  Private
exports.deleteTask = async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.id;

    try {
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'ไม่พบงานนี้' });

        // Normalize role to lowercase to ensure case-insensitive comparison
        const userRole = (req.user.role || '').toLowerCase();

        const canDelete =
            task.createdBy.toString() === userId ||
            ['executive', 'manager', 'hr'].includes(userRole);

        if (!canDelete) {
            return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบงานนี้' });
        }

        await task.deleteOne();
        await logActivity(req, 'DELETE', 'Task', `ลบงาน: "${task.title}"`, { taskId });
        console.log(`[Task] User ${req.user.username} ลบงาน (ID: ${taskId})`);
        res.status(200).json({ message: 'ลบงานสำเร็จ' });

    } catch (error) {
        console.error('Delete Task Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Task Statistics
// @route   GET /api/tasks/stats
// @access  Private
exports.getTaskStats = async (req, res) => {
    try {
        const { companyId } = req.query;
        const userRole = req.user.role;

        let filterCompanyId;
        if (userRole === 'staff') {
            filterCompanyId = req.user.companyId;
        } else {
            filterCompanyId = companyId || req.user.companyId;
        }

        const stats = await Task.aggregate([
            { $match: { companyId: filterCompanyId } },
            {
                $group: {
                    _id: null,
                    todo: { $sum: { $cond: [{ $eq: ["$status", "todo"] }, 1, 0] } },
                    inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
                    forReview: { $sum: { $cond: [{ $eq: ["$status", "for-review"] }, 1, 0] } },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }
                }
            }
        ]);

        if (stats.length > 0) {
            res.status(200).json(stats[0]);
        } else {
            res.status(200).json({ todo: 0, inProgress: 0, forReview: 0, completed: 0 });
        }

    } catch (error) {
        console.error('Get Task Stats Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};
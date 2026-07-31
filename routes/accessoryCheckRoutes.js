const express = require('express');
const router = express.Router();
const multer = require('multer');
const accessoryCheckController = require('../controllers/accessoryCheckController');
const { protect, checkRole } = require('../middleware/authMiddleware');

// Set up temporary multer uploads directory
const uploadLocal = multer({ dest: 'uploads/' });

// Custom middleware to check if user is Admin/Manager/HR or belongs to Stock/Warehouse department
const checkAdminOrStock = (req, res, next) => {
    const role = req.user.role;
    const userDept = (req.user.department || '').toLowerCase();
    const stockKeywords = ['stock', 'store', 'สต๊อก', 'คลัง', 'warehouse', 'supply'];
    const isStockTeam = stockKeywords.some(keyword => userDept.includes(keyword));

    if (['admin', 'executive', 'manager', 'hr'].includes(role) || isStockTeam) {
        return next();
    }
    
    return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เข้าใช้งานส่วนนี้ (เฉพาะแอดมินหรือฝ่ายสต็อกส่วนกลางเท่านั้น)'
    });
};

// Admin / Stock routes
router.post('/upload', protect, checkAdminOrStock, uploadLocal.single('file'), accessoryCheckController.uploadSession);
router.get('/overview', protect, checkAdminOrStock, accessoryCheckController.getAdminOverview);
router.post('/reject', protect, checkAdminOrStock, accessoryCheckController.rejectSession);
router.post('/approve', protect, checkAdminOrStock, accessoryCheckController.approveSession);
router.post('/deduction', protect, checkAdminOrStock, accessoryCheckController.updateDeduction);
router.post('/shipping', protect, checkAdminOrStock, accessoryCheckController.updateShipping);

// Branch Staff routes
router.get('/branch-task', protect, checkRole(['staff', 'admin', 'executive', 'manager', 'hr']), accessoryCheckController.getBranchTask);
router.post('/submit', protect, checkRole(['staff', 'admin', 'executive', 'manager', 'hr']), accessoryCheckController.submitBranchCheck);
router.post('/draft', protect, checkRole(['staff', 'admin', 'executive', 'manager', 'hr']), accessoryCheckController.saveDraft);

module.exports = router;

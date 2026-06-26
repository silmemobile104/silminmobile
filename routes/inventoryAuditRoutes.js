const express = require('express');
const router = express.Router();
const multer = require('multer');
const inventoryAuditController = require('../controllers/inventoryAuditController');
const { protect } = require('../middleware/authMiddleware');

// ใช้ Multer จัดการอัปโหลดไฟล์เก็บไว้ชั่วคราวที่ uploads/
const uploadLocal = multer({ dest: 'uploads/' });

// API Endpoints
router.post('/upload', protect, uploadLocal.single('file'), inventoryAuditController.uploadAuditFile);
router.post('/save', protect, inventoryAuditController.saveAuditResult);
router.get('/history', protect, inventoryAuditController.getAuditHistory);

module.exports = router;

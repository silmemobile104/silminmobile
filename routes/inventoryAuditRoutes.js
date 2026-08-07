const express = require('express');
const router = express.Router();
const multer = require('multer');
const inventoryAuditController = require('../controllers/inventoryAuditController');
const { protect } = require('../middleware/authMiddleware');

// ใช้ Multer จัดการอัปโหลดไฟล์เก็บไว้ชั่วคราวที่ uploads/ (สำหรับ Excel)
const uploadLocal = multer({ dest: 'uploads/' });

// ใช้ Multer ในหน่วยความจำ (Memory Storage) สำหรับรูปภาพสแกน/รูปภาพโอนย้าย
const storageMemory = multer.memoryStorage();
const uploadMemory = multer({ 
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// API Endpoints
router.post('/upload', protect, uploadLocal.single('file'), inventoryAuditController.uploadAuditFile);
router.post('/save', protect, inventoryAuditController.saveAuditResult);
router.get('/history', protect, inventoryAuditController.getAuditHistory);
router.post('/upload-evidence', protect, uploadMemory.single('file'), inventoryAuditController.uploadAuditEvidence);
router.get('/session/:id', protect, inventoryAuditController.getAuditSession);

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const dailyStockController = require('../controllers/dailyStockController');

// Middleware
const { protect: verifyToken, checkRole } = require('../middleware/authMiddleware');

// --- ตั้งค่า Multer แบบอัปโหลดลง Server (ใช้สำหรับไฟล์ CSV/XLSX) ---
// เราใช้หน่วยความจำหรือโฟลเดอร์ uploads ก็ได้ ตอนนี้ใช้ uploads ชั่วคราวละลบตอนอ่านเสร็จ
const uploadLocal = multer({ dest: 'uploads/' });

// --- ตั้งค่า Multer (Memory Storage) สำหรับรูปภาพสแกนสต็อก ---
const storageMemory = multer.memoryStorage();
const uploadMemory = multer({ 
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// -----------------------------------------
// ROUTES
// -----------------------------------------

// 1. นำเข้าข้อมูล (ฝ่ายสต็อก) 
// - checkRole: อนุญาต admin, manager, และพนักงานสต็อก (staff ถ้าต้องการให้ทำได้ระบุได้เพิ่ม)
router.post('/import', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), uploadLocal.single('file'), dailyStockController.importDailyStock);

// 2. ดึงข้อมูลสต็อกของสาขาตัวเอง (ฝ่ายขาย)
router.get('/my-branch', verifyToken, dailyStockController.getMyBranchStock);

// 3. สแกนตรวจสอบสินค้า (ฝ่ายขาย)
// - รับ productCode และหลักฐาน
router.put('/scan', verifyToken, uploadMemory.single('evidenceImage'), dailyStockController.scanStock);

// 4. ดึงข้อมูลสรุปผลรายวัน (ฝ่ายสต็อก)
router.get('/summary', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.getDailySummary);

// 5. ดึงข้อมูลรายงานการเช็คสต็อก (ยืดหยุ่นตามช่วงเวลา)
router.get('/report', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.getDailyStockReport);

// 6. แทรก/แก้ไข รายการตอนนำเข้าสต็อกแล้ว (ฝ่ายสต็อก) สามารถทำได้ทุกเวลา
router.put('/edit/:id', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.editDailyStock);

// 7. ยืนยันข้อมูลเช็คสต็อก (ฝ่ายสต็อก)
router.put('/verify', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.verifyStock);

// 8. ดึงข้อมูลเปรียบเทียบสต็อก (สรุประหว่าง 2 วัน)
router.get('/comparison', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.getComparisonReport);

// 9. สรุปยอดสต็อกคงเหลือ (พนักงานทั่วไปเข้าถึงได้)
router.get('/stock-balance', verifyToken, dailyStockController.getStockBalance);

// 10. รายงาน Aging Stock
router.get('/aging-report', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.getAgingStockReport);

module.exports = router;

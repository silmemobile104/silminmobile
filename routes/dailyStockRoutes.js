const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dailyStockController = require('../controllers/dailyStockController');

// Middleware
const { protect: verifyToken, checkRole } = require('../middleware/authMiddleware');

// --- ตั้งค่า Multer แบบอัปโหลดลง Server (ใช้สำหรับไฟล์ CSV/XLSX) ---
// เราใช้หน่วยความจำหรือโฟลเดอร์ uploads ก็ได้ ตอนนี้ใช้ uploads ชั่วคราวละลบตอนอ่านเสร็จ
const uploadLocal = multer({ dest: 'uploads/' });

// --- ตั้งค่า Cloudinary (สำหรับรูปหลักฐานสแกนสต็อก) ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storageCloudinary = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const fileFormat = file.originalname.split('.').pop();
        return {
            folder: 'status_tracking_uploads/status_tracking_daily_stock', 
            resource_type: 'image',             
            format: fileFormat,                
            use_filename: true,                
            unique_filename: true,             
        };
    },
});

let uploadCloudinary;
try {
    uploadCloudinary = multer({ storage: storageCloudinary });
} catch (error) {
    console.error('Cloudinary Storage Init Error (DailyStock):', error);
    uploadCloudinary = multer({ dest: 'uploads/' });
}

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
router.put('/scan', verifyToken, uploadCloudinary.single('evidenceImage'), dailyStockController.scanStock);

// 4. ดึงข้อมูลสรุปผลรายวัน (ฝ่ายสต็อก)
router.get('/summary', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.getDailySummary);

// 5. ดึงข้อมูลรายงานการเช็คสต็อก (ยืดหยุ่นตามช่วงเวลา)
router.get('/report', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.getDailyStockReport);

// 6. แทรก/แก้ไข รายการตอนนำเข้าสต็อกแล้ว (ฝ่ายสต็อก) สามารถทำได้ทุกเวลา
router.put('/edit/:id', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.editDailyStock);

// 7. ยืนยันข้อมูลเช็คสต็อก (ฝ่ายสต็อก)
router.put('/verify', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), dailyStockController.verifyStock);

module.exports = router;

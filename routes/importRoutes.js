const express = require('express');
const router = express.Router();
const multer = require('multer');
const importController = require('../controllers/importController');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// นำเข้า Middleware (เปลี่ยนชื่อ protect เป็น verifyToken เพื่อความเข้าใจง่าย)
const { protect: verifyToken, checkRole } = require('../middleware/authMiddleware');

// --- 1. ตั้งค่า Cloudinary ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- 2. ตั้งค่า Storage สำหรับ Multer ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        // ดึงนามสกุลไฟล์จากชื่อเดิม
        const fileFormat = file.originalname.split('.').pop();

        return {
            folder: 'status_tracking_uploads', // ชื่อโฟลเดอร์บน Cloudinary
            resource_type: 'auto',             // ให้ระบบตรวจชนิดไฟล์เอง (รูป/วิดีโอ/เอกสาร)
            format: fileFormat,                // บังคับใช้นามสกุลเดิม
            use_filename: true,                // ใช้ชื่อไฟล์เดิมจากเครื่อง user
            unique_filename: true,             // (*** FIX: เติมเลขสุ่มต่อท้ายชื่อไฟล์เพื่อป้องกันการทับไฟล์เดิม ***)
        };
    },
});

// เริ่มต้น Multer
let upload;
try {
    upload = multer({ storage: storage });
} catch (error) {
    console.error('Multer/Cloudinary Storage Init Error:', error);
    // กรณี Cloudinary มีปัญหา ให้ fallback ไปเก็บที่โฟลเดอร์ uploads ชั่วคราว (Optional)
    upload = multer({ dest: 'uploads/' });
}

// --- 3. Routes (เส้นทาง API) ---

// Product Catalog
router.get('/catalog', verifyToken, importController.getProductCatalog);

// สร้างรายการใหม่ + อัปโหลดไฟล์ (สูงสุด 5 ไฟล์)
router.post('/', verifyToken, upload.array('files', 5), importController.createImport);

// ดึงรายการแจ้งนำเข้า (สำคัญ: ต้องมี verifyToken เพื่อแก้ปัญหาโหลดข้อมูลไม่ได้)
router.get('/', verifyToken, importController.getImports);

// Export single import to Excel
router.get('/:id/export', verifyToken, importController.exportImportToExcel);

// อัปเดตรายการ (แก้ไข/เพิ่มไฟล์)
router.put('/:id', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), upload.array('files', 5), importController.updateImport);

// อัปเดตสถานะ (เฉพาะ role ที่ระบุ)
router.put('/:id/status', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), importController.updateImportStatus);

// ลบรายการ (เฉพาะ admin/manager/executive)
router.delete('/:id', verifyToken, checkRole(['admin', 'manager', 'executive', 'staff']), importController.deleteImport);

module.exports = router;
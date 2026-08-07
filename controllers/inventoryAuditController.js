const InventoryAudit = require('../models/inventoryAudit');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const { logActivity } = require('../utils/logger');
const { uploadBufferToDriveInNestedFolder } = require('../utils/googleDrive');

// 1. อัปโหลดไฟล์ Excel/CSV และสร้างแบบฟอร์มตรวจสอบสถานะ 'pending'
exports.uploadAuditFile = async (req, res) => {
    try {
        const { branch } = req.body;
        if (!branch) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'กรุณาระบุสาขา' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาอัปโหลดไฟล์ Excel (.xlsx) หรือ CSV (.csv)' });
        }

        const filePath = req.file.path;
        const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
        let rawData = [];

        // อ่านไฟล์ข้อมูลตามประเภท
        if (fileExtension === 'csv') {
            await new Promise((resolve, reject) => {
                const stream = fs.createReadStream(filePath)
                    .pipe(csv())
                    .on('data', (data) => rawData.push(data))
                    .on('end', resolve)
                    .on('error', reject);
            });
        } else if (fileExtension === 'xlsx') {
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            rawData = xlsx.utils.sheet_to_json(sheet);
        } else {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'รองรับเฉพาะไฟล์ .csv หรือ .xlsx' });
        }

        // ลบไฟล์ชั่วคราว
        fs.unlinkSync(filePath);

        if (rawData.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลในไฟล์ที่อัปโหลด' });
        }

        // ค้นหาคอลัมน์โดยไม่สนใจเว้นวรรค
        const getColValue = (row, possibleKeys) => {
            const foundKey = Object.keys(row).find(k => 
                possibleKeys.includes(k.trim().toLowerCase())
            );
            return foundKey ? row[foundKey] : undefined;
        };

        // แผนที่คีย์ที่เป็นไปได้
        const codeKeys = ['รหัสสินค้า', 'imei', 'barcode', 'productcode', 'รหัส', 'serial', 'serialnumber'];
        const nameKeys = ['ชื่อสินค้า', 'productname', 'ชื่อ', 'itemname', 'description'];
        const qtyKeys = ['จำนวน', 'expectedqty', 'quantity', 'qty', 'จำนวนสินค้า'];

        // แปลงข้อมูลและจัดกลุ่ม (Group By productCode เพื่อรวมจำนวนถ้ามีแถวซ้ำ)
        const groupedItems = {};

        rawData.forEach(row => {
            const rawCode = getColValue(row, codeKeys);
            const code = rawCode ? String(rawCode).trim() : '';
            const name = getColValue(row, nameKeys) ? String(getColValue(row, nameKeys)).trim() : 'Unknown Product';
            const qtyVal = parseFloat(getColValue(row, qtyKeys)) || 0;

            if (code) {
                if (groupedItems[code]) {
                    groupedItems[code].expectedQty += qtyVal;
                } else {
                    groupedItems[code] = {
                        productCode: code,
                        productName: name,
                        expectedQty: qtyVal,
                        scannedQty: 0,
                        status: 'missing' // เริ่มต้นคือยังไม่ได้สแกน
                    };
                }
            }
        });

        const itemsList = Object.values(groupedItems);

        if (itemsList.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลรหัสสินค้าและจำนวนในไฟล์ (โปรดตรวจสอบชื่อคอลัมน์)' });
        }

        // สร้างรายการตรวจสอบใหม่ในสถานะ pending
        const auditSession = new InventoryAudit({
            branch: branch,
            auditedBy: req.user._id,
            status: 'pending',
            items: itemsList,
            extraItems: []
        });

        await auditSession.save();

        // บันทึก Activity Log (ส่ง req Object ให้ถูกต้อง)
        await logActivity(req, 'CREATE', 'InventoryAudit', `อัปโหลดไฟล์เตรียมตรวจสอบสต็อกสาขา: ${branch} (${itemsList.length} รายการ)`, { id: auditSession._id, branch });

        res.status(201).json({
            success: true,
            audit: auditSession
        });

    } catch (error) {
        console.error('Upload Audit File Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการนำเข้าไฟล์ตรวจสอบสต็อก' });
    }
};

// 2. บันทึกผลลัพธ์การสแกนตรวจสอบสต็อกและเปลี่ยนสถานะเป็น 'completed'
exports.saveAuditResult = async (req, res) => {
    try {
        const { id, items, extraItems } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบ (Audit ID)' });
        }

        const auditSession = await InventoryAudit.findById(id);
        if (!auditSession) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการตรวจสอบสต็อกนี้' });
        }

        if (auditSession.status === 'completed') {
            return res.status(400).json({ success: false, message: 'รายการตรวจสอบนี้ถูกบันทึกสำเร็จเสร็จสิ้นไปแล้ว' });
        }

        // อัปเดตรายการหลักและประเมินสถานะของแต่ละรายการ
        if (items && Array.isArray(items)) {
            items.forEach(updateItem => {
                const dbItem = auditSession.items.find(i => i.productCode === updateItem.productCode);
                if (dbItem) {
                    const scanned = parseInt(updateItem.scannedQty) || 0;
                    dbItem.scannedQty = scanned;
                    
                    // คำนวณสถานะส่วนต่าง
                    if (dbItem.status === 'in_transit' || (dbItem.inTransitQty && dbItem.inTransitQty > 0)) {
                        dbItem.status = 'in_transit';
                    } else if (scanned === dbItem.expectedQty) {
                        dbItem.status = 'matched';
                    } else if (scanned < dbItem.expectedQty) {
                        dbItem.status = 'missing';
                    } else {
                        dbItem.status = 'excess';
                    }
                }
            });
        }

        // อัปเดตรายการส่วนเกิน (Extra Items)
        if (extraItems && Array.isArray(extraItems)) {
            auditSession.extraItems = extraItems.map(item => ({
                productCode: item.productCode,
                scannedQty: parseInt(item.scannedQty) || 0
            }));
        }

        // สรุปปิดงาน
        auditSession.status = 'completed';
        auditSession.auditDate = new Date();

        await auditSession.save();

        // บันทึก Activity Log
        await logActivity(req, 'UPDATE', 'InventoryAudit', `บันทึกผลตรวจสอบสต็อกสาขา: ${auditSession.branch} สำเร็จ`, { id: auditSession._id, branch: auditSession.branch });

        res.status(200).json({
            success: true,
            message: 'บันทึกผลตรวจสอบสำเร็จ',
            audit: auditSession
        });

    } catch (error) {
        console.error('Save Audit Result Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกผลตรวจสอบสต็อก' });
    }
};

// 3. ดึงประวัติการตรวจสอบสต็อกสาขา
exports.getAuditHistory = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userDept = (req.user.department || '').toLowerCase();
        const isStockTeam = userDept.includes('store') || userDept.includes('stock') || userDept.includes('สต๊อก');

        let query = {};
        // พนักงานปกติ (ที่ไม่ใช่ฝ่ายคลัง/สต็อก หรือ แอดมิน/ผู้จัดการ) เห็นเฉพาะสาขาของตัวเอง
        if (userRole === 'staff' && !isStockTeam) {
            if (req.user.branch) {
                query.branch = req.user.branch;
            }
        }

        const history = await InventoryAudit.find(query)
            .populate('auditedBy', 'name username')
            .sort({ auditDate: -1, createdAt: -1 });

        res.status(200).json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Get Audit History Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงประวัติการตรวจสอบสต็อก' });
    }
};

// 4. อัปโหลดรูปภาพหลักฐานสินค้ากำลังโอนย้าย และอัปเดตสถานะของไอเทมนั้น
exports.uploadAuditEvidence = async (req, res) => {
    try {
        const { auditId, productCode, inTransitQty, remark } = req.body;

        if (!auditId || !productCode) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุ Audit ID และ รหัสสินค้า (productCode)' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์รูปหลักฐานโอนย้าย' });
        }

        const auditSession = await InventoryAudit.findById(auditId);
        if (!auditSession) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการตรวจสอบสต็อกนี้' });
        }

        if (auditSession.status === 'completed') {
            return res.status(400).json({ success: false, message: 'รายการตรวจสอบนี้ถูกบันทึกสำเร็จเสร็จสิ้นไปแล้ว ไม่สามารถแก้ไขได้' });
        }

        // ค้นหาสินค้าในรายการหลัก
        const item = auditSession.items.find(i => i.productCode === productCode);
        if (!item) {
            return res.status(404).json({ success: false, message: 'ไม่พบรหัสสินค้านี้ในรายการตรวจสอบระบบ' });
        }

        // อัปโหลดไฟล์หลักฐานไปยัง Google Drive ในโฟลเดอร์แบบ Nested
        const timestamp = Date.now();
        const fileName = `audit_evidence_${auditId}_${productCode}_${timestamp}.jpg`;
        let evidenceImageUrl = '';
        
        try {
            // ฟอร์แมตวันที่เพื่อตั้งชื่อโฟลเดอร์ย่อย เช่น สาขาหาดใหญ่_05-08-2026
            const dateObj = new Date(auditSession.auditDate || auditSession.createdAt);
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const dateStr = `${day}-${month}-${year}`;
            const folderName = `สาขา${auditSession.branch}_${dateStr}`;

            evidenceImageUrl = await uploadBufferToDriveInNestedFolder(
                req.file.buffer, 
                req.file.mimetype, 
                fileName, 
                ['Audit(หลักฐานสินค้าขาดหาย)', folderName]
            );
        } catch (driveErr) {
            console.error('Google Drive Upload Error for Audit Evidence:', driveErr);
            return res.status(500).json({ success: false, message: 'ไม่สามารถอัปโหลดรูปภาพไปยัง Google Drive ได้' });
        }

        // อัปเดตข้อมูลไอเทม
        const qty = parseInt(inTransitQty) || 0;
        item.inTransitQty = qty;
        item.evidenceImage = evidenceImageUrl;
        item.remark = remark || 'กำลังโอนย้าย';
        item.status = 'in_transit';

        await auditSession.save();

        // บันทึก Activity Log
        await logActivity(req, 'UPDATE', 'InventoryAudit', `แนบภาพหลักฐานโอนย้ายสินค้า: ${productCode} สาขา: ${auditSession.branch}`, { id: auditSession._id, productCode, inTransitQty: qty });

        res.status(200).json({
            success: true,
            message: 'อัปโหลดรูปหลักฐานการโอนย้ายสำเร็จ',
            audit: auditSession
        });

    } catch (error) {
        console.error('Upload Audit Evidence Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปโหลดหลักฐานสินค้าโอนย้าย' });
    }
};

// 5. ดึงข้อมูลรายการตรวจสอบเดี่ยวโดย ID (สำหรับกู้คืนเซสชันเมื่อ Refresh)
exports.getAuditSession = async (req, res) => {
    try {
        const { id } = req.params;
        const audit = await InventoryAudit.findById(id).populate('auditedBy', 'name username');
        if (!audit) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการตรวจสอบสต็อกนี้' });
        }
        res.status(200).json({ success: true, audit });
    } catch (error) {
        console.error('Get Audit Session Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลตรวจสอบสต็อก' });
    }
};

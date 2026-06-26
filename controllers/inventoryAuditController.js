const InventoryAudit = require('../models/inventoryAudit');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const { logActivity } = require('../utils/logger');

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
                    if (scanned === dbItem.expectedQty) {
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

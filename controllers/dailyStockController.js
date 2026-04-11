const DailyStock = require('../models/dailyStock');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const { logActivity } = require('../utils/logger'); // assuming this exists based on history
const { uploadUrlToDrive } = require('../utils/googleDrive');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 1. นำเข้าสต็อกรายวันจากไฟล์ CSV / XLSX
exports.importDailyStock = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'กรุณาอัปโหลดไฟล์ (.csv หรือ .xlsx)' });
        }

        const filePath = req.file.path;
        const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
        let rawData = [];

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
            // ลบไฟล์ที่ไม่รองรับ
            fs.unlinkSync(filePath);
            return res.status(400).json({ message: 'รองรับเฉพาะไฟล์ .csv หรือ .xlsx' });
        }

        // แปลงข้อมูลและบันทึกลง Database
        const stockItems = rawData.map(row => {
            // สแกนหา key ตามคอลัมน์ (เพื่อป้องกันช่องว่างหรือปัญหาตัวอักษร)
            const getCol = (keyName) => {
                const foundKey = Object.keys(row).find(k => k.trim() === keyName);
                return row[foundKey];
            };

            return {
                productCode: getCol('รหัสสินค้า') || getCol('IMEI') || '',
                productName: getCol('ชื่อสินค้า') || '',
                unit: getCol('หน่วยนับ') || '',
                branch: getCol('ที่เก็บ') || getCol('branch') || '',
                expectedQuantity: parseFloat(getCol('จำนวน')) || 0,
                status: 'pending'
            };
        }).filter(item => item.productCode && item.branch); // ต้องมีรหัสและสาขา

        if (stockItems.length === 0) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ message: 'ไม่พบข้อมูลที่ถูกต้องในไฟล์ (ตรวจสอบชื่อคอลัมน์)' });
        }

        // บันทึกเข้า DB ทีละหลายรายการ
        await DailyStock.insertMany(stockItems);

        // ลบไฟล์ทิ้งหลังจากนำเข้าเรียบร้อยเพื่อประหยัดพื้นที่เซิร์ฟเวอร์
        fs.unlinkSync(filePath);

        // Log
        if (typeof logActivity === 'function') {
            logActivity(req.user.id, 'IMPORT_DAILY_STOCK', `นำเข้าสต็อกรายวันจำนวน ${stockItems.length} รายการ`, 'DailyStock');
        }

        res.status(201).json({ 
            message: 'นำเข้าข้อมูลสต็อกสำเร็จ', 
            count: stockItems.length 
        });

    } catch (error) {
        console.error('Import Daily Stock Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการนำเข้าข้อมูลสต็อก' });
    }
};

// 2. ดึงรายการสต็อกเฉพาะสาขาของพนักงาน
exports.getMyBranchStock = async (req, res) => {
    try {
        let branch = req.user.branch;
        const userDept = (req.user.department || '').toLowerCase();
        const isTech = userDept.includes('เทคนิค') || userDept.includes('tech');
        
        if (isTech) {
            branch = 'สำนักงานใหญ่';
        }

        if (!branch) {
            return res.status(400).json({ message: 'ไม่พบข้อมูลสาขาของพนักงาน' });
        }

        // เอาวันที่เริ่มต้น และสิ้นสุดของวันนี้ (เช็ครายวัน)
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const stocks = await DailyStock.find({
            branch: branch,
            date: { $gte: startOfDay, $lte: endOfDay }
        }).populate('checkedBy', 'username fullname role');

        res.status(200).json(stocks);
    } catch (error) {
        console.error('Get My Branch Stock Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสต็อกของสาขา' });
    }
};

// 3. สแกนตรวจสอบสต็อก (อัปเดตสถานะ + แนบรูป)
exports.scanStock = async (req, res) => {
    try {
        const { productCode, note } = req.body;
        let branch = req.user.branch;
        const userDept = (req.user.department || '').toLowerCase();
        const isTech = userDept.includes('เทคนิค') || userDept.includes('tech');
        
        if (isTech) {
            branch = 'สำนักงานใหญ่';
        }

        if (!productCode) {
            return res.status(400).json({ message: 'กรุณาระบุรหัสสินค้า (Product Code)' });
        }

        // หารูปภาพจากที่ Cloudinary ส่งกลับมา (ถ้ามี)
        const evidenceImageUrl = req.file ? req.file.path : (req.files && req.files.length > 0 ? req.files[0].path : null);

        // เอาวันที่ปัจจุบัน
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // หา item ที่เป็น pending ของสาขานี้ ของวันนี้
        const stockItem = await DailyStock.findOne({
            productCode: productCode,
            branch: branch,
            status: 'pending',
            date: { $gte: startOfDay, $lte: endOfDay }
        });

        if (!stockItem) {
            // เช็คว่ามีสินค้านี้แต่สแกนไปแล้วหรืออยู่สาขาอื่นหรือไม่
            const existItem = await DailyStock.findOne({
                productCode: productCode,
                date: { $gte: startOfDay, $lte: endOfDay }
            });

            if (existItem && existItem.branch !== branch) {
                return res.status(400).json({ message: `รหัสสินค้านี้ (${productCode}) เป็นของสาขา ${existItem.branch}` });
            }
            if (existItem && existItem.status !== 'pending') {
                return res.status(400).json({ message: 'สินค้านี้ถูกสแกนตรวจสอบไปแล้ว' });
            }

            return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้ในรายการตรวจสอบประจำวัน' });
        }

        // อัปเดตข้อมูล
        stockItem.status = 'checked';
        stockItem.scannedAt = new Date();
        stockItem.checkedBy = req.user._id || req.user.id;
        stockItem.evidenceImage = evidenceImageUrl;
        if (note) stockItem.note = note;

        await stockItem.save();

        if (typeof logActivity === 'function') {
            logActivity(req.user.id || req.user._id, 'SCAN_DAILY_STOCK', `สแกนตรวจสอบสินค้า ${productCode}`, 'DailyStock', stockItem._id);
        }

        res.status(200).json({
            message: 'ตรวจสอบรายการสำเร็จ',
            stock: stockItem
        });

    } catch (error) {
        console.error('Scan Stock Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการตรวจสอบสต็อก' });
    }
};

// 4. ดึงสรุปผลรายวันของทุกสาขา (พนักงานฝ่ายสต็อก)
exports.getDailySummary = async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Auto-update past pending items to not_checked
        try {
            await DailyStock.updateMany(
                { status: 'pending', date: { $lt: startOfDay } },
                { 
                    $set: { 
                        status: 'not_checked', 
                        verificationStatus: 'failed', 
                        failReason: 'not_checked' 
                    } 
                }
            );
        } catch (updateErr) {
            console.error('Auto update past pending error:', updateErr);
        }

        const stocks = await DailyStock.find({
            date: { $gte: startOfDay, $lte: endOfDay }
        }).populate('checkedBy', 'username fullname role').populate('verifiedBy', 'username fullname role');

        const total = stocks.length;
        const checked = stocks.filter(s => s.status === 'checked').length;
        const pending = total - checked;

        res.status(200).json({
            summary: {
                total,
                checked,
                pending
            },
            data: stocks
        });
    } catch (error) {
        console.error('Get Daily Summary Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสรุปผลรายวัน' });
    }
};

// 5. ดึงข้อมูลรายงานการเช็คสต็อก (ยืดหยุ่นตามช่วงเวลา)
exports.getDailyStockReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'กรุณาระบุช่วงเวลา (startDate, endDate)' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        // Auto-update past pending items to not_checked
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            await DailyStock.updateMany(
                { status: 'pending', date: { $lt: todayStart } },
                { 
                    $set: { 
                        status: 'not_checked', 
                        verificationStatus: 'failed', 
                        failReason: 'not_checked' 
                    } 
                }
            );
        } catch (updateErr) {
            console.error('Auto update past pending error:', updateErr);
        }

        const stocks = await DailyStock.find({
            date: { $gte: start, $lte: end }
        }).populate('checkedBy', 'username fullname role').populate('verifiedBy', 'username fullname role');

        const total = stocks.length;
        const checked = stocks.filter(s => s.status === 'checked').length;
        const pending = total - checked;

        res.status(200).json({
            summary: {
                total,
                checked,
                pending
            },
            data: stocks
        });
    } catch (error) {
        console.error('Get Daily Stock Report Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน' });
    }
};

// 6. การตรวจสอบและยืนยันข้อมูลจากฝ่ายสต็อก (Double Verification)
exports.verifyStock = async (req, res) => {
    try {
        const { id, decision, reason, detail } = req.body;
        
        if (!id || !decision) {
            return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
        }

        const stock = await DailyStock.findById(id);
        if (!stock) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลรายการตรวจสอบ' });
        }

        if (stock.status !== 'checked') {
            return res.status(400).json({ message: 'รายการยังไม่ได้ถูกตรวจสอบโดยฝ่ายขาย' });
        }

        stock.verifiedBy = req.user._id;
        stock.verifiedAt = new Date();

        if (decision === 'success') {
            stock.verificationStatus = 'success';
            
            if (stock.evidenceImage && stock.evidenceImage.includes('cloudinary.com')) {
                try {
                    const urlParts = stock.evidenceImage.split('/');
                    const lastPart = urlParts[urlParts.length - 1];
                    const driveFileName = `stock_evd_${stock.productCode}_${Date.now()}_${lastPart}`;
                    
                    const driveLink = await uploadUrlToDrive(stock.evidenceImage, driveFileName);
                    if (driveLink) {
                        const oldImageUrl = stock.evidenceImage;
                        stock.evidenceImage = driveLink;
                        try {
                            const splitByUpload = oldImageUrl.split('/upload/');
                            if (splitByUpload.length > 1) {
                                let path = splitByUpload[1];
                                path = path.replace(/^v\d+\//, '');
                                const extIdx = path.lastIndexOf('.');
                                const publicId = extIdx !== -1 ? path.substring(0, extIdx) : path;
                                if (publicId) {
                                    cloudinary.uploader.destroy(publicId, (err, result) => {
                                        if (err) console.error('Cloudinary destroy error:', err);
                                        else console.log('Successfully deleted from Cloudinary: ' + publicId, result);
                                    });
                                }
                            }
                        } catch (delErr) {
                            console.error('Error extracting/deleting publicId from Cloudinary:', delErr);
                        }
                    }
                } catch (driveUploadError) {
                    console.error('Google Drive Upload Failed, retaining Cloudinary link:', driveUploadError);
                }
            }
        } else if (decision === 'failed') {
            stock.verificationStatus = 'failed';
            stock.failReason = reason;
            stock.failDetail = detail;
        } else if (decision === 'recheck') {
            stock.status = 'pending';
            stock.verificationStatus = 'waiting';
            stock.checkedBy = null;
            stock.scannedAt = null;
            stock.evidenceImage = null;
            stock.failReason = undefined;
            stock.failDetail = undefined;
        } else {
            return res.status(400).json({ message: 'ผลการยืนยันไม่ถูกต้อง' });
        }

        await stock.save();

        res.status(200).json({ message: 'ยืนยันการตรวจสอบสำเร็จ', data: stock });
    } catch (error) {
        console.error('Verify Stock Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการยืนยัน' });
    }
};

// 7. แก้ไขข้อมูลรายการสต็อกที่นำเข้ามาแล้ว (ฝ่ายสต็อก) 
exports.editDailyStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { productCode, productName, branch } = req.body;

        if (!productCode || !productName || !branch) {
            return res.status(400).json({ message: 'กรุณาส่งข้อมูลให้ครบถ้วน (รหัสสินค้า, ชื่อสินค้า, สาขา)' });
        }

        const stock = await DailyStock.findById(id);
        if (!stock) {
            return res.status(404).json({ message: 'ไม่พบรายการสต็อกนี้' });
        }

        stock.productCode = productCode;
        stock.productName = productName;
        stock.branch = branch;

        await stock.save();

        res.status(200).json({ message: 'แก้ไขข้อมูลสำเร็จ', data: stock });
    } catch (error) {
        console.error('Edit Daily Stock Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลสต็อก' });
    }
};

// 8. ดึงข้อมูลเปรียบเทียบสต็อกระหว่างสองวัน (วันฐานและวันเปรียบเทียบ)
exports.getComparisonReport = async (req, res) => {
    try {
        const { baseDate, targetDate } = req.query;
        if (!baseDate || !targetDate) {
            return res.status(400).json({ message: 'กรุณาระบุวันฐาน (baseDate) และวันเปรียบเทียบ (targetDate)' });
        }

        const baseStart = new Date(baseDate);
        baseStart.setHours(0, 0, 0, 0);
        const baseEnd = new Date(baseDate);
        baseEnd.setHours(23, 59, 59, 999);

        const targetStart = new Date(targetDate);
        targetStart.setHours(0, 0, 0, 0);
        const targetEnd = new Date(targetDate);
        targetEnd.setHours(23, 59, 59, 999);

        const baseStocks = await DailyStock.find({
            date: { $gte: baseStart, $lte: baseEnd }
        }).lean();

        const targetStocks = await DailyStock.find({
            date: { $gte: targetStart, $lte: targetEnd }
        }).lean();

        const baseMap = new Map();
        baseStocks.forEach(s => baseMap.set(s.productCode, s));

        const targetMap = new Map();
        targetStocks.forEach(s => targetMap.set(s.productCode, s));

        const changes = [];
        let newItemsCount = 0;
        let transferredInCount = 0;
        let soldOutCount = 0;

        targetStocks.forEach(targetItem => {
            const baseItem = baseMap.get(targetItem.productCode);
            if (!baseItem) {
                changes.push({
                    productCode: targetItem.productCode,
                    productName: targetItem.productName,
                    type: 'NEW',
                    branch: targetItem.branch
                });
                newItemsCount++;
            } else {
                if (baseItem.branch !== targetItem.branch) {
                    changes.push({
                        productCode: targetItem.productCode,
                        productName: targetItem.productName,
                        type: 'TRANSFERRED',
                        fromBranch: baseItem.branch,
                        toBranch: targetItem.branch
                    });
                    transferredInCount++;
                }
            }
        });

        baseStocks.forEach(baseItem => {
            if (!targetMap.has(baseItem.productCode)) {
                changes.push({
                    productCode: baseItem.productCode,
                    productName: baseItem.productName,
                    type: 'SOLD',
                    branch: baseItem.branch
                });
                soldOutCount++;
            }
        });

        res.status(200).json({
            summary: {
                newItems: newItemsCount,
                transferredIn: transferredInCount,
                soldOut: soldOutCount
            },
            details: changes
        });

    } catch (error) {
        console.error('Comparison Report Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงรายงานเปรียบเทียบ' });
    }
};

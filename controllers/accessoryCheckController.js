const DailyAccessoryCheck = require('../models/dailyAccessoryCheck');
const fs = require('fs');
const xlsx = require('xlsx');
const { logActivity } = require('../utils/logger');

// Helper to get local YYYY-MM-DD string in Asia/Bangkok
const getLocalDateString = () => {
    const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    return formatter.format(new Date());
};

// Helper to normalize keys and find value in row
const getColValue = (row, possibleKeys) => {
    const foundKey = Object.keys(row).find(k => 
        possibleKeys.includes(k.trim().toLowerCase())
    );
    return foundKey ? row[foundKey] : undefined;
};

// 1. Upload Excel and create or update checks
exports.uploadSession = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาอัปโหลดไฟล์ Excel (.xlsx)' });
        }

        const filePath = req.file.path;
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = xlsx.utils.sheet_to_json(sheet);

        // Delete temporary file
        fs.unlinkSync(filePath);

        if (rawData.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลในไฟล์ที่อัปโหลด' });
        }

        // Possible column keys mapping
        const branchKeys = ['ที่เก็บ', 'branch', 'location', 'สาขา', 'คลัง'];
        const codeKeys = ['รหัสสินค้า', 'productcode', 'barcode', 'รหัส', 'itemcode'];
        const nameKeys = ['ชื่อสินค้า', 'productname', 'ชื่อ', 'itemname', 'description'];
        const qtyKeys = ['จำนวน', 'quantity', 'qty', 'expectedqty', 'จำนวนสินค้า'];

        // Group rows by branch -> then by productCode to sum expectedQty
        const branchGroups = {};

        rawData.forEach(row => {
            const rawBranch = getColValue(row, branchKeys);
            const branch = rawBranch ? String(rawBranch).trim() : '';
            const rawCode = getColValue(row, codeKeys);
            const code = rawCode ? String(rawCode).trim() : '';
            const name = getColValue(row, nameKeys) ? String(getColValue(row, nameKeys)).trim() : 'Unknown Accessory';
            const qtyVal = parseFloat(getColValue(row, qtyKeys)) || 0;

            if (branch && code) {
                if (!branchGroups[branch]) {
                    branchGroups[branch] = {};
                }

                if (branchGroups[branch][code]) {
                    branchGroups[branch][code].expectedQty += qtyVal;
                    branchGroups[branch][code].originalExpectedQty = branchGroups[branch][code].expectedQty;
                } else {
                    branchGroups[branch][code] = {
                        productCode: code,
                        productName: name,
                        expectedQty: qtyVal,
                        originalExpectedQty: qtyVal,
                        countedQty: 0
                    };
                }
            }
        });

        const branchesProcessed = Object.keys(branchGroups);
        if (branchesProcessed.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลสาขา รหัสสินค้า หรือจำนวนในไฟล์ (โปรดตรวจสอบชื่อคอลัมน์)' });
        }

        const todayStr = getLocalDateString();
        const results = [];

        // Save daily accessory check document for each branch
        for (const branchName of branchesProcessed) {
            const itemsList = Object.values(branchGroups[branchName]);

            const doc = await DailyAccessoryCheck.findOneAndUpdate(
                { date: todayStr, branch: branchName },
                {
                    $set: {
                        items: itemsList,
                        status: 'pending'
                    }
                },
                { upsert: true, new: true }
            );
            results.push(doc);
        }

        // Log Activity
        await logActivity(req, 'CREATE', 'DailyAccessoryCheck', `เปิดรอบตรวจเช็คอุปกรณ์เสริมรายวัน: ${todayStr} (${branchesProcessed.length} สาขา)`, { date: todayStr, branches: branchesProcessed });

        res.status(201).json({
            success: true,
            message: `เปิดรอบเช็คสต็อกเรียบร้อยแล้ว จำนวน ${branchesProcessed.length} สาขา`,
            data: results
        });

    } catch (error) {
        console.error('Upload Session Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเปิดรอบเช็คสต็อก' });
    }
};

// 2. Admin get overview for a specific date
exports.getAdminOverview = async (req, res) => {
    try {
        const dateStr = req.query.date || getLocalDateString();
        const checks = await DailyAccessoryCheck.find({ date: dateStr })
            .sort({ branch: 1 });

        res.status(200).json({
            success: true,
            date: dateStr,
            data: checks
        });
    } catch (error) {
        console.error('Get Admin Overview Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลภาพรวม' });
    }
};

// 3. Branch staff get task for today
exports.getBranchTask = async (req, res) => {
    try {
        const todayStr = getLocalDateString();
        const branch = req.user.branch;

        if (!branch) {
            return res.status(400).json({ success: false, message: 'ผู้ใช้ไม่มีข้อมูลสังกัดสาขา' });
        }

        const checkTask = await DailyAccessoryCheck.findOne({ date: todayStr, branch: branch });
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ยังไม่มีการเปิดรอบเช็คสต็อกสำหรับวันนี้' });
        }

        res.status(200).json({
            success: true,
            data: checkTask
        });
    } catch (error) {
        console.error('Get Branch Task Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลของสาขา' });
    }
};

// 4. Branch staff submit counted values
exports.submitBranchCheck = async (req, res) => {
    try {
        const { id, items } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบ (Check ID)' });
        }

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'กรุณาส่งรายการสินค้าที่ตรวจนับมาเป็นอาเรย์' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการเช็คสต็อกของสาขานี้' });
        }

        if (['submitted', 'completed'].includes(checkTask.status)) {
            return res.status(400).json({ success: false, message: 'รายการตรวจสอบนี้ได้ส่งผลตรวจนับเข้ามาแล้ว ไม่สามารถแก้ไขได้' });
        }

        // Map updates to db items
        items.forEach(uItem => {
            const dbItem = checkTask.items.find(i => i.productCode === uItem.productCode);
            if (dbItem) {
                dbItem.countedQty = parseInt(uItem.countedQty) || 0;
                if (uItem.remark !== undefined) {
                    dbItem.remark = String(uItem.remark).trim();
                }
            }
        });

        checkTask.status = 'submitted';
        checkTask.submittedBy = req.user._id;
        checkTask.submittedByName = req.user.name || req.user.username;
        await checkTask.save();

        // Log Activity
        await logActivity(req, 'UPDATE', 'DailyAccessoryCheck', `สาขา ${checkTask.branch} ส่งผลการตรวจนับสต็อกอุปกรณ์เสริมแล้ว (รอตรวจสอบ)`, { id: checkTask._id, branch: checkTask.branch });

        res.status(200).json({
            success: true,
            message: 'ส่งผลการตรวจนับสต็อกอุปกรณ์เสริมเรียบร้อยแล้ว รอฝ่ายสต็อกส่วนกลางตรวจสอบ',
            data: checkTask
        });

    } catch (error) {
        console.error('Submit Branch Check Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งข้อมูลนับสต็อก' });
    }
};

// 5. Admin send back / reject check task for re-verification
exports.rejectSession = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบ (Check ID)' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการตรวจเช็คอุปกรณ์เสริมที่ระบุ' });
        }

        if (!['submitted', 'completed'].includes(checkTask.status)) {
            return res.status(400).json({ success: false, message: 'รายการตรวจสอบนี้ไม่ได้ส่งข้อมูลเข้ามา จึงไม่สามารถส่งกลับได้' });
        }

        // Change status to recheck
        checkTask.status = 'recheck';
        await checkTask.save();

        // Log Activity
        await logActivity(req, 'UPDATE', 'DailyAccessoryCheck', `สต็อกส่วนกลางส่งกลับรายการเช็คสต็อกของสาขา ${checkTask.branch} ให้ตรวจสอบเพิ่มเติม`, { id: checkTask._id, branch: checkTask.branch });

        res.status(200).json({
            success: true,
            message: `ส่งกลับรายการตรวจสอบของสาขา ${checkTask.branch} เรียบร้อยแล้ว`,
            data: checkTask
        });

    } catch (error) {
        console.error('Reject Session Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งกลับข้อมูลเพื่อตรวจสอบใหม่' });
    }
};

// 6. Admin approve / complete check task
exports.approveSession = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบ (Check ID)' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการตรวจเช็คอุปกรณ์เสริมที่ระบุ' });
        }

        if (checkTask.status !== 'submitted') {
            return res.status(400).json({ success: false, message: 'รายการตรวจสอบนี้ไม่ได้อยู่ในสถานะรอตรวจสอบ' });
        }

        checkTask.status = 'completed';
        await checkTask.save();

        // Log Activity
        await logActivity(req, 'UPDATE', 'DailyAccessoryCheck', `สต็อกส่วนกลางอนุมัติผลการตรวจนับสต็อกของสาขา ${checkTask.branch} (ตรวจเสร็จสิ้น)`, { id: checkTask._id, branch: checkTask.branch });

        res.status(200).json({
            success: true,
            message: `ยืนยันเสร็จสิ้นรายการตรวจสอบของสาขา ${checkTask.branch} เรียบร้อยแล้ว`,
            data: checkTask
        });

    } catch (error) {
        console.error('Approve Session Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการยืนยันรายการเช็คสต็อก' });
    }
};

// 7. Branch staff save draft counted values (autosave)
exports.saveDraft = async (req, res) => {
    try {
        const { id, items } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบ (Check ID)' });
        }

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'กรุณาส่งรายการสินค้ามาเป็นอาเรย์' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการเช็คสต็อกของสาขานี้' });
        }

        if (['submitted', 'completed'].includes(checkTask.status)) {
            return res.status(400).json({ success: false, message: 'รายการตรวจสอบนี้ได้ส่งผลนับไปแล้ว ไม่สามารถบันทึกร่างได้' });
        }

        // Map updates to db items
        items.forEach(uItem => {
            const dbItem = checkTask.items.find(i => i.productCode === uItem.productCode);
            if (dbItem) {
                dbItem.countedQty = parseInt(uItem.countedQty) || 0;
                if (uItem.remark !== undefined) {
                    dbItem.remark = String(uItem.remark).trim();
                }
            }
        });

        await checkTask.save();

        res.status(200).json({
            success: true,
            message: 'บันทึกร่างเรียบร้อยแล้ว',
            data: checkTask
        });

    } catch (error) {
        console.error('Save Draft Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกร่าง' });
    }
};

// 8. Admin update deduction amount for shortage item
exports.updateDeduction = async (req, res) => {
    try {
        const { id, productCode, deductionAmount } = req.body;

        if (!id || !productCode) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบและรหัสสินค้า' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการเช็คสต็อกที่ระบุ' });
        }

        const dbItem = checkTask.items.find(i => i.productCode === productCode);
        if (!dbItem) {
            return res.status(404).json({ success: false, message: 'ไม่พบสินค้าที่ระบุในรายการ' });
        }

        dbItem.deductionAmount = parseFloat(deductionAmount) || 0;
        await checkTask.save();

        res.status(200).json({
            success: true,
            message: 'บันทึกยอดเงินหักเรียบร้อยแล้ว',
            data: checkTask
        });
    } catch (error) {
        console.error('Update Deduction Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกยอดเงินหัก' });
    }
};

// 9. Admin update shipping quantity for shortage item
exports.updateShipping = async (req, res) => {
    try {
        const { id, productCode, shippingQty } = req.body;

        if (!id || !productCode) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบและรหัสสินค้า' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการเช็คสต็อกที่ระบุ' });
        }

        const dbItem = checkTask.items.find(i => i.productCode === productCode);
        if (!dbItem) {
            return res.status(404).json({ success: false, message: 'ไม่พบสินค้าที่ระบุในรายการ' });
        }

        dbItem.shippingQty = parseInt(shippingQty) || 0;
        await checkTask.save();

        res.status(200).json({
            success: true,
            message: 'บันทึกจำนวนสินค้าที่จัดส่งเรียบร้อยแล้ว',
            data: checkTask
        });
    } catch (error) {
        console.error('Update Shipping Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกจำนวนสินค้าที่จัดส่ง' });
    }
};

// 10. Admin update expected quantity (system count) with mandatory remark
exports.updateExpectedQty = async (req, res) => {
    try {
        const { id, productCode, expectedQty, remark } = req.body;

        if (!id || !productCode) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสรายการตรวจสอบและรหัสสินค้า' });
        }

        if (expectedQty === undefined || expectedQty === null || expectedQty === '') {
            return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนสินค้าในระบบ' });
        }

        const parsedExpected = parseFloat(expectedQty);
        if (isNaN(parsedExpected) || parsedExpected < 0) {
            return res.status(400).json({ success: false, message: 'จำนวนสินค้าในระบบต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0' });
        }

        if (!remark || remark.trim() === '') {
            return res.status(400).json({ success: false, message: 'กรุณาระบุหมายเหตุเพื่อชี้แจงเหตุผลในการปรับปรุงยอดระบบ' });
        }

        const checkTask = await DailyAccessoryCheck.findById(id);
        if (!checkTask) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการเช็คสต็อกที่ระบุ' });
        }

        const dbItem = checkTask.items.find(i => i.productCode === productCode);
        if (!dbItem) {
            return res.status(404).json({ success: false, message: 'ไม่พบสินค้าที่ระบุในรายการ' });
        }

        // Keep track of the original expected quantity if not set yet
        if (dbItem.originalExpectedQty === null || dbItem.originalExpectedQty === undefined) {
            dbItem.originalExpectedQty = dbItem.expectedQty;
        }

        dbItem.expectedQty = parsedExpected;
        dbItem.remark = remark.trim(); // Save reason directly in remark
        await checkTask.save();

        res.status(200).json({
            success: true,
            message: 'ปรับปรุงจำนวนสินค้าในระบบและหมายเหตุเรียบร้อยแล้ว',
            data: checkTask
        });
    } catch (error) {
        console.error('Update Expected Qty Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการปรับปรุงจำนวนสินค้าในระบบ' });
    }
};

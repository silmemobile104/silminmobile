// controllers/depositController.js
const Deposit = require('../models/deposit');

// @desc    ดึงข้อมูล
exports.getDeposits = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userDept = req.user.department || '';
        const { branch, companyId, viewMode } = req.query; // เพิ่ม viewMode

        // 1. Company ID
        let filterCompanyId = req.user.companyId;
        if (userRole !== 'staff') {
            filterCompanyId = companyId || req.user.companyId;
        }

        let query = { companyId: filterCompanyId };

        // 2. Logic การกรอง Branch
        // หากเป็นฝ่ายจัดซื้อ (เช็คจากชื่อแผนก) หรือ Admin/Manager ให้ดูได้หมด หรือกรองตามเลือก
        const isPurchasing = userDept.includes('จัดซื้อ') || userDept.includes('Purchase');
        const isAccounting = userDept.includes('บัญชี') || userDept.includes('Account') || userDept.includes('account'); // เพิ่ม Accounting

        if (userRole === 'staff' && !isPurchasing && !isAccounting) {
            // Staff ทั่วไป (ฝ่ายขาย) เห็นแค่สาขาตัวเอง
            if (req.user.branch) {
                query.branch = req.user.branch;
            }
        } else {
            // Admin, Manager, หรือ ฝ่ายจัดซื้อ
            if (branch && branch !== 'all') {
                const decodedBranch = decodeURIComponent(branch);
                query.branch = decodedBranch;
            }
        }

        // [Option] ถ้าเป็นหน้าจัดซื้อ อาจจะกรองเฉพาะรายการที่ยังไม่สำเร็จ (isSuccess: false)
        if (viewMode === 'purchasing') {
            // จัดซื้ออาจจะอยากดูเฉพาะงานที่ยังไม่จบ หรือดูทั้งหมดก็ได้ (ในที่นี้ให้ดูทั้งหมดที่ยังไม่รับเครื่อง)
            // query.isSuccess = false; 
        }

        // 3. Logic การกรอง Date Range (startDate, endDate)
        // รับค่ามาเป็น string YYYY-MM-DD
        const { startDate, endDate } = req.query;
        if (startDate || endDate) {
            query.depositDate = {};
            if (startDate) {
                // เริ่มต้นวัน (00:00:00)
                query.depositDate.$gte = new Date(startDate + 'T00:00:00.000Z');
            }
            if (endDate) {
                // สิ้นสุดวัน (23:59:59)
                query.depositDate.$lte = new Date(endDate + 'T23:59:59.999Z');
            }
        }

        const deposits = await Deposit.find(query).sort({ depositDate: -1 });
        res.status(200).json(deposits);

    } catch (error) {
        console.error('Get Deposits Error:', error.message);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    บันทึก หรือ แก้ไข
exports.saveDeposit = async (req, res) => {
    try {
        const {
            id, depositDate, customerName, phoneNumber, depositAmount, pickupDueDate,
            billNo, imei, product, price, isSuccess, isCanceled,
            // รับค่าใหม่
            orderStatus, orderNote, expectedArrivalDate
        } = req.body;

        if (id) {
            // --- แก้ไข ---
            const deposit = await Deposit.findById(id);
            if (!deposit) return res.status(404).json({ message: 'Not Found' });

            // อัปเดตข้อมูลเดิม
            deposit.depositDate = depositDate;
            deposit.customerName = customerName;
            deposit.phoneNumber = phoneNumber;
            deposit.depositAmount = depositAmount;
            deposit.pickupDueDate = pickupDueDate;
            deposit.billNo = billNo;
            deposit.imei = imei;
            deposit.product = product;
            deposit.price = price;
            deposit.isCanceled = !!isCanceled;
            deposit.isSuccess = deposit.isCanceled ? false : !!isSuccess;

            // อัปเดตข้อมูลจัดซื้อ (ถ้าส่งมา)
            if (orderStatus) deposit.orderStatus = orderStatus;
            if (orderNote !== undefined) deposit.orderNote = orderNote;
            if (expectedArrivalDate !== undefined) deposit.expectedArrivalDate = expectedArrivalDate;

            if (deposit.isSuccess && !deposit.signName) deposit.signName = req.user.name;

            await deposit.save();
            return res.status(200).json(deposit);
        } else {
            // --- สร้างใหม่ ---
            const newDeposit = new Deposit({
                companyId: req.user.companyId,
                branch: req.user.branch || req.user.department,
                depositDate, customerName, phoneNumber, depositAmount, pickupDueDate,
                billNo, imei, product, price,
                isCanceled: !!isCanceled,
                isSuccess: (!!isCanceled) ? false : !!isSuccess,
                signName: '',
                // ค่าเริ่มต้น
                orderStatus: 'pending',
                orderNote: '',
                expectedArrivalDate: null
            });
            await newDeposit.save();
            return res.status(201).json(newDeposit);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ... (functions อื่นๆ เหมือนเดิม)
exports.deleteDeposit = async (req, res) => {
    try { await Deposit.findByIdAndDelete(req.params.id); res.status(200).json({ message: 'Deleted' }); } catch (e) { res.status(500).json({ message: 'Error' }); }
};
exports.getDepositProducts = async (req, res) => {
    try { const p = await Deposit.distinct('product', { companyId: req.user.companyId, product: { $ne: null } }); res.status(200).json(p); } catch (e) { res.status(500).json({ message: 'Error' }); }
};